// Load settings
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get([
        'enabled', 'whatsapp', 'instagram',
        'geminiKey', 'privacyMode', 'useLocalDeepfake',
        'stats'
    ], (result) => {
        document.getElementById('enabled').checked = result.enabled !== false;
        document.getElementById('whatsapp').checked = result.whatsapp !== false;
        document.getElementById('instagram').checked = result.instagram !== false;
        document.getElementById('geminiKey').value = result.geminiKey || '';
        document.getElementById('privacyMode').checked = result.privacyMode !== false;
        document.getElementById('useLocalDeepfake').checked = result.useLocalDeepfake !== false;

        // Update status badge
        updateStatusBadge(result.enabled !== false);

        // Update stats
        const stats = result.stats || { messagesChecked: 0, fakesDetected: 0, reelsScanned: 0, deepfakesDetected: 0 };
        document.getElementById('messagesChecked').textContent = stats.messagesChecked;
        document.getElementById('fakesDetected').textContent = stats.fakesDetected;
        document.getElementById('reelsScanned').textContent = stats.reelsScanned;
        document.getElementById('deepfakesDetected').textContent = stats.deepfakesDetected;
    });

    // Set up AI Studio link
    document.getElementById('makersuiteLink').href = 'https://aistudio.google.com';
});

// Update status badge
function updateStatusBadge(enabled) {
    const badge = document.getElementById('statusBadge');
    if (enabled) {
        badge.textContent = '● Active';
        badge.className = 'status-badge status-active';
    } else {
        badge.textContent = '○ Inactive';
        badge.className = 'status-badge status-inactive';
    }
}

// Save settings
document.getElementById('saveSettings').addEventListener('click', () => {
    const settings = {
        enabled: document.getElementById('enabled').checked,
        whatsapp: document.getElementById('whatsapp').checked,
        instagram: document.getElementById('instagram').checked,
        geminiKey: document.getElementById('geminiKey').value.trim(),
        privacyMode: document.getElementById('privacyMode').checked,
        useLocalDeepfake: document.getElementById('useLocalDeepfake').checked
    };

    chrome.storage.local.set(settings, () => {
        updateStatusBadge(settings.enabled);

        // Show saved confirmation
        const btn = document.getElementById('saveSettings');
        const originalText = btn.textContent;
        btn.textContent = '✓ Saved!';
        btn.style.background = '#34a853';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '#1a73e8';
        }, 1500);
    });
});

// Listen for enabled toggle to update badge
document.getElementById('enabled').addEventListener('change', (e) => {
    updateStatusBadge(e.target.checked);
});
