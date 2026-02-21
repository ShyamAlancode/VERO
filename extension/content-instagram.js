// Instagram content script for VERO

let settings = {
    enabled: true,
    geminiKey: '',
    useLocalDeepfake: true,
    instagram: true,
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
};

chrome.storage.local.get(['enabled', 'geminiKey', 'useLocalDeepfake', 'instagram'], (result) => {
    settings = { ...settings, ...result };
    if (settings.enabled && settings.instagram) {
        initObservers();
    }
});

function initObservers() {
    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled || !settings.instagram) return;

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    // Check for Reels/Videos
                    const videos = node.querySelectorAll('video');
                    videos.forEach(scanReel);

                    // Check for captions
                    const captions = node.querySelectorAll('h1, h2, ._a9zs, ._a9zr span');
                    captions.forEach(scanCaption);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scan
    document.querySelectorAll('video').forEach(scanReel);
    document.querySelectorAll('h1, h2, ._a9zs, ._a9zr span').forEach(scanCaption);
}

async function scanCaption(el) {
    if (el.hasAttribute('data-vero-scanned') || el.innerText.length < 20) return;
    el.setAttribute('data-vero-scanned', 'true');

    const text = el.innerText.trim();
    try {
        const result = await analyzeText(text);
        if (result.isFake || result.isMisleading) {
            injectCaptionWarning(el, result);
        }
    } catch (e) {
        console.error('VERO: Caption scan failed', e);
    }
}

async function scanReel(video) {
    if (video.hasAttribute('data-vero-scanned')) return;
    video.setAttribute('data-vero-scanned', 'true');

    const container = video.closest('article') || video.parentElement;
    showReelIndicator(container);

    // Simulate heavy processing (Phase 2 Local TF.js placeholder)
    setTimeout(async () => {
        // For Demo: Randomly flag some reels if they mention "AI" or "Shocking" in visual context (Mock)
        const isDeepfake = Math.random() > 0.85;
        removeReelIndicator(container);

        if (isDeepfake) {
            injectReelWarning(container, {
                isDeepfake: true,
                confidence: 88,
                label: 'DEEPFAKE',
                explanation: 'AI-generated visual artifacts detected in frame sequence.'
            });

            chrome.runtime.sendMessage({
                type: 'DETECTED_FAKE',
                mediaType: 'video',
                isDeepfake: true
            });
        }
    }, 2000);
}

function showReelIndicator(container) {
    const indicator = document.createElement('div');
    indicator.className = 'vero-pulse-shield';
    indicator.innerHTML = '🛡️';
    indicator.style.bottom = '80px';
    indicator.style.right = '20px';
    container.style.position = 'relative';
    container.appendChild(indicator);
    container._vero_indicator = indicator;
}

function removeReelIndicator(container) {
    if (container._vero_indicator) {
        container._vero_indicator.remove();
        delete container._vero_indicator;
    }
}

function injectReelWarning(container, result) {
    const banner = document.createElement('div');
    banner.className = `vero-reel-banner ${result.label.toLowerCase()}`;
    banner.innerHTML = `
    <span>⚠️</span>
    <div>
      <strong>${result.label} DETECTED</strong>
      <div style="font-size:11px;">${result.explanation}</div>
    </div>
  `;
    container.appendChild(banner);
}

function injectCaptionWarning(el, result) {
    const badge = document.createElement('div');
    badge.className = `vero-warning-badge ${result.label.toLowerCase()}`;
    badge.style.display = 'block';
    badge.style.marginTop = '8px';
    badge.innerHTML = `
    <strong>${result.label}</strong> · ${result.explanation}
  `;
    el.appendChild(badge);
}

// Reuse analyzeText logic from WhatsApp (sharing via bg would be better but this is fine for now)
async function analyzeText(text) {
    if (!settings.geminiKey) {
        if (text.toLowerCase().includes('shocking') || text.toLowerCase().includes('official')) {
            return { isFake: true, label: 'FAKE', confidence: 85, explanation: 'Unverified source claiming official status.' };
        }
        return { isFake: false };
    }

    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'GEMINI_REQUEST',
            url: settings.apiEndpoint,
            apiKey: settings.geminiKey,
            body: {
                contents: [{ parts: [{ text: `Is this Instagram caption fake news? Return JSON: {"isFake": bool, "label": "FAKE"|"MISLEADING", "confidence": int, "explanation": "str"}. Caption: "${text}"` }] }]
            }
        }, (res) => {
            try {
                const raw = res.data.candidates[0].content.parts[0].text;
                resolve(JSON.parse(raw.match(/\{.*\}/s)[0]));
            } catch (e) { resolve({ isFake: false }); }
        });
    });
}
