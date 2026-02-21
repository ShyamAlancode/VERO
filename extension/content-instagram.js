// VERO – Instagram Content Script v1.4
// Caption fact-checking + Canvas deepfake detection (rate-limited)

(function () {
    'use strict';
    console.log('%c[VERO] 📸 Instagram content script STARTING...', 'color: #e1306c; font-weight: bold; font-size: 14px;');

    let enabled = true;
    let instagramEnabled = true;

    // ─── Rate Limiter: process 1 item at a time, 3s gap ──
    const queue = [];
    let processing = false;

    function enqueueCaption(article) {
        if (contextDead || article.hasAttribute('data-vero-caption')) return;
        article.setAttribute('data-vero-caption', 'queued');
        queue.push({ type: 'caption', el: article });
        if (!processing) drainQueue();
    }

    async function drainQueue() {
        processing = true;
        while (queue.length > 0) {
            if (contextDead) { queue.length = 0; break; }
            const item = queue.shift();
            let status = 'ok';
            if (item.type === 'caption') status = await scanCaption(item.el);
            if (status === 'rate-limited') {
                item.el.removeAttribute('data-vero-caption');
                queue.unshift(item);
                console.log('[VERO] ⏸️ Queue paused for 65s (rate limited)');
                await sleep(65000);
            } else {
                await sleep(8000); // 8s between requests
            }
        }
        processing = false;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ─── Init ──────────────────────────────────────────────────
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
        setTimeout(() => { if (!contextDead) scanAll(); }, 3000);
        // Scan every 30s instead of 12s
        setInterval(() => { if (!contextDead && enabled && instagramEnabled) scanAll(); }, 30000);
    }

    function scanAll() {
        const articles = document.querySelectorAll('article');
        const unprocessed = [...articles].filter(a => !a.hasAttribute('data-vero-caption'));
        // Only queue last 3 unprocessed
        const toProcess = unprocessed.slice(-3);
        console.log(`[VERO] Scanning: ${articles.length} articles, ${unprocessed.length} unprocessed, queuing ${toProcess.length}`);
        toProcess.forEach(enqueueCaption);

        // Reels (no Gemini call, just Canvas analysis)
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
                    n.querySelectorAll?.('article').forEach(enqueueCaption);
                    n.querySelectorAll?.('video').forEach(scanReel);
                    if (n.tagName === 'ARTICLE') enqueueCaption(n);
                    if (n.tagName === 'VIDEO') scanReel(n);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
        console.log('[VERO] Instagram MutationObserver started');
    }

    // ─── Caption Scanning ──────────────────────────────────
    async function scanCaption(article) {
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

            console.log('[VERO] 🤖 Calling Gemini for caption...');
            const res = await bgMessage('GEMINI_REQUEST', { prompt });
            if (!res.success) {
                const err = res.error || '';
                if (err.includes('Rate limited') || err.includes('API paused') || err.includes('Pausing')) {
                    console.warn('[VERO] ⏸️ Caption rate limited — will retry later');
                    return 'rate-limited';
                }
                if (err !== 'Context dead') console.error('[VERO] Caption Gemini failed:', err);
                article.setAttribute('data-vero-caption', 'error');
                return 'error';
            }

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

    // ─── Reel / Deepfake Detection (Pure Canvas) ─────────────
    function scanReel(video) {
        if (contextDead || video.hasAttribute('data-vero-reel')) return;
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
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);
            const pixels = ctx.getImageData(0, 0, w, h).data;

            let totalR = 0, totalG = 0, totalB = 0, count = pixels.length / 4;
            for (let i = 0; i < pixels.length; i += 4) {
                totalR += pixels[i]; totalG += pixels[i + 1]; totalB += pixels[i + 2];
            }
            const meanR = totalR / count, meanG = totalG / count, meanB = totalB / count;
            const overallMean = (meanR + meanG + meanB) / 3;

            let varianceSum = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const diff = ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3) - overallMean;
                varianceSum += diff * diff;
            }
            const variance = varianceSum / count;

            let edgeSum = 0, edgeCount = 0;
            for (let y = 0; y < h - 1; y++) {
                for (let x = 0; x < w - 1; x++) {
                    const idx = (y * w + x) * 4;
                    for (let c = 0; c < 3; c++) {
                        edgeSum += Math.abs(pixels[idx + c] - pixels[idx + 4 + c]) + Math.abs(pixels[idx + c] - pixels[((y + 1) * w + x) * 4 + c]);
                    }
                    edgeCount++;
                }
            }
            const edgeEnergy = edgeCount > 0 ? edgeSum / (edgeCount * 3) : 0;
            const colorRange = Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB);

            let score = 0;
            if (variance < 1500) score += 25;
            if (variance < 800) score += 15;
            if (edgeEnergy < 6) score += 30;
            if (edgeEnergy < 3) score += 10;
            if (overallMean > 210 || overallMean < 25) score += 15;
            if (colorRange < 10) score += 10;

            const isDeepfake = score >= 50;
            console.log(`[VERO] 🔬 Frame: variance=${variance.toFixed(0)}, edge=${edgeEnergy.toFixed(1)}, score=${score}`);

            removeReelIndicator(container);
            video.setAttribute('data-vero-reel', isDeepfake ? 'deepfake' : 'authentic');
            bgMessage('UPDATE_STATS', { field: 'reel', flagged: isDeepfake });

            if (isDeepfake) {
                const banner = document.createElement('div');
                banner.className = 'vero-reel-banner deepfake';
                banner.innerHTML = `<span style="font-size:18px;">⚠️</span><div><strong>DEEPFAKE DETECTED</strong><div style="font-size:11px;margin-top:2px;">Unusual pixel uniformity · ${Math.min(score + 15, 99)}%</div></div>`;
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
        ind.className = 'vero-pulse-shield'; ind.textContent = '🛡️';
        ind.style.cssText = 'bottom:70px;right:16px;';
        c.style.position = 'relative'; c.appendChild(ind); c._vind = ind;
    }
    function removeReelIndicator(c) { c._vind?.remove(); }

    // ─── Helpers ──────────────────────────────────────────────
    let contextDead = false;

    function bgMessage(type, payload) {
        if (contextDead) return Promise.resolve({ success: false, error: 'Context dead' });
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type, ...payload }, (res) => {
                    if (chrome.runtime.lastError) {
                        const err = chrome.runtime.lastError.message || '';
                        if (err.includes('invalidated')) { killScript(); }
                        resolve({ success: false, error: err });
                    } else { resolve(res || { success: false }); }
                });
            } catch (err) {
                if (err.message?.includes('invalidated')) { killScript(); }
                resolve({ success: false, error: err.message });
            }
        });
    }

    function killScript() {
        if (contextDead) return;
        contextDead = true;
        queue.length = 0;
        processing = false;
        console.log('%c[VERO] 🔴 Extension was reloaded. Refresh this page (Ctrl+Shift+R) to reconnect.', 'color: #e53935; font-weight: bold; font-size: 14px;');
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
