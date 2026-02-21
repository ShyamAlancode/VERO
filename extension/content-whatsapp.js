// WhatsApp Web content script for VERO

let settings = {
    enabled: true,
    geminiKey: '',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    privacyMode: true
};

// Load settings
chrome.storage.local.get(['enabled', 'geminiKey', 'apiEndpoint', 'privacyMode'], (result) => {
    settings = { ...settings, ...result };
});

// Listen for settings updates
chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.geminiKey) settings.geminiKey = changes.geminiKey.newValue;
    if (changes.apiEndpoint) settings.apiEndpoint = changes.apiEndpoint.newValue;
    if (changes.privacyMode) settings.privacyMode = changes.privacyMode.newValue;
});

// Wait for WhatsApp to load
function waitForWhatsApp() {
    const interval = setInterval(() => {
        const messageContainer = document.querySelector('[data-testid="conversation-panel-messages"]') ||
            document.querySelector('div[role="grid"]') ||
            document.querySelector('div[role="list"]');

        if (messageContainer) {
            clearInterval(interval);
            initMessageObserver();

            // Scan existing messages
            setTimeout(() => {
                document.querySelectorAll('[data-pre-plain-text], .message-in, .message-out').forEach(scanMessage);
            }, 2000);
        }
    }, 1000);
}

// Initialize mutation observer for new messages
function initMessageObserver() {
    const targetNode = document.querySelector('[data-testid="conversation-panel-messages"]') ||
        document.querySelector('div[role="grid"]') ||
        document.querySelector('div[role="list"]') ||
        document.body;

    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled) return;

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const messageElements = [];

                    if (node.matches && (node.matches('[data-pre-plain-text]') || node.matches('.message-in') || node.matches('.message-out'))) {
                        messageElements.push(node);
                    }

                    const nestedMessages = node.querySelectorAll?.('[data-pre-plain-text], .message-in, .message-out') || [];
                    messageElements.push(...nestedMessages);

                    messageElements.forEach(msgEl => {
                        setTimeout(() => scanMessage(msgEl), 100);
                    });
                }
            });
        });
    });

    observer.observe(targetNode, { childList: true, subtree: true });
}

// Scan individual message
async function scanMessage(messageElement) {
    if (messageElement.hasAttribute('data-vero-scanned')) return;

    let messageText = '';
    const textSelectors = [
        '.selectable-text.copyable-text',
        '[data-testid="text-message"]',
        'span[dir="ltr"]',
        'span[dir="rtl"]',
        '.message-in span',
        '.message-out span'
    ];

    for (const selector of textSelectors) {
        const textEl = messageElement.querySelector(selector);
        if (textEl && textEl.innerText.trim()) {
            messageText = textEl.innerText.trim();
            break;
        }
    }

    if (!messageText) {
        messageText = messageElement.innerText?.trim() || '';
    }

    if (!messageText || messageText.length < 10) return;
    if (messageText.startsWith('You:') || messageText.includes('joined using')) return;

    messageElement.setAttribute('data-vero-scanned', 'true');
    showScanningIndicator(messageElement);

    try {
        const result = await analyzeText(messageText);
        removeScanningIndicator(messageElement);

        if (result.isFake || result.isMisleading) {
            injectMessageWarning(messageElement, result);
            chrome.runtime.sendMessage({ type: 'DETECTED_FAKE', mediaType: 'text', isFake: true });
        }
    } catch (error) {
        console.error('VERO analysis error:', error);
        removeScanningIndicator(messageElement);
    }
}

function showScanningIndicator(messageElement) {
    const indicator = document.createElement('div');
    indicator.className = 'vero-pulse-shield';
    indicator.id = 'vero-indicator-' + Date.now();
    indicator.innerHTML = '🛡️';
    indicator.style.width = '20px';
    indicator.style.height = '20px';
    indicator.style.fontSize = '10px';

    const messageContainer = messageElement.closest('[data-pre-plain-text]')?.parentElement || messageElement;
    if (getComputedStyle(messageContainer).position === 'static') {
        messageContainer.style.position = 'relative';
    }
    messageContainer.appendChild(indicator);
    messageElement.setAttribute('data-vero-indicator', indicator.id);
}

function removeScanningIndicator(messageElement) {
    const indicatorId = messageElement.getAttribute('data-vero-indicator');
    if (indicatorId) {
        const indicator = document.getElementById(indicatorId);
        if (indicator) indicator.remove();
    }
}

async function analyzeText(text) {
    const prompt = `
You are a fact-checking AI for VERO. Analyze this message for misinformation:

"${text}"

Respond with a JSON object only (no other text):
{
  "isFake": boolean,
  "isMisleading": boolean,
  "confidence": number (0-100),
  "label": "FAKE" or "MISLEADING" or "VERIFIED" or "UNKNOWN",
  "explanation": "Brief 1-line explanation",
  "source": "Source name if available (PIB, AltNews, etc.) or null",
  "sourceUrl": "URL if available or null"
}

Base your analysis on official fact-checking sources. If unsure, set isFake: false, isMisleading: false, label: "UNKNOWN".
  `.trim();

    if (!settings.geminiKey) {
        // Demo/mock fallback when no API key is set
        if (text.toLowerCase().includes('5000') || text.toLowerCase().includes('free money') || text.toLowerCase().includes('govt scheme')) {
            return { isFake: true, isMisleading: true, confidence: 95, label: 'FAKE', explanation: 'PIB fact-checked this in 2023. No such scheme exists.', source: 'PIB Fact Check', sourceUrl: 'https://pib.gov.in/factcheck' };
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
        console.error('VERO: Failed to parse Gemini response', e);
    }

    return { isFake: false, isMisleading: false, confidence: 0, label: 'UNKNOWN', explanation: '', source: null, sourceUrl: null };
}

function injectMessageWarning(messageElement, result) {
    if (messageElement.querySelector('.vero-warning-badge')) return;

    const warning = document.createElement('div');
    const cls = result.label === 'FAKE' ? 'fake' : result.label === 'MISLEADING' ? 'caution' : 'verified';
    warning.className = `vero-warning-badge ${cls}`;

    const icon = result.label === 'FAKE' ? '❌' : result.label === 'MISLEADING' ? '⚠️' : '✅';

    warning.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;">
      <span>${icon}</span>
      <span><strong>${result.label}</strong> · ${result.confidence}% confidence</span>
    </div>
    <div style="font-size:11px;margin-top:2px;">${result.explanation || ''}</div>
    ${result.source ? `<div class="vero-source-link">Source: <a href="${result.sourceUrl || '#'}" target="_blank">${result.source}</a></div>` : ''}
  `;

    const messageContainer = messageElement.closest('[data-pre-plain-text]')?.parentElement || messageElement;
    messageContainer.appendChild(warning);

    if (result.label !== 'FAKE') {
        setTimeout(() => warning.remove(), 10000);
    }
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForWhatsApp);
} else {
    waitForWhatsApp();
}
