// VERO – WhatsApp Web Content Script v1.2
// Real-time misinformation detection using Gemini + NewsAPI + PIB

(function () {
    'use strict';
    console.log('%c[VERO] 🛡️ WhatsApp content script STARTING...', 'color: #4285f4; font-weight: bold; font-size: 14px;');

    let enabled = true;
    let whatsappEnabled = true;

    chrome.storage.local.get(['enabled', 'whatsapp'], (r) => {
        enabled = r.enabled !== false;
        whatsappEnabled = r.whatsapp !== false;
        console.log('[VERO] Settings loaded:', { enabled, whatsappEnabled });
        if (enabled && whatsappEnabled) waitForWhatsApp();
        else console.log('[VERO] Extension is disabled in settings');
    });

    chrome.storage.onChanged.addListener((c) => {
        if (c.enabled) enabled = c.enabled.newValue;
        if (c.whatsapp) whatsappEnabled = c.whatsapp.newValue;
    });

    // ─── Wait for WhatsApp to render ──────────────────────────
    function waitForWhatsApp() {
        console.log('[VERO] Waiting for WhatsApp DOM...');
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            // Multiple possible selectors for WhatsApp app container
            const appEl = document.querySelector('#app') ||
                document.querySelector('[data-app]') ||
                document.querySelector('#pane-side') ||
                document.querySelector('[role="application"]');

            if (appEl) {
                clearInterval(poll);
                console.log(`%c[VERO] ✅ WhatsApp DOM detected after ${attempts} attempts`, 'color: #34a853; font-weight: bold;');
                startScanning();
            } else if (attempts > 60) {
                clearInterval(poll);
                console.warn('[VERO] ⚠️ Gave up waiting for WhatsApp DOM after 60 attempts');
            }
        }, 2000);
    }

    function startScanning() {
        // Set up the observer FIRST on the whole body
        initObserver();
        // Then do an initial scan
        setTimeout(() => scanAllMessages(), 3000);
        // And periodically re-scan in case observer misses anything
        setInterval(() => {
            if (enabled && whatsappEnabled) scanAllMessages();
        }, 10000);
    }

    // ─── Find all message containers ──────────────────────────
    function findMessageElements() {
        // WhatsApp uses several possible structures — try all of them
        const selectors = [
            '[data-testid="msg-container"]',
            '.message-in',
            '.message-out',
            'div[class*="message-"]',
            'div[data-id]',  // messages have data-id attributes
            'div.focusable-list-item', // chat list items
        ];

        let elements = [];
        for (const sel of selectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) {
                console.log(`[VERO] Found ${found.length} elements with selector: ${sel}`);
                elements = [...elements, ...found];
                break; // Use the first selector that works
            }
        }

        // Fallback: find elements that contain text with span[dir]
        if (elements.length === 0) {
            const spans = document.querySelectorAll('span[dir="ltr"], span[dir="rtl"]');
            console.log(`[VERO] Fallback: found ${spans.length} text spans`);
            spans.forEach(span => {
                // Walk up to find a reasonable container
                let parent = span.parentElement;
                for (let i = 0; i < 6 && parent; i++) {
                    if (parent.getAttribute('data-id') || parent.getAttribute('data-testid')?.includes('msg')) {
                        elements.push(parent);
                        break;
                    }
                    parent = parent.parentElement;
                }
            });
        }

        return [...new Set(elements)]; // deduplicate
    }

    function scanAllMessages() {
        const messages = findMessageElements();
        console.log(`[VERO] Scanning ${messages.length} message elements...`);
        messages.forEach(processMsg);
    }

    // ─── MutationObserver ─────────────────────────────────────
    function initObserver() {
        console.log('[VERO] MutationObserver started on document.body');
        new MutationObserver((muts) => {
            if (!enabled || !whatsappEnabled) return;
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    // Check if the node itself is a message
                    if (hasTextContent(n)) processMsg(n);
                    // Check children
                    const children = n.querySelectorAll?.('[data-testid="msg-container"], div[data-id], span[dir]');
                    if (children) {
                        children.forEach(child => {
                            const container = findMsgContainer(child);
                            if (container) processMsg(container);
                        });
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    function findMsgContainer(el) {
        let parent = el;
        for (let i = 0; i < 8 && parent; i++) {
            if (parent.getAttribute('data-id') || parent.getAttribute('data-testid')?.includes('msg') ||
                parent.classList?.contains('message-in') || parent.classList?.contains('message-out')) {
                return parent;
            }
            parent = parent.parentElement;
        }
        return el.closest('[data-testid*="msg"]') || el.closest('[data-id]');
    }

    function hasTextContent(el) {
        return el.querySelector?.('span[dir]') || el.querySelector?.('[data-testid*="msg"]');
    }

    // ─── Process a single message ─────────────────────────────
    async function processMsg(el) {
        if (!el || el.hasAttribute('data-vero')) return;
        el.setAttribute('data-vero', 'pending');

        // Extract text content from the message
        const text = extractText(el);
        if (!text || text.length < 15) {
            el.setAttribute('data-vero', 'skip');
            return;
        }
        if (/waiting for this message|end-to-end encrypted|joined using|this chat|security code/i.test(text)) {
            el.setAttribute('data-vero', 'skip');
            return;
        }

        console.log(`[VERO] 📝 Processing message (${text.length} chars): "${text.substring(0, 60)}..."`);
        showIndicator(el);

        try {
            // Step 1: Get NewsAPI context
            let newsContext = '';
            try {
                const newsRes = await bgMessage('NEWS_CONTEXT', { query: text.substring(0, 100) });
                if (newsRes.success && newsRes.data?.length) {
                    newsContext = '\n\nRelated News (from NewsAPI):\n' + newsRes.data.map(a => `- "${a.title}" (${a.source})`).join('\n');
                    console.log('[VERO] 📰 Got NewsAPI context:', newsRes.data.length, 'articles');
                }
            } catch (_) { }

            // Step 2: PIB link
            let pibInfo = null;
            try {
                const pibRes = await bgMessage('PIB_CHECK', { query: text.substring(0, 80) });
                if (pibRes.success) pibInfo = pibRes.data;
            } catch (_) { }

            // Step 3: Gemini analysis
            const prompt = `You are VERO, an AI fact-checker. Analyze this WhatsApp message for misinformation.
${newsContext}

Message: "${text}"

Respond ONLY with valid JSON (no markdown, no backticks):
{"isFake": true/false, "isMisleading": true/false, "confidence": 0-100, "label": "FAKE" or "MISLEADING" or "VERIFIED" or "UNKNOWN", "explanation": "1-line reason", "source": "Source name", "sourceUrl": "URL"}
Be strict: if unsure, return label "UNKNOWN".`;

            console.log('[VERO] 🤖 Calling Gemini...');
            const geminiRes = await bgMessage('GEMINI_REQUEST', { prompt });
            removeIndicator(el);

            if (!geminiRes.success) {
                console.error('[VERO] ❌ Gemini failed:', geminiRes.error);
                el.setAttribute('data-vero', 'error');
                return;
            }

            console.log('[VERO] 🤖 Gemini raw response:', geminiRes.data?.substring(0, 200));
            const result = parseGeminiJSON(geminiRes.data);
            console.log('[VERO] 📊 Result:', result);

            if (pibInfo?.searchUrl && result.label !== 'VERIFIED') {
                result.pibUrl = pibInfo.searchUrl;
            }

            el.setAttribute('data-vero', result.label?.toLowerCase() || 'unknown');
            bgMessage('UPDATE_STATS', { field: 'message', flagged: result.isFake || result.isMisleading });

            if (result.isFake || result.isMisleading) {
                console.log(`%c[VERO] 🚨 FLAGGED: ${result.label} (${result.confidence}%)`, 'color: #e53935; font-weight: bold;');
                injectBadge(el, result);
            } else {
                console.log(`[VERO] ✅ Clean: ${result.label}`);
            }
        } catch (err) {
            console.error('[VERO] ❌ Analysis error:', err);
            removeIndicator(el);
            el.setAttribute('data-vero', 'error');
        }
    }

    // ─── Extract text from a message element ──────────────────
    function extractText(el) {
        // Try multiple WhatsApp text selectors
        const textSelectors = [
            'span.selectable-text span',     // Common WhatsApp text container
            '.copyable-text span[dir]',
            '[data-testid="text-message"]',
            'span[dir="ltr"]',
            'span[dir="rtl"]',
            'span.selectable-text',
        ];

        for (const sel of textSelectors) {
            const found = el.querySelector(sel);
            if (found?.innerText?.trim()?.length > 10) {
                return found.innerText.trim();
            }
        }

        // Last resort: get all direct text from spans
        const allSpans = el.querySelectorAll('span[dir]');
        for (const sp of allSpans) {
            const t = sp.innerText?.trim();
            if (t && t.length > 15) return t;
        }

        return null;
    }

    // ─── UI Injection ─────────────────────────────────────────
    function showIndicator(el) {
        const ind = document.createElement('div');
        ind.className = 'vero-pulse-shield';
        ind.textContent = '🛡️';
        ind.style.cssText = 'position:absolute;top:4px;right:4px;';
        el.style.position = 'relative';
        el.appendChild(ind);
        el._vind = ind;
    }

    function removeIndicator(el) { el._vind?.remove(); }

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
        console.log('[VERO] 🏷️ Badge injected into message');
    }

    // ─── Helpers ──────────────────────────────────────────────
    function bgMessage(type, payload) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type, ...payload }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.error('[VERO] sendMessage error:', chrome.runtime.lastError.message);
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(res || { success: false });
                    }
                });
            } catch (err) {
                console.error('[VERO] sendMessage exception:', err);
                resolve({ success: false, error: err.message });
            }
        });
    }

    function parseGeminiJSON(raw) {
        if (!raw || typeof raw !== 'string') return { isFake: false, label: 'UNKNOWN', confidence: 0 };
        try {
            // Remove markdown code fences if present
            let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const match = cleaned.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : { isFake: false, label: 'UNKNOWN', confidence: 0 };
        } catch (e) {
            console.error('[VERO] JSON parse error:', e, 'Raw:', raw?.substring(0, 200));
            return { isFake: false, label: 'UNKNOWN', confidence: 0 };
        }
    }

    console.log('%c[VERO] 🛡️ WhatsApp content script loaded ✓', 'color: #34a853; font-weight: bold; font-size: 14px;');
})();
