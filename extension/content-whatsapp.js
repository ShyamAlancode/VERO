/**
 * VERO – WhatsApp Web Content Script
 * Watches for new messages and injects warning badges on flagged content.
 */

const VERO_ATTR = "data-vero-checked";
const MIN_TEXT_LENGTH = 20;
const DEBOUNCE_MS = 800;
const CONFIDENCE_DEFAULT = 0.75;

let veroEnabled = true;
let confidenceThreshold = CONFIDENCE_DEFAULT;

// ── Load settings ─────────────────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
    if (settings) {
        veroEnabled = settings.enabled;
        confidenceThreshold = settings.confidenceThreshold ?? CONFIDENCE_DEFAULT;
    }
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue) {
        veroEnabled = changes.settings.newValue.enabled;
        confidenceThreshold =
            changes.settings.newValue.confidenceThreshold ?? CONFIDENCE_DEFAULT;
    }
});

// ── MutationObserver ──────────────────────────────────────────────────────────
let debounceTimer = null;

const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanMessages, DEBOUNCE_MS);
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan after a short delay (page may not be fully loaded)
setTimeout(scanMessages, 2000);

// ── Scanner ───────────────────────────────────────────────────────────────────
function scanMessages() {
    if (!veroEnabled) return;

    // WhatsApp Web message selectors (updated Feb 2025)
    // Text bubbles
    const textBubbles = document.querySelectorAll(
        '[class*="message-in"] .copyable-text, [class*="message-out"] .copyable-text'
    );

    textBubbles.forEach((el) => {
        const container = el.closest('[class*="message-in"], [class*="message-out"]');
        if (!container || container.hasAttribute(VERO_ATTR)) return;

        const text = el.innerText?.trim();
        if (!text || text.length < MIN_TEXT_LENGTH) return;

        container.setAttribute(VERO_ATTR, "pending");
        analyzeAndBadge(text, container);
    });
}

// ── Analysis & Badge Injection ────────────────────────────────────────────────
async function analyzeAndBadge(text, container) {
    const result = await sendToBackground("ANALYZE_TEXT", { text });

    // Update stats
    chrome.runtime.sendMessage({
        type: "INCREMENT_STATS",
        payload: {
            checked: 1,
            flagged: result?.label === "FAKE" ? 1 : 0,
        },
    });

    if (!result || result.label === "SKIP" || result.label === "DISABLED") {
        container.setAttribute(VERO_ATTR, "skipped");
        return;
    }

    container.setAttribute(VERO_ATTR, result.label.toLowerCase());
    injectBadge(container, result);
}

function injectBadge(container, result) {
    // Remove old badge if re-checking
    container.querySelector(".vero-badge")?.remove();

    const badge = document.createElement("div");
    badge.className = "vero-badge";

    const isFake =
        result.label === "FAKE" && result.confidence >= confidenceThreshold;
    const isUnknown = result.label === "UNKNOWN";

    if (isFake) {
        badge.classList.add("vero-badge--danger");
        badge.innerHTML = `
      <span class="vero-badge__icon">⚠️</span>
      <span class="vero-badge__text">Possible Misinformation</span>
      <span class="vero-badge__conf">${Math.round(result.confidence * 100)}% suspicious</span>
    `;
    } else if (isUnknown) {
        badge.classList.add("vero-badge--unknown");
        badge.innerHTML = `
      <span class="vero-badge__icon">🔍</span>
      <span class="vero-badge__text">Could not verify</span>
    `;
    } else {
        badge.classList.add("vero-badge--safe");
        badge.innerHTML = `
      <span class="vero-badge__icon">✅</span>
      <span class="vero-badge__text">Likely Credible</span>
    `;
    }

    // Add dismiss button
    const dismiss = document.createElement("button");
    dismiss.className = "vero-badge__dismiss";
    dismiss.textContent = "×";
    dismiss.title = "Dismiss VERO warning";
    dismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        badge.remove();
    });
    badge.appendChild(dismiss);

    // Insert badge after the message bubble
    container.style.position = "relative";
    container.appendChild(badge);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendToBackground(type, payload) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[VERO] Runtime error:", chrome.runtime.lastError);
                resolve(null);
            } else {
                resolve(response?.result ?? null);
            }
        });
    });
}

console.log("[VERO] WhatsApp content script loaded ✓");
