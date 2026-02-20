/**
 * VERO – Instagram Content Script
 * Watches feed/reels for new posts and injects warning banners on flagged content.
 */

const VERO_ATTR = "data-vero-checked";
const DEBOUNCE_MS = 1000;
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
    debounceTimer = setTimeout(scanPosts, DEBOUNCE_MS);
});

observer.observe(document.body, { childList: true, subtree: true });

setTimeout(scanPosts, 2500);

// ── Scanner ───────────────────────────────────────────────────────────────────
function scanPosts() {
    if (!veroEnabled) return;

    scanCaptions();
    scanReels();
}

function scanCaptions() {
    // Instagram post captions
    const articles = document.querySelectorAll("article[role='presentation']");
    articles.forEach((article) => {
        if (article.hasAttribute(VERO_ATTR)) return;

        // Caption selectors (Instagram 2025)
        const captionEl =
            article.querySelector("h1") ||
            article.querySelector("._a9zs") ||
            article.querySelector("[data-testid='post-comment-root-element'] span");

        const caption = captionEl?.innerText?.trim();
        if (!caption || caption.length < 20) return;

        article.setAttribute(VERO_ATTR, "pending");
        analyzeCaption(caption, article);
    });
}

function scanReels() {
    // Instagram reels / video posts
    const videos = document.querySelectorAll("video[src]");
    videos.forEach((video) => {
        const container = video.closest("article, div[role='presentation']");
        if (!container || container.hasAttribute("data-vero-video-checked")) return;

        container.setAttribute("data-vero-video-checked", "pending");
        analyzeReelVideo(video.src, container);
    });
}

// ── Analysis & Banner Injection ───────────────────────────────────────────────
async function analyzeCaption(text, container) {
    const result = await sendToBackground("ANALYZE_TEXT", { text });

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
    injectBanner(container, result, "caption");
}

async function analyzeReelVideo(videoUrl, container) {
    const result = await sendToBackground("ANALYZE_VIDEO", { videoUrl });

    chrome.runtime.sendMessage({
        type: "INCREMENT_STATS",
        payload: {
            checked: 1,
            flagged: result?.label === "DEEPFAKE" ? 1 : 0,
        },
    });

    if (!result || result.label === "DISABLED") return;

    container.setAttribute("data-vero-video-checked", result.label.toLowerCase());
    if (result.label === "DEEPFAKE") {
        injectBanner(container, result, "video");
    }
}

function injectBanner(container, result, type) {
    container.querySelector(".vero-banner")?.remove();

    const banner = document.createElement("div");
    banner.className = "vero-banner";

    const isFake =
        (result.label === "FAKE" || result.label === "DEEPFAKE") &&
        result.confidence >= confidenceThreshold;
    const isUnknown = result.label === "UNKNOWN";

    if (isFake) {
        banner.classList.add("vero-banner--danger");
        const labelText =
            type === "video" ? "⚠️ Possible Deepfake Detected" : "⚠️ Possible Misinformation";
        banner.innerHTML = `
      <div class="vero-banner__content">
        <span class="vero-banner__label">${labelText}</span>
        <span class="vero-banner__conf">${Math.round(result.confidence * 100)}% suspicious</span>
        <span class="vero-banner__tip">Verify before sharing</span>
      </div>
    `;
    } else if (isUnknown) {
        banner.classList.add("vero-banner--unknown");
        banner.innerHTML = `
      <div class="vero-banner__content">
        <span class="vero-banner__label">🔍 Could not verify this ${type === "video" ? "video" : "post"}</span>
      </div>
    `;
    } else {
        // Safe — show brief label and fade-out
        banner.classList.add("vero-banner--safe");
        banner.innerHTML = `
      <div class="vero-banner__content">
        <span class="vero-banner__label">✅ Likely Credible</span>
      </div>
    `;
        setTimeout(() => banner.remove(), 3000);
    }

    // Dismiss button
    const dismiss = document.createElement("button");
    dismiss.className = "vero-banner__dismiss";
    dismiss.textContent = "×";
    dismiss.title = "Dismiss VERO warning";
    dismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        banner.remove();
    });
    banner.appendChild(dismiss);

    container.style.position = "relative";
    container.insertAdjacentElement("afterbegin", banner);
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

console.log("[VERO] Instagram content script loaded ✓");
