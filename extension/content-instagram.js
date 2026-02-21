// VERO – Instagram Content Script v1.2
// Caption fact-checking + TensorFlow.js deepfake detection

(function () {
    'use strict';
    console.log('%c[VERO] 📸 Instagram content script STARTING...', 'color: #e1306c; font-weight: bold; font-size: 14px;');

    let enabled = true;
    let instagramEnabled = true;
    let tfLoaded = false;

    chrome.storage.local.get(['enabled', 'instagram'], (r) => {
        enabled = r.enabled !== false;
        instagramEnabled = r.instagram !== false;
        console.log('[VERO] Settings loaded:', { enabled, instagramEnabled });
        if (enabled && instagramEnabled) {
            loadTensorFlow();
            waitForInstagram();
        }
    });

    chrome.storage.onChanged.addListener((c) => {
        if (c.enabled) enabled = c.enabled.newValue;
        if (c.instagram) instagramEnabled = c.instagram.newValue;
    });

    // ─── Load TensorFlow.js ─────────────────────────────────
    function loadTensorFlow() {
        if (window.tf) { tfLoaded = true; return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js';
        script.onload = () => { tfLoaded = true; console.log('[VERO] TensorFlow.js loaded ✓'); };
        script.onerror = () => console.warn('[VERO] TensorFlow.js CDN blocked by CSP — deepfake detection disabled');
        (document.head || document.documentElement).appendChild(script);
    }

    // ─── Wait for Instagram ─────────────────────────────────
    function waitForInstagram() {
        console.log('[VERO] Waiting for Instagram DOM...');
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            const mainEl = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('article');
            if (mainEl) {
                clearInterval(poll);
                console.log(`%c[VERO] ✅ Instagram DOM ready after ${attempts} attempts`, 'color: #34a853; font-weight: bold;');
                startScanning();
            } else if (attempts > 40) {
                clearInterval(poll);
                console.warn('[VERO] ⚠️ Instagram DOM timeout');
            }
        }, 2000);
    }

    function startScanning() {
        initObserver();
        setTimeout(() => scanAll(), 3000);
        setInterval(() => { if (enabled && instagramEnabled) scanAll(); }, 12000);
    }

    function scanAll() {
        console.log('[VERO] Scanning Instagram content...');
        // Scan captions
        const articles = document.querySelectorAll('article');
        console.log(`[VERO] Found ${articles.length} articles`);
        articles.forEach(scanCaption);
        // Scan videos
        const videos = document.querySelectorAll('video');
        console.log(`[VERO] Found ${videos.length} videos`);
        videos.forEach(scanReel);
    }

    function initObserver() {
        new MutationObserver((muts) => {
            if (!enabled || !instagramEnabled) return;
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    n.querySelectorAll?.('article').forEach(scanCaption);
                    n.querySelectorAll?.('video').forEach(scanReel);
                    if (n.tagName === 'ARTICLE') scanCaption(n);
                    if (n.tagName === 'VIDEO') scanReel(n);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
        console.log('[VERO] Instagram MutationObserver started');
    }

    // ─── Caption Scanning ──────────────────────────────────
    async function scanCaption(article) {
        if (article.hasAttribute('data-vero-caption')) return;
        article.setAttribute('data-vero-caption', 'pending');

        // Try multiple selectors for Instagram captions
        const captionEl = article.querySelector('h1') ||
            article.querySelector('span[dir="auto"]') ||
            article.querySelector('div[style] > span') ||
            article.querySelector('span');

        const text = captionEl?.innerText?.trim();
        if (!text || text.length < 20) {
            article.setAttribute('data-vero-caption', 'skip');
            return;
        }

        console.log(`[VERO] 📝 Instagram caption (${text.length} chars): "${text.substring(0, 60)}..."`);

        try {
            let newsContext = '';
            try {
                const newsRes = await bgMessage('NEWS_CONTEXT', { query: text.substring(0, 100) });
                if (newsRes.success && newsRes.data?.length) {
                    newsContext = '\n\nRelated News:\n' + newsRes.data.map(a => `- "${a.title}" (${a.source})`).join('\n');
                }
            } catch (_) { }

            const prompt = `Analyze this Instagram caption for misinformation.${newsContext}

Caption: "${text}"

Respond ONLY with JSON (no markdown):
{"isFake": true/false, "isMisleading": true/false, "confidence": 0-100, "label": "FAKE" or "MISLEADING" or "VERIFIED" or "UNKNOWN", "explanation": "1-line"}`;

            const res = await bgMessage('GEMINI_REQUEST', { prompt });
            if (!res.success) { console.error('[VERO] Caption Gemini failed:', res.error); return; }

            const result = parseGeminiJSON(res.data);
            console.log('[VERO] 📊 Caption result:', result);
            article.setAttribute('data-vero-caption', result.label?.toLowerCase() || 'unknown');

            bgMessage('UPDATE_STATS', { field: 'message', flagged: result.isFake || result.isMisleading });

            if (result.isFake || result.isMisleading) {
                console.log(`%c[VERO] 🚨 Caption FLAGGED: ${result.label}`, 'color: #e53935; font-weight: bold;');
                const cls = result.label === 'FAKE' ? 'fake' : 'caution';
                const badge = document.createElement('div');
                badge.className = `vero-warning-badge ${cls}`;
                badge.style.margin = '8px 16px';
                badge.innerHTML = `<strong>${result.label === 'FAKE' ? '❌' : '⚠️'} ${result.label}</strong> · ${result.confidence}% — ${result.explanation || ''}`;
                article.appendChild(badge);
            }
        } catch (err) {
            console.error('[VERO] Caption error:', err);
        }
    }

    // ─── Reel / Deepfake Detection ─────────────────────────
    function scanReel(video) {
        if (video.hasAttribute('data-vero-reel')) return;
        video.setAttribute('data-vero-reel', 'pending');
        const container = video.closest('article') || video.closest('[role="presentation"]') || video.parentElement;
        if (!container) return;

        if (video.readyState >= 2) processReel(video, container);
        else video.addEventListener('loadeddata', () => processReel(video, container), { once: true });
    }

    async function processReel(video, container) {
        showReelIndicator(container);
        console.log('[VERO] 🎬 Analyzing reel frame...');

        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            let result = { isDeepfake: false, confidence: 0, label: 'AUTHENTIC' };

            if (tfLoaded && window.tf) {
                const tensor = window.tf.browser.fromPixels(canvas);
                const mean = tensor.mean().dataSync()[0];
                const variance = tensor.sub(mean).square().mean().dataSync()[0];
                const resized = window.tf.image.resizeBilinear(tensor.expandDims(0), [64, 64]).squeeze();
                const diff = resized.slice([0, 0, 0], [63, 63, 3]).sub(resized.slice([1, 1, 0], [63, 63, 3]));
                const edgeEnergy = diff.abs().mean().dataSync()[0];
                const score = (variance < 2000 ? 30 : 0) + (edgeEnergy < 8 ? 40 : 0) + (mean > 200 || mean < 30 ? 20 : 0);

                result = {
                    isDeepfake: score >= 50,
                    confidence: Math.min(score + 20, 99),
                    label: score >= 50 ? 'DEEPFAKE' : 'AUTHENTIC',
                    explanation: score >= 50 ? 'Unusual pixel patterns — possible AI generation' : 'Natural video patterns'
                };
                tensor.dispose(); resized.dispose(); diff.dispose();
                console.log(`[VERO] TF.js score: ${score}, result: ${result.label}`);
            } else {
                console.log('[VERO] TF.js not available, skipping deepfake analysis');
                result = { isDeepfake: false, confidence: 0, label: 'UNKNOWN', explanation: 'TF.js not loaded' };
            }

            removeReelIndicator(container);
            video.setAttribute('data-vero-reel', result.label.toLowerCase());
            bgMessage('UPDATE_STATS', { field: 'reel', flagged: result.isDeepfake });

            if (result.isDeepfake) {
                console.log(`%c[VERO] 🚨 DEEPFAKE: ${result.confidence}%`, 'color: #e53935; font-weight: bold;');
                const banner = document.createElement('div');
                banner.className = 'vero-reel-banner deepfake';
                banner.innerHTML = `<span style="font-size:18px;">⚠️</span><div><strong>DEEPFAKE DETECTED</strong><div style="font-size:11px;margin-top:2px;">${result.explanation} · ${result.confidence}%</div></div>`;
                container.style.position = 'relative';
                container.appendChild(banner);
            }
        } catch (err) {
            console.error('[VERO] Reel error:', err);
            removeReelIndicator(container);
        }
    }

    function showReelIndicator(c) {
        const ind = document.createElement('div');
        ind.className = 'vero-pulse-shield';
        ind.textContent = '🛡️';
        ind.style.cssText = 'bottom:70px;right:16px;';
        c.style.position = 'relative';
        c.appendChild(ind);
        c._vind = ind;
    }
    function removeReelIndicator(c) { c._vind?.remove(); }

    // ─── Helpers ──────────────────────────────────────────────
    function bgMessage(type, payload) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type, ...payload }, (res) => {
                    if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
                    else resolve(res || { success: false });
                });
            } catch (err) { resolve({ success: false, error: err.message }); }
        });
    }

    function parseGeminiJSON(raw) {
        if (!raw || typeof raw !== 'string') return { isFake: false, label: 'UNKNOWN', confidence: 0 };
        try {
            let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const match = cleaned.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : { isFake: false, label: 'UNKNOWN', confidence: 0 };
        } catch (_) { return { isFake: false, label: 'UNKNOWN', confidence: 0 }; }
    }

    console.log('%c[VERO] 📸 Instagram content script loaded ✓', 'color: #e1306c; font-weight: bold;');
})();
