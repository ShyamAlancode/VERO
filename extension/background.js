/**
 * VERO – Background Service Worker
 * Routes analysis requests from content scripts to the backend API
 * and relays verdicts back to the originating tab.
 */

const BACKEND_URL = "https://vero-api.vercel.app"; // Replace with your deployed Vercel URL
const HF_API_URL = "https://api-inference.huggingface.co/models/hamzab/roberta-fake-news-classification";
const HF_TOKEN = ""; // Set your HuggingFace token here (or load from storage)

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: true,
  confidenceThreshold: 0.75,
  totalChecked: 0,
  totalFlagged: 0,
};

// ── Initialise storage on install ───────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings", (data) => {
    if (!data.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
  console.log("[VERO] Extension installed / updated.");
});

// ── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case "ANALYZE_TEXT":
      analyzeText(payload.text, sender.tab?.id)
        .then((result) => sendResponse({ success: true, result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // keep channel open for async

    case "ANALYZE_VIDEO":
      analyzeVideo(payload.videoUrl, sender.tab?.id)
        .then((result) => sendResponse({ success: true, result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "GET_SETTINGS":
      chrome.storage.local.get("settings", (data) =>
        sendResponse(data.settings || DEFAULT_SETTINGS)
      );
      return true;

    case "SAVE_SETTINGS":
      chrome.storage.local.set({ settings: payload }, () =>
        sendResponse({ success: true })
      );
      return true;

    case "INCREMENT_STATS":
      chrome.storage.local.get("settings", (data) => {
        const settings = data.settings || DEFAULT_SETTINGS;
        settings.totalChecked = (settings.totalChecked || 0) + (payload.checked || 0);
        settings.totalFlagged = (settings.totalFlagged || 0) + (payload.flagged || 0);
        chrome.storage.local.set({ settings });
      });
      return false;

    default:
      console.warn("[VERO] Unknown message type:", type);
  }
});

// ── Text analysis (HuggingFace free tier) ───────────────────────────────────
async function analyzeText(text, tabId) {
  if (!text || text.trim().length < 20) {
    return { label: "SKIP", confidence: 0, reason: "Text too short" };
  }

  const settings = await getSettings();
  if (!settings.enabled) return { label: "DISABLED", confidence: 0 };

  try {
    // Primary: HuggingFace Inference API (free tier)
    const response = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HF_TOKEN}`,
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!response.ok) {
      throw new Error(`HF API error: ${response.status}`);
    }

    const data = await response.json();

    // HuggingFace returns [[{label, score}, ...]]
    const results = Array.isArray(data[0]) ? data[0] : data;
    const topResult = results.reduce((a, b) => (a.score > b.score ? a : b));

    return {
      label: topResult.label.toUpperCase().includes("FAKE") ? "FAKE" : "REAL",
      confidence: topResult.score,
      raw: results,
    };
  } catch (err) {
    console.error("[VERO] Text analysis failed:", err);
    // Fallback: return inconclusive
    return { label: "UNKNOWN", confidence: 0, error: err.message };
  }
}

// ── Video analysis (deepfake detection) ─────────────────────────────────────
async function analyzeVideo(videoUrl, tabId) {
  const settings = await getSettings();
  if (!settings.enabled) return { label: "DISABLED", confidence: 0 };

  try {
    // Phase 2: Replace with real deepfake model call
    // For now, call the backend (which returns a mock result)
    const response = await fetch(`${BACKEND_URL}/analyze/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_url: videoUrl }),
    });

    if (!response.ok) throw new Error(`Backend error: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error("[VERO] Video analysis failed:", err);
    return { label: "UNKNOWN", confidence: 0, error: err.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (data) =>
      resolve(data.settings || DEFAULT_SETTINGS)
    );
  });
}
