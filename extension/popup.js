/**
 * VERO – Popup Script
 * Manages settings, displays live stats, and handles user interactions.
 */

const DEFAULT_SETTINGS = {
    enabled: true,
    confidenceThreshold: 0.75,
    totalChecked: 0,
    totalFlagged: 0,
};

// ── Elements ──────────────────────────────────────────────────────────────────
const toggle = document.getElementById("main-toggle");
const toggleLabel = document.getElementById("toggle-label");
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const totalChecked = document.getElementById("total-checked");
const totalFlagged = document.getElementById("total-flagged");
const thresholdSlider = document.getElementById("threshold-slider");
const thresholdVal = document.getElementById("threshold-val");
const resetBtn = document.getElementById("reset-btn");

// ── Load settings ─────────────────────────────────────────────────────────────
chrome.storage.local.get("settings", (data) => {
    const settings = data.settings || DEFAULT_SETTINGS;
    applySettings(settings);
});

function applySettings(settings) {
    toggle.checked = settings.enabled;
    updateToggleUI(settings.enabled);

    const pct = Math.round((settings.confidenceThreshold ?? 0.75) * 100);
    thresholdSlider.value = pct;
    thresholdVal.textContent = `${pct}%`;
    thresholdSlider.style.setProperty("--v", `${pct}%`);

    totalChecked.textContent = animateCount(0, settings.totalChecked || 0, totalChecked);
    totalFlagged.textContent = animateCount(0, settings.totalFlagged || 0, totalFlagged);
}

// ── Toggle handler ────────────────────────────────────────────────────────────
toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    updateToggleUI(enabled);
    savePartial({ enabled });
});

function updateToggleUI(enabled) {
    toggleLabel.textContent = enabled ? "ON" : "OFF";
    statusPill.className = `status-pill ${enabled ? "" : "off"}`;
    statusText.textContent = enabled ? "Actively monitoring" : "Paused";
}

// ── Threshold slider ──────────────────────────────────────────────────────────
thresholdSlider.addEventListener("input", () => {
    const pct = parseInt(thresholdSlider.value);
    thresholdVal.textContent = `${pct}%`;
    thresholdSlider.style.setProperty("--v", `${pct}%`);
    savePartial({ confidenceThreshold: pct / 100 });
});

// ── Reset stats ───────────────────────────────────────────────────────────────
resetBtn.addEventListener("click", () => {
    resetBtn.textContent = "Cleared!";
    setTimeout(() => (resetBtn.textContent = "Reset Stats"), 1500);
    savePartial({ totalChecked: 0, totalFlagged: 0 });
    totalChecked.textContent = "0";
    totalFlagged.textContent = "0";
});

// ── Poll stats every 2s ───────────────────────────────────────────────────────
function refreshStats() {
    chrome.storage.local.get("settings", (data) => {
        const s = data.settings || DEFAULT_SETTINGS;
        totalChecked.textContent = s.totalChecked || 0;
        totalFlagged.textContent = s.totalFlagged || 0;
    });
}
setInterval(refreshStats, 2000);

// ── Helpers ───────────────────────────────────────────────────────────────────
function savePartial(partial) {
    chrome.storage.local.get("settings", (data) => {
        const settings = { ...(data.settings || DEFAULT_SETTINGS), ...partial };
        chrome.storage.local.set({ settings });
    });
}

function animateCount(from, to, el) {
    const duration = 600;
    const step = (to - from) / (duration / 16);
    let current = from;
    const timer = setInterval(() => {
        current += step;
        if ((step > 0 && current >= to) || (step < 0 && current <= to)) {
            clearInterval(timer);
            current = to;
        }
        el.textContent = Math.round(current);
    }, 16);
}
