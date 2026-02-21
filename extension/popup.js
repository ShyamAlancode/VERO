// Popup logic for VERO

document.addEventListener('DOMContentLoaded', () => {
    const whatsappToggle = document.getElementById('whatsapp-toggle');
    const instagramToggle = document.getElementById('instagram-toggle');
    const apiKeyInput = document.getElementById('api-key');
    const saveBtn = document.getElementById('save-btn');
    const statusText = document.getElementById('status-text');
    const countChecked = document.getElementById('count-checked');
    const countFlagged = document.getElementById('count-flagged');

    // Load saved settings
    chrome.storage.local.get(['enabled', 'whatsapp', 'instagram', 'geminiKey', 'stats'], (data) => {
        whatsappToggle.checked = data.whatsapp !== false;
        instagramToggle.checked = data.instagram !== false;
        apiKeyInput.value = data.geminiKey || '';

        const stats = data.stats || { messagesChecked: 0, fakesDetected: 0, reelsScanned: 0, deepfakesDetected: 0 };
        countChecked.textContent = (stats.messagesChecked || 0) + (stats.reelsScanned || 0);
        countFlagged.textContent = (stats.fakesDetected || 0) + (stats.deepfakesDetected || 0);

        updateStatusUI();
    });

    saveBtn.addEventListener('click', () => {
        const settings = {
            whatsapp: whatsappToggle.checked,
            instagram: instagramToggle.checked,
            geminiKey: apiKeyInput.value.trim(),
            enabled: true
        };

        chrome.storage.local.set(settings, () => {
            saveBtn.textContent = '✓ Saved';
            saveBtn.style.background = '#34a853';
            updateStatusUI();

            setTimeout(() => {
                saveBtn.textContent = 'Save Configuration';
                saveBtn.style.background = '#1a73e8';
            }, 1500);
        });
    });

    function updateStatusUI() {
        if (whatsappToggle.checked || instagramToggle.checked) {
            statusText.textContent = 'Active';
            statusText.style.background = 'rgba(255,255,255,0.2)';
        } else {
            statusText.textContent = 'Disabled';
            statusText.style.background = 'rgba(0,0,0,0.1)';
        }
    }

    // Poll for stats every 2 seconds
    setInterval(() => {
        chrome.storage.local.get(['stats'], (data) => {
            const stats = data.stats || { messagesChecked: 0, fakesDetected: 0, reelsScanned: 0, deepfakesDetected: 0 };
            countChecked.textContent = (stats.messagesChecked || 0) + (stats.reelsScanned || 0);
            countFlagged.textContent = (stats.fakesDetected || 0) + (stats.deepfakesDetected || 0);
        });
    }, 2000);
});
