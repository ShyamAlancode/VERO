// Instagram content script for VERO

let settings = {
    enabled: true,
    geminiKey: '',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    useLocalDeepfake: true,
    privacyMode: true
};

// Load settings
chrome.storage.local.get(['enabled', 'geminiKey', 'apiEndpoint', 'useLocalDeepfake', 'privacyMode'], (result) => {
    settings = { ...settings, ...result };
});

// Listen for changes
chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.geminiKey) settings.geminiKey = changes.geminiKey.newValue;
    if (changes.apiEndpoint) settings.apiEndpoint = changes.apiEndpoint.newValue;
    if (changes.useLocalDeepfake) settings.useLocalDeepfake = changes.useLocalDeepfake.newValue;
});

// Load TensorFlow.js for local deepfake detection
let tf;

async function loadTensorFlow() {
    if (!settings.useLocalDeepfake) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js';
        script.onload = () => {
            tf = window.tf;
            console.log('[VERO] TensorFlow.js loaded');
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

loadTensorFlow().catch(console.error);

// Wait for Instagram to load
function waitForInstagram() {
    const interval = setInterval(() => {
        const reelContainer = document.querySelector('article') ||
            document.querySelector('._aagv') ||
            document.querySelector('div[role="presentation"]');
        if (reelContainer) {
            clearInterval(interval);
            initReelObserver();
            initCaptionObserver();
        }
    }, 1000);
}

// Observe reels
function initReelObserver() {
    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled) return;
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const videos = node.querySelectorAll?.('video') || [];
                    videos.forEach(video => {
                        if (!video.hasAttribute('data-vero-scanned')) {
                            setTimeout(() => scanReel(video), 500);
                        }
                    });
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        document.querySelectorAll('video').forEach(video => {
            if (!video.hasAttribute('data-vero-scanned')) scanReel(video);
        });
    }, 2000);
}

// Observe captions
function initCaptionObserver() {
    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled) return;
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const captions = node.querySelectorAll?.('._a9zr, ._a9zs, span[dir="auto"]') || [];
                    captions.forEach(caption => {
                        if (caption.innerText && caption.innerText.length > 20) {
                            if (!caption.hasAttribute('data-vero-caption-scanned')) {
                                caption.setAttribute('data-vero-caption-scanned', 'true');
                                setTimeout(() => scanCaption(caption), 300);
                            }
                        }
                    });
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Scan reel video
async function scanReel(videoElement) {
    if (!settings.enabled) return;
    if (videoElement.hasAttribute('data-vero-scanned')) return;
    videoElement.setAttribute('data-vero-scanned', 'true');

    if (videoElement.readyState < 2) {
        videoElement.addEventListener('loadeddata', () => processReel(videoElement), { once: true });
    } else {
        processReel(videoElement);
    }
}

async function processReel(videoElement) {
    showReelIndicator(videoElement);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth || 640;
        canvas.height = videoElement.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const frameDataUrl = canvas.toDataURL('image/jpeg', 0.7);

        const result = await analyzeVideoFrame(frameDataUrl);
        removeReelIndicator(videoElement);

        if (result.isDeepfake) {
            injectReelWarning(videoElement, result);
            chrome.runtime.sendMessage({ type: 'DETECTED_FAKE', mediaType: 'video', isDeepfake: true });
        }
    } catch (error) {
        console.error('[VERO] Reel analysis error:', error);
        removeReelIndicator(videoElement);
    }
}

// Scan caption
async function scanCaption(captionElement) {
    if (!settings.enabled) return;
    const captionText = captionElement.innerText.trim();
    if (!captionText || captionText.length < 15) return;

    const result = await analyzeText(captionText);
    if (result.isFake || result.isMisleading) {
        injectCaptionWarning(captionElement, result);
        chrome.runtime.sendMessage({ type: 'DETECTED_FAKE', mediaType: 'text', isFake: true });
    }
}

// Analyze video frame for deepfakes (mock in Phase 1 – wire model in Phase 2)
async function analyzeVideoFrame(frameDataUrl) {
    if (settings.useLocalDeepfake && tf) {
        // TODO Phase 2: Load EfficientNet-B4 ONNX deepfake model
        // Demo: return random result
        const isDeepfake = Math.random() > 0.85;
        return {
            isDeepfake,
            confidence: isDeepfake ? 80 + Math.floor(Math.random() * 15) : 15,
            label: isDeepfake ? 'DEEPFAKE' : 'REAL',
            explanation: isDeepfake ? 'AI-generated artifacts detected' : 'No manipulation detected'
        };
    }
    return { isDeepfake: false, confidence: 0, label: 'UNKNOWN', explanation: '' };
}

