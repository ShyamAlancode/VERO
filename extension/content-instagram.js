// VERO – Instagram Content Script v1.3
// Caption fact-checking + Canvas-based deepfake detection (no external deps)

(function () {
    'use strict';
    console.log('%c[VERO] 📸 Instagram content script STARTING...', 'color: #e1306c; font-weight: bold; font-size: 14px;');

    let enabled = true;
    let instagramEnabled = true;

    chrome.storage.local.get(['enabled', 'instagram'], (r) => {
        enabled = r.enabled !== false;
        instagramEnabled = r.instagram !== false;
        console.log('[VERO] Settings loaded:', { enabled, instagramEnabled });
        if (enabled && instagramEnabled) waitForInstagram();
    });

    chrome.storage.onChanged.addListener((c) => {
        if (c.enabled) enabled = c.enabled.newValue;
        if (c.instagram) instagramEnabled = c.instagram.newValue;
    });

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
        const articles = document.querySelectorAll('article');
        console.log(`[VERO] Scanning: ${articles.length} articles`);
        articles.forEach(scanCaption);
        const videos = document.querySelectorAll('video');
        console.log(`[VERO] Scanning: ${videos.length} videos`);
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

        const captionEl = article.querySelector('h1') ||
            article.querySelector('span[dir="auto"]') ||
            article.querySelector('div[style] > span') ||
            article.querySelector('span');

        const text = captionEl?.innerText?.trim();
        if (!text || text.length < 20) { article.setAttribute('data-vero-caption', 'skip'); return; }

        console.log(`[VERO] 📝 Caption (${text.length} chars): "${text.substring(0, 60)}..."`);

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

    // ─── Reel / Deepfake Detection (Pure Canvas – no TF.js) ──
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
        console.log('[VERO] 🎬 Analyzing reel frame (Canvas)...');

        try {
            const w = Math.min(video.videoWidth || 320, 320);
            const h = Math.min(video.videoHeight || 240, 240);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            const pixels = imageData.data; // RGBA array

            // ── Pixel Analysis (pure JS, no TF.js) ──
            let totalR = 0, totalG = 0, totalB = 0;
            let count = pixels.length / 4;

            // 1. Calculate mean RGB
            for (let i = 0; i < pixels.length; i += 4) {
                totalR += pixels[i];
                totalG += pixels[i + 1];
                totalB += pixels[i + 2];
            }
            const meanR = totalR / count;
            const meanG = totalG / count;
            const meanB = totalB / count;
            const overallMean = (meanR + meanG + meanB) / 3;

            // 2. Calculate variance
            let varianceSum = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const diff = ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3) - overallMean;
                varianceSum += diff * diff;
            }
            const variance = varianceSum / count;

            // 3. Calculate edge energy (gradient magnitude)
            let edgeSum = 0, edgeCount = 0;
            for (let y = 0; y < h - 1; y++) {
                for (let x = 0; x < w - 1; x++) {
                    const idx = (y * w + x) * 4;
                    const idxR = idx + 4;        // right neighbor
                    const idxD = ((y + 1) * w + x) * 4; // down neighbor
                    for (let c = 0; c < 3; c++) {
                        const dx = Math.abs(pixels[idx + c] - pixels[idxR + c]);
                        const dy = Math.abs(pixels[idx + c] - pixels[idxD + c]);
                        edgeSum += dx + dy;
                    }
                    edgeCount++;
                }
            }
            const edgeEnergy = edgeCount > 0 ? edgeSum / (edgeCount * 3) : 0;

            // 4. Color uniformity check
            const colorRange = Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB);

            // 5. Score calculation
            let score = 0;
            if (variance < 1500) score += 25;       // Very low variance = suspicious
            if (variance < 800) score += 15;        // Extremely low = very suspicious
            if (edgeEnergy < 6) score += 30;        // Smooth edges = AI-generated
            if (edgeEnergy < 3) score += 10;        // Very smooth
            if (overallMean > 210 || overallMean < 25) score += 15;  // Extreme brightness
            if (colorRange < 10) score += 10;        // Very uniform colors

            const isDeepfake = score >= 50;

            console.log(`[VERO] 🔬 Frame analysis: variance=${variance.toFixed(0)}, edgeEnergy=${edgeEnergy.toFixed(1)}, mean=${overallMean.toFixed(0)}, colorRange=${colorRange.toFixed(0)}, score=${score}`);

            const result = {
                isDeepfake,
                confidence: Math.min(score + 15, 99),
                label: isDeepfake ? 'DEEPFAKE' : 'AUTHENTIC',
                explanation: isDeepfake ? 'Unusual pixel uniformity — possible AI-generated content' : 'Natural video patterns detected'
            };

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
            } else {
                console.log(`[VERO] ✅ Reel looks authentic (score: ${score})`);
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
