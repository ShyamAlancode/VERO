// WhatsApp Web content script for VERO

let settings = {
    enabled: true,
    geminiKey: '',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    privacyMode: true,
    whatsapp: true
};

// Load settings
chrome.storage.local.get(['enabled', 'geminiKey', 'apiEndpoint', 'privacyMode', 'whatsapp'], (result) => {
    settings = { ...settings, ...result };
    if (settings.enabled && settings.whatsapp) {
        waitForWhatsApp();
    }
});

// Listen for settings updates
chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.geminiKey) settings.geminiKey = changes.geminiKey.newValue;
    if (changes.whatsapp) settings.whatsapp = changes.whatsapp.newValue;
});

function waitForWhatsApp() {
    const checkInterval = setInterval(() => {
        const mainPane = document.querySelector('#pane-side') || document.querySelector('[role="grid"]');
        if (mainPane) {
            clearInterval(checkInterval);
            initMessageObserver();
            // Initial scan
            scanAllMessages();
        }
    }, 1500);
}

function scanAllMessages() {
    const messages = document.querySelectorAll('.message-in, .message-out, [data-testid="msg-container"]');
    messages.forEach(scanMessage);
}

function initMessageObserver() {
    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled || !settings.whatsapp) return;

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const messageElements = node.querySelectorAll('.message-in, .message-out, [data-testid="msg-container"]');
                    messageElements.forEach(scanMessage);
                    if (node.matches('.message-in, .message-out, [data-testid="msg-container"]')) {
                        scanMessage(node);
                    }
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

async function scanMessage(messageElement) {
    if (messageElement.hasAttribute('data-vero-scanned')) return;

    // Extract text
    const textEl = messageElement.querySelector('.copyable-text span') ||
        messageElement.querySelector('[data-testid="text-message"]') ||
        messageElement.querySelector('span[dir="ltr"]');

    const text = textEl?.innerText?.trim();
    if (!text || text.length < 15) return;

    // Skip system messages
    if (text.includes('waiting for this message') || text.includes('Messages are end-to-end encrypted')) return;

    messageElement.setAttribute('data-vero-scanned', 'true');
    showScanningIndicator(messageElement);

    try {
        const result = await analyzeText(text);
        removeScanningIndicator(messageElement);

        if (result.isFake || result.isMisleading) {
            injectWarning(messageElement, result);
            chrome.runtime.sendMessage({
                type: 'DETECTED_FAKE',
                mediaType: 'text',
                isFake: true
            });
        }
    } catch (err) {
        console.error('VERO: Analysis failed', err);
        removeScanningIndicator(messageElement);
    }
}

function showScanningIndicator(el) {
    const indicator = document.createElement('div');
    indicator.className = 'vero-pulse-shield';
    indicator.innerHTML = '🛡️';
    indicator.style.position = 'absolute';
    indicator.style.top = '-10px';
    indicator.style.right = '-10px';
    indicator.style.width = '24px';
    indicator.style.height = '24px';
    el.style.position = 'relative';
    el.appendChild(indicator);
    el._vero_indicator = indicator;
}

function removeScanningIndicator(el) {
    if (el._vero_indicator) {
        el._vero_indicator.remove();
        delete el._vero_indicator;
    }
}

async function analyzeText(text) {
    // If no API key, use mock logic for the hackathon demo
    if (!settings.geminiKey) {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('free cash') || lowerText.includes('win 5000') || lowerText.includes('govt scheme')) {
            return {
                isFake: true,
                isMisleading: true,
                confidence: 92,
                label: 'FAKE',
                explanation: 'Suspicious government scheme identified as misinformation.',
                source: 'PIB Fact Check',
                sourceUrl: 'https://pib.gov.in/factcheck'
            };
        }
        return { isFake: false };
    }

    const prompt = `Analyze this message. If it is likely fake news, deepfake text, or misinformation, mark it. 
  Respond ONLY with JSON: 
  {"isFake": boolean, "isMisleading": boolean, "confidence": number, "label": "FAKE"|"MISLEADING"|"VERIFIED", "explanation": "1-line reason", "source": "string", "sourceUrl": "string"}
  Text: "${text}"`;

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'GEMINI_REQUEST',
            url: settings.apiEndpoint,
            apiKey: settings.geminiKey,
            body: {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
            }
        }, (response) => {
            if (response && response.success) {
                try {
                    const rawText = response.data.candidates[0].content.parts[0].text;
                    const jsonMatch = rawText.match(/\{.*\}/s);
                    resolve(JSON.parse(jsonMatch[0]));
                } catch (e) {
                    resolve({ isFake: false });
                }
            } else {
                reject(response?.error || 'Unknown error');
            }
        });
    });
}

function injectWarning(el, result) {
    const badge = document.createElement('div');
    badge.className = `vero-warning-badge ${result.label.toLowerCase() || 'fake'}`;
    badge.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px;">
      <span>${result.label === 'FAKE' ? '❌' : '⚠️'}</span>
      <strong>${result.label}</strong> · ${result.confidence}%
    </div>
    <div style="margin-top:3px; font-size:11px;">${result.explanation}</div>
    ${result.source ? `<div class="vero-source-link">Source: <a href="${result.sourceUrl}" target="_blank">${result.source}</a></div>` : ''}
  `;
    el.appendChild(badge);
}
