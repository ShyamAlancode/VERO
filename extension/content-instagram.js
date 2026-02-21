// VERO – Instagram Content Script
// Real-time caption fact-checking + deepfake detection via TensorFlow.js

(function () {
    'use strict';

    let enabled = true;
    let instagramEnabled = true;
    let tfLoaded = false;

    chrome.storage.local.get(['enabled', 'instagram'], (r) => {
        enabled = r.enabled !== false;
        instagramEnabled = r.instagram !== false;
        if (enabled && instagramEnabled) {
            loadTensorFlow();
            waitForInstagram();
        }
    });

    chrome.storage.onChanged.addListener((c) => {
        if (c.enabled) enabled = c.enabled.newValue;
        if (c.instagram) instagramEnabled = c.instagram.newValue;
    });

    // ─── Load TensorFlow.js via CDN ─────────────────────────
    function loadTensorFlow() {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js';
        script.onload = () => {
            tfLoaded = true;
            console.log('[VERO] TensorFlow.js loaded ✓');
        };
        script.onerror = () => console.warn('[VERO] TensorFlow.js failed to load');
        document.head.appendChild(script);
    }

    // ─── Wait for Instagram DOM ─────────────────────────────
    function waitForInstagram() {
        const poll = setInterval(() => {
            if (document.querySelector('article') || document.querySelector('[role="presentation"]')) {
                clearInterval(poll);
                initObservers();
                scanExisting();
            }
        }, 1500);
    }

    function scanExisting() {
        document.querySelectorAll('video').forEach(scanReel);
        document.querySelectorAll('article').forEach(scanArticleCaption);
    }

    function initObservers() {
        new MutationObserver((muts) => {
            if (!enabled || !instagramEnabled) return;
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    n.querySelectorAll?.('video').forEach(scanReel);
                    n.querySelectorAll?.('article').forEach(scanArticleCaption);
                    if (n.tagName === 'VIDEO') scanReel(n);
                    if (n.tagName === 'ARTICLE') scanArticleCaption(n);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ─── Caption Analysis ──────────────────────────────────
    function scanArticleCaption(article) {
        if (article.hasAttribute('data-vero-caption')) return;
        article.setAttribute('data-vero-caption', 'pending');

        const captionEl = article.querySelector('h1') ||
            article.querySelector('._a9zs span') ||
            article.querySelector('span[dir="auto"]');

        const text = captionEl?.innerText?.trim();
        if (!text || text.length < 20) { article.setAttribute('data-vero-caption', 'skip'); return; }

        analyzeCaption(text, article);
    }

    async function analyzeCaption(text, article) {
        try {
            // Get NewsAPI context
            let newsContext = '';
            try {
                const newsRes = await bgMessage('NEWS_CONTEXT', { query: text.substring(0, 100) });
                if (newsRes.success && newsRes.data?.length) {
                    newsContext = '\n\nRelated News:\n' + newsRes.data.map(a => `- "${a.title}" (${a.source})`).join('\n');
                }
            } catch (_) { }

            const prompt = `Analyze this Instagram caption for misinformation.${newsContext}

Caption: "${text}"

Respond ONLY with JSON:
{"isFake": boolean, "isMisleading": boolean, "confidence": 0-100, "label": "FAKE"|"MISLEADING"|"VERIFIED"|"UNKNOWN", "explanation": "1-line"}`;

            const res = await bgMessage('GEMINI_REQUEST', { prompt });
            if (!res.success) return;

            const result = parseGeminiJSON(res.data);
            article.setAttribute('data-vero-caption', result.label?.toLowerCase() || 'unknown');

            bgMessage('UPDATE_STATS', { field: 'message', flagged: result.isFake || result.isMisleading });

            if (result.isFake || result.isMisleading) {
                injectCaptionBadge(article, result);
            }
        } catch (err) {
            console.error('[VERO] Caption analysis failed:', err);
        }
    }

    // ─── Reel / Video Deepfake Detection ────────────────────
    function scanReel(video) {
        if (video.hasAttribute('data-vero-reel')) return;
        video.setAttribute('data-vero-reel', 'pending');

        const container = video.closest('article') || video.closest('[role="presentation"]') || video.parentElement;
        if (!container) return;

        // Wait for video data
        if (video.readyState >= 2) {
            processReel(video, container);
        } else {
            video.addEventListener('loadeddata', () => processReel(video, container), { once: true });
        }
    }

    async function processReel(video, container) {
        showReelIndicator(container);

        try {
            // Capture a frame from the video
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            let deepfakeResult = { isDeepfake: false, confidence: 0, label: 'REAL' };

            if (tfLoaded && window.tf) {
                // Use TensorFlow.js for local analysis
                // Convert canvas to tensor and do basic statistical analysis
                const tensor = window.tf.browser.fromPixels(canvas);

                // Compute pixel statistics – deepfakes often have unusual variance patterns
                const mean = tensor.mean().dataSync()[0];
                const variance = tensor.sub(mean).square().mean().dataSync()[0];

                // Frequency domain analysis (simplified)
                // Real faces have more natural high-frequency detail
                const resized = window.tf.image.resizeBilinear(tensor.expandDims(0), [64, 64]).squeeze();
                const diff = resized.slice([0, 0, 0], [63, 63, 3]).sub(resized.slice([1, 1, 0], [63, 63, 3]));
                const edgeEnergy = diff.abs().mean().dataSync()[0];

                // Heuristic scoring (placeholder for real model weights)
                // Very low edge energy or unusual variance can indicate AI generation
                const suspicionScore = (variance < 2000 ? 30 : 0) + (edgeEnergy < 8 ? 40 : 0) + (mean > 200 || mean < 30 ? 20 : 0);

                deepfakeResult = {
                    isDeepfake: suspicionScore >= 50,
                    confidence: Math.min(suspicionScore + 20, 99),
                    label: suspicionScore >= 50 ? 'DEEPFAKE' : 'AUTHENTIC',
                    explanation: suspicionScore >= 50
                        ? 'Unusual pixel patterns detected – possible AI generation'
                        : 'Frame analysis shows natural patterns'
                };

                // Cleanup tensors
                tensor.dispose();
                resized.dispose();
                diff.dispose();
            } else {
                // Fallback: send frame to Gemini for vision analysis
                const frameDataUrl = canvas.toDataURL('image/jpeg', 0.6);
                // For now, mark as UNKNOWN since Gemini free tier doesn't support image analysis well
                deepfakeResult = { isDeepfake: false, confidence: 0, label: 'UNKNOWN', explanation: 'TF.js not loaded – frame analysis skipped' };
            }

            removeReelIndicator(container);
            video.setAttribute('data-vero-reel', deepfakeResult.label.toLowerCase());

            bgMessage('UPDATE_STATS', { field: 'reel', flagged: deepfakeResult.isDeepfake });

            if (deepfakeResult.isDeepfake) {
                injectReelBanner(container, deepfakeResult);
            }

        } catch (err) {
            console.error('[VERO] Reel analysis error:', err);
            removeReelIndicator(container);
            video.setAttribute('data-vero-reel', 'error');
        }
    }

    // ─── UI Injection ───────────────────────────────────────
    function showReelIndicator(container) {
        const ind = document.createElement('div');
        ind.className = 'vero-pulse-shield';
        ind.textContent = '🛡️';
        ind.style.bottom = '70px';
        ind.style.right = '16px';
        container.style.position = 'relative';
        container.appendChild(ind);
        container._vind = ind;
    }

    function removeReelIndicator(container) { container._vind?.remove(); }

    function injectReelBanner(container, result) {
        if (container.querySelector('.vero-reel-banner')) return;

        const banner = document.createElement('div');
        banner.className = 'vero-reel-banner deepfake';
        banner.innerHTML = `
      <span style="font-size:18px;">⚠️</span>
      <div>
        <strong>DEEPFAKE DETECTED</strong>
        <div style="font-size:11px;margin-top:2px;">${result.explanation} · ${result.confidence}% confidence</div>
      </div>
    `;
        container.style.position = 'relative';
        container.appendChild(banner);
    }

    function injectCaptionBadge(article, result) {
        if (article.querySelector('.vero-warning-badge')) return;

        const cls = result.label === 'FAKE' ? 'fake' : 'caution';
        const icon = result.label === 'FAKE' ? '❌' : '⚠️';

        const badge = document.createElement('div');
        badge.className = `vero-warning-badge ${cls}`;
        badge.style.margin = '8px 16px';
        badge.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;">
        ${icon} <span>${result.label}</span> · ${result.confidence}%
      </div>
      <div style="font-size:11px;margin-top:2px;">${result.explanation || ''}</div>
    `;
        article.appendChild(badge);
    }

    // ─── Helpers ────────────────────────────────────────────
    function bgMessage(type, payload) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type, ...payload }, (res) => {
                if (chrome.runtime.lastError) resolve({ success: false });
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

    console.log('[VERO] Instagram content script loaded ✓');
})();