// Analyze text via Gemini (shared with WhatsApp logic)
async function analyzeText(text) {
    const prompt = `
You are a fact-checking AI for VERO. Analyze this Instagram caption for misinformation:

"${text}"

Respond with a JSON object only:
{
  "isFake": boolean,
  "isMisleading": boolean,
  "confidence": number (0-100),
  "label": "FAKE" or "MISLEADING" or "VERIFIED" or "UNKNOWN",
  "explanation": "Brief 1-line explanation",
  "source": "Source name or null",
  "sourceUrl": "URL or null"
}
  `.trim();

    if (!settings.geminiKey) {
        if (text.toLowerCase().includes('5000') || text.toLowerCase().includes('free money')) {
            return { isFake: true, isMisleading: true, confidence: 90, label: 'FAKE', explanation: 'No such scheme exists.', source: 'PIB Fact Check', sourceUrl: 'https://pib.gov.in/factcheck' };
        }
        return { isFake: false, isMisleading: false, confidence: 0, label: 'UNKNOWN', explanation: '', source: null, sourceUrl: null };
    }

    const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'GEMINI_REQUEST',
            url: settings.apiEndpoint,
            apiKey: settings.geminiKey,
            body: {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 256 }
            }
        }, (response) => {
            if (response?.success) resolve(response.data);
            else reject(new Error(response?.error || 'Unknown error'));
        });
    });

    try {
        const rawText = response.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('[VERO] Failed to parse Gemini response', e);
    }
    return { isFake: false, isMisleading: false, confidence: 0, label: 'UNKNOWN', explanation: '', source: null, sourceUrl: null };
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showReelIndicator(videoElement) {
    const reelContainer = videoElement.closest('article') ||
        videoElement.closest('._aagv') ||
        videoElement.parentElement;
    if (!reelContainer) return;

    const indicator = document.createElement('div');
    indicator.className = 'vero-pulse-shield';
    indicator.id = 'vero-reel-indicator-' + Date.now();
    indicator.innerHTML = '🛡️';
    indicator.style.bottom = '60px';
    indicator.style.right = '20px';

    if (getComputedStyle(reelContainer).position === 'static') {
        reelContainer.style.position = 'relative';
    }
    reelContainer.appendChild(indicator);
    videoElement.setAttribute('data-vero-indicator', indicator.id);
}

function removeReelIndicator(videoElement) {
    const indicatorId = videoElement.getAttribute('data-vero-indicator');
    if (indicatorId) {
        const indicator = document.getElementById(indicatorId);
        if (indicator) indicator.remove();
    }
}

function injectReelWarning(videoElement, result) {
    const reelContainer = videoElement.closest('article') ||
        videoElement.closest('._aagv') ||
        videoElement.parentElement;
    if (!reelContainer) return;
    if (reelContainer.querySelector('.vero-reel-banner')) return;

    const banner = document.createElement('div');
    banner.className = `vero-reel-banner ${result.isDeepfake ? 'deepfake' : 'misleading'}`;
    banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span>⚠️</span>
      <div>
        <strong>${result.isDeepfake ? 'AI-GENERATED DEEPFAKE' : 'MISLEADING CONTENT'}</strong>
        <div style="font-size:11px;margin-top:2px;">${result.explanation || 'Confidence: ' + result.confidence + '%'}</div>
      </div>
    </div>
  `;
    reelContainer.appendChild(banner);
    setTimeout(() => banner.remove(), 8000);
}

function injectCaptionWarning(captionElement, result) {
    const postContainer = captionElement.closest('article') ||
        captionElement.closest('._aagv') ||
        captionElement.parentElement;
    if (!postContainer) return;
    if (postContainer.querySelector('.vero-warning-badge')) return;

    const warning = document.createElement('div');
    warning.className = `vero-warning-badge ${result.label === 'FAKE' ? 'fake' : 'caution'}`;
    warning.style.margin = '8px 16px';
    warning.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;">
      <span>${result.label === 'FAKE' ? '❌' : '⚠️'}</span>
      <span><strong>${result.label}</strong> · ${result.confidence}% confidence</span>
    </div>
    <div style="font-size:11px;">${result.explanation || ''}</div>
    ${result.source ? `<div class="vero-source-link">Source: ${result.source}</div>` : ''}
  `;
    captionElement.parentNode.insertBefore(warning, captionElement.nextSibling);
    setTimeout(() => warning.remove(), 10000);
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForInstagram);
} else {
    waitForInstagram();
}
