// VERO – Background Service Worker v2.0
// Proxies Gemini, NewsAPI, and PIB requests from content scripts
// Includes circuit breaker + exponential backoff for API errors

const NEWSAPI_KEY = '241b1aba62fd438aa81630a8e35f666e';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const DEFAULT_STATS = {
    messagesChecked: 0,
    fakesDetected: 0,
    reelsScanned: 0,
    deepfakesDetected: 0
};

// ─── Circuit Breaker ─────────────────────────────────────────
// Stops ALL Gemini calls when the API returns fatal errors
let circuitOpen = false;         // true = stop making requests
let circuitReason = '';          // reason the circuit opened
let circuitResetTime = 0;        // timestamp when to try again
let consecutiveFails = 0;        // count of consecutive 429s

function openCircuit(reason, cooldownMs) {
    circuitOpen = true;
    circuitReason = reason;
    circuitResetTime = Date.now() + cooldownMs;
    console.warn(`[VERO BG] 🔴 Circuit OPEN: ${reason}. Retry after ${Math.round(cooldownMs / 1000)}s`);
}

function checkCircuit() {
    if (!circuitOpen) return true; // circuit closed, OK to proceed
    if (Date.now() > circuitResetTime) {
        console.log('[VERO BG] 🟢 Circuit reset — will try one request');
        circuitOpen = false;
        circuitReason = '';
        return true;
    }
    return false; // still open, do NOT make request
}

// Initialise on first install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(null, (items) => {
        if (!items.stats) chrome.storage.local.set({ stats: DEFAULT_STATS });
        if (items.enabled === undefined) chrome.storage.local.set({ enabled: true, whatsapp: true, instagram: true });
    });
    console.log('[VERO BG] Service worker installed');
});

// Helper: get the Gemini key from storage
function getGeminiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['geminiKey'], (r) => {
            resolve(r.geminiKey || '');
        });
    });
}

// ─── Message Router ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'GEMINI_REQUEST':
            (async () => {
                try {
                    // Check circuit breaker FIRST
                    if (!checkCircuit()) {
                        sendResponse({ success: false, error: `⏸️ API paused: ${circuitReason}. Auto-retry in ${Math.round((circuitResetTime - Date.now()) / 1000)}s` });
                        return;
                    }
                    const key = await getGeminiKey();
                    if (!key) {
                        // Don't spam — open circuit for 5 min if no key
                        openCircuit('No API key configured', 5 * 60 * 1000);
                        sendResponse({ success: false, error: '🔑 No Gemini API key. Click VERO popup → paste key → Save.' });
                        return;
                    }
                    const data = await callGemini(msg.prompt, key);
                    // Success! Reset failure count
                    consecutiveFails = 0;
                    sendResponse({ success: true, data });
                } catch (err) {
                    const errStr = err.toString();

                    // 403 = leaked key → permanent stop until user adds new key
                    if (errStr.includes('403') || errStr.includes('leaked')) {
                        openCircuit('API key is disabled (leaked). Create a NEW key from a NEW Google Cloud project.', 30 * 60 * 1000);
                        sendResponse({ success: false, error: '🔑 API key disabled. Go to aistudio.google.com/apikey → Create key in NEW project → paste in VERO popup.' });
                        return;
                    }

                    // 429 = rate limited → exponential backoff
                    if (errStr.includes('429') || errStr.includes('quota') || errStr.includes('RESOURCE_EXHAUSTED')) {
                        consecutiveFails++;
                        // Exponential backoff: 60s, 120s, 240s, 480s, max 10 min
                        const backoffMs = Math.min(60000 * Math.pow(2, consecutiveFails - 1), 10 * 60 * 1000);
                        openCircuit(`Rate limited (attempt ${consecutiveFails})`, backoffMs);
                        sendResponse({ success: false, error: `⏸️ Rate limited. Pausing ${Math.round(backoffMs / 1000)}s.` });
                        return;
                    }

                    sendResponse({ success: false, error: errStr });
                }
            })();
            return true;

        case 'NEWS_CONTEXT':
            fetchNewsContext(msg.query)
                .then(data => sendResponse({ success: true, data }))
                .catch(err => sendResponse({ success: false, error: err.toString() }));
            return true;

        case 'PIB_CHECK':
            fetchPIBFactCheck(msg.query)
                .then(data => sendResponse({ success: true, data }))
                .catch(err => sendResponse({ success: false, error: err.toString() }));
            return true;

        case 'UPDATE_STATS':
            chrome.storage.local.get(['stats'], (res) => {
                const stats = res.stats || DEFAULT_STATS;
                if (msg.field === 'message') { stats.messagesChecked++; if (msg.flagged) stats.fakesDetected++; }
                if (msg.field === 'reel') { stats.reelsScanned++; if (msg.flagged) stats.deepfakesDetected++; }
                chrome.storage.local.set({ stats }, () => sendResponse({ success: true }));
            });
            return true;

        default:
            return false;
    }
});

// ─── Gemini API ────────────────────────────────────────────
async function callGemini(prompt, apiKey) {
    const url = `${GEMINI_URL}?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.15, maxOutputTokens: 512 }
        })
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── NewsAPI ───────────────────────────────────────────────
async function fetchNewsContext(query) {
    const q = encodeURIComponent(query.substring(0, 100));
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=relevancy&pageSize=3&apiKey=${NEWSAPI_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
    const json = await res.json();
    return (json.articles || []).map(a => ({
        title: a.title,
        source: a.source?.name,
        url: a.url,
        publishedAt: a.publishedAt
    }));
}

// ─── PIB Fact Check ────────────────────────────────────────
async function fetchPIBFactCheck(query) {
    const q = encodeURIComponent(query.substring(0, 80));
    return {
        searchUrl: `https://factcheck.pib.gov.in/?s=${q}`,
        message: 'Check PIB Fact Check portal for official verification'
    };
}
