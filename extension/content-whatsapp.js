// VERO – WhatsApp Web Content Script
// Real-time misinformation detection using Gemini + NewsAPI + PIB

(function () {
    'use strict';

    let enabled = true;
    let whatsappEnabled = true;

    // Load settings
    chrome.storage.local.get(['enabled', 'whatsapp'], (r) => {
        enabled = r.enabled !== false;
        whatsappEnabled = r.whatsapp !== false;
        if (enabled && whatsappEnabled) waitForWhatsApp();
    });

    chrome.storage.onChanged.addListener((c) => {
        if (c.enabled) enabled = c.enabled.newValue;
        if (c.whatsapp) whatsappEnabled = c.whatsapp.newValue;
    });

    // ─── Wait for WhatsApp DOM ──────────────────────────────
    function waitForWhatsApp() {
        const poll = setInterval(() => {
            if (document.querySelector('#pane-side') || document.querySelector('[role="grid"]')) {
                clearInterval(poll);
                initObserver();
                scanVisible();
            }
        }, 1500);
    }

    function scanVisible() {
        document.querySelectorAll('.message-in, .message-out, [data-testid="msg-container"]').forEach(processMsg);
    }

    function initObserver() {
        new MutationObserver((muts) => {
            if (!enabled || !whatsappEnabled) return;
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.('.message-in,.message-out,[data-testid="msg-container"]')) processMsg(n);
                    n.querySelectorAll?.('.message-in,.message-out,[data-testid="msg-container"]').forEach(processMsg);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ─── Process a single message ───────────────────────────
    async function processMsg(el) {
        if (el.hasAttribute('data-vero')) return;
        el.setAttribute('data-vero', 'pending');

        const textEl =
            el.querySelector('.copyable-text span[dir]') ||
            el.querySelector('[data-testid="text-message"]') ||
            el.querySelector('span[dir="ltr"]');

        const text = textEl?.innerText?.trim();
        if (!text || text.length < 15) { el.setAttribute('data-vero', 'skip'); return; }
        if (/waiting for this message|end-to-end encrypted|joined using/i.test(text)) { el.setAttribute('data-vero', 'skip'); return; }

        showIndicator(el);

        try {
            // Step 1: Get NewsAPI context for the claim
            let newsContext = '';
            try {
                const newsRes = await bgMessage('NEWS_CONTEXT', { query: text.substring(0, 100) });
                if (newsRes.success && newsRes.data?.length) {
                    newsContext = '\n\nRelated News (from NewsAPI):\n' + newsRes.data.map(a => `- "${a.title}" (${a.source})`).join('\n');
                }
            } catch (_) { /* NewsAPI optional */ }

            // Step 2: Get PIB link
            let pibInfo = '';
            try {
                const pibRes = await bgMessage('PIB_CHECK', { query: text.substring(0, 80) });
                if (pibRes.success) pibInfo = pibRes.data;
            } catch (_) { }

            // Step 3: Call Gemini with enriched prompt
            const prompt = `You are VERO, an AI fact-checker. Analyze this WhatsApp message for misinformation.
${newsContext}

Message: "${text}"

Respond ONLY with valid JSON (no markdown):
{
  "isFake": boolean,
  "isMisleading": boolean,
  "confidence": 0-100,
  "label": "FAKE" | "MISLEADING" | "VERIFIED" | "UNKNOWN",
  "explanation": "1-line reason",
  "source": "Source name if available",
  "sourceUrl": "URL if available"
}
Be strict: if unsure, return label "UNKNOWN" with low confidence.`;

            const geminiRes = await bgMessage('GEMINI_REQUEST', { prompt });
            removeIndicator(el);

            if (!geminiRes.success) { el.setAttribute('data-vero', 'error'); return; }

            const result = parseGeminiJSON(geminiRes.data);

            // Enrich with PIB link
            if (pibInfo?.searchUrl && result.label !== 'VERIFIED') {
                result.pibUrl = pibInfo.searchUrl;
            }

            el.setAttribute('data-vero', result.label?.toLowerCase() || 'unknown');

            // Update stats
            bgMessage('UPDATE_STATS', { field: 'message', flagged: result.isFake || result.isMisleading });

            // Inject badge
            if (result.isFake || result.isMisleading) {
                injectBadge(el, result);
            }

        } catch (err) {
            console.error('[VERO] Analysis failed:', err);
            removeIndicator(el);
            el.setAttribute('data-vero', 'error');
        }
    }

    // ─── UI: Indicator ──────────────────────────────────────
    function showIndicator(el) {
        const ind = document.createElement('div');
        ind.className = 'vero-pulse-shield';
        ind.textContent = '🛡️';
        ind.style.cssText = 'position:absolute;top:-8px;right:-8px;width:22px;height:22px;font-size:11px;';
        el.style.position = 'relative';
        el.appendChild(ind);
        el._vind = ind;
    }

    function removeIndicator(el) { el._vind?.remove(); }

    // ─── UI: Warning Badge ─────────────────────────────────
    function injectBadge(el, result) {
        if (el.querySelector('.vero-warning-badge')) return;

        const cls = result.label === 'FAKE' ? 'fake' : 'caution';
        const icon = result.label === 'FAKE' ? '❌' : '⚠️';

        const badge = document.createElement('div');
        badge.className = `vero-warning-badge ${cls}`;
        badge.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;">
        ${icon} <span>${result.label}</span> · ${result.confidence}% confidence
      </div>
      <div style="margin-top:3px;font-size:11px;">${result.explanation || ''}</div>
      ${result.source ? `<div class="vero-source-link">📰 <a href="${result.sourceUrl || '#'}" target="_blank">${result.source}</a></div>` : ''}
      ${result.pibUrl ? `<div class="vero-source-link">🇮🇳 <a href="${result.pibUrl}" target="_blank">Check PIB Fact Check</a></div>` : ''}
    `;
        el.appendChild(badge);
    }

    // ─── Helpers ────────────────────────────────────────────
    function bgMessage(type, payload) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type, ...payload }, (res) => {
                if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
                else resolve(res || { success: false });
            });
        });
    }

    function parseGeminiJSON(raw) {
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : { isFake: false, label: 'UNKNOWN', confidence: 0 };
        } catch (_) {
            return { isFake: false, label: 'UNKNOWN', confidence: 0 };
        }
    }

    console.log('[VERO] WhatsApp content script loaded ✓');
})();
