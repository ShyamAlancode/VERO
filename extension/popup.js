// VERO – Popup Script
document.addEventListener('DOMContentLoaded', () => {
    const waToggle = document.getElementById('wa-toggle');
    const igToggle = document.getElementById('ig-toggle');
    const apiKey = document.getElementById('api-key');
    const saveBtn = document.getElementById('save-btn');
    const statusPill = document.getElementById('status-pill');
    const sChecked = document.getElementById('s-checked');
    const sFakes = document.getElementById('s-fakes');
    const sReels = document.getElementById('s-reels');
    const sDeepfakes = document.getElementById('s-deepfakes');

    // Load saved settings
    chrome.storage.local.get(['enabled', 'whatsapp', 'instagram', 'geminiKey', 'stats'], (d) => {
        waToggle.checked = d.whatsapp !== false;
        igToggle.checked = d.instagram !== false;
        apiKey.value = d.geminiKey || '';
        updateStatus();
        refreshStats(d.stats);
    });

    // Save
    saveBtn.addEventListener('click', () => {
        chrome.storage.local.set({
            enabled: true,
            whatsapp: waToggle.checked,
            instagram: igToggle.checked,
            geminiKey: apiKey.value.trim()
        }, () => {
            saveBtn.textContent = '✓ Saved';
            saveBtn.style.background = '#10b981';
            updateStatus();
            setTimeout(() => { saveBtn.textContent = 'Save Configuration'; saveBtn.style.background = ''; }, 1500);
        });
    });

    function updateStatus() {
        const on = waToggle.checked || igToggle.checked;
        statusPill.textContent = on ? '● Active' : '○ Paused';
        statusPill.className = 'status-pill' + (on ? '' : ' off');
    }

    function refreshStats(stats) {
        const s = stats || { messagesChecked: 0, fakesDetected: 0, reelsScanned: 0, deepfakesDetected: 0 };
        sChecked.textContent = s.messagesChecked || 0;
        sFakes.textContent = s.fakesDetected || 0;
        sReels.textContent = s.reelsScanned || 0;
        sDeepfakes.textContent = s.deepfakesDetected || 0;
    }

    // Poll stats every 2s
    setInterval(() => {
        chrome.storage.local.get(['stats'], (d) => refreshStats(d.stats));
    }, 2000);

    waToggle.addEventListener('change', updateStatus);
    igToggle.addEventListener('change', updateStatus);
});
