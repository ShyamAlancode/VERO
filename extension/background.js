// VERO – Background Service Worker
// Proxies Gemini, NewsAPI, and PIB requests from content scripts

const GEMINI_KEY = 'AIzaSyBQ7Mjoahx1BXChaofqafBEgs3Tj_RdlcU';
const NEWSAPI_KEY = '241b1aba62fd438aa81630a8e35f666e';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const DEFAULT_STATS = {
    messagesChecked: 0,
    fakesDetected: 0,
    reelsScanned: 0,
    deepfakesDetected: 0
};

// Initialise on first install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(null, (items) => {
        if (!items.stats) chrome.storage.local.set({ stats: DEFAULT_STATS });
        if (items.enabled === undefined) chrome.storage.local.set({ enabled: true, whatsapp: true, instagram: true });
    });
});

// ─── Message Router ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'GEMINI_REQUEST':
            callGemini(msg.prompt)
                .then(data => sendResponse({ success: true, data }))
                .catch(err => sendResponse({ success: false, error: err.toString() }));
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
async function callGemini(prompt) {
    const url = `${GEMINI_URL}?key=${GEMINI_KEY}`;
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

// ─── NewsAPI for live context ──────────────────────────────
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

// ─── PIB Fact Check (scrape-friendly endpoint) ─────────────
async function fetchPIBFactCheck(query) {
    // PIB doesn't have a public API, but we can search it via Google
    // For the extension we return a search link the user can follow
    const q = encodeURIComponent(query.substring(0, 80));
    return {
        searchUrl: `https://factcheck.pib.gov.in/?s=${q}`,
        message: 'Check PIB Fact Check portal for official verification'
    };
}
