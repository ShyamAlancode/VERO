// Background service worker for VERO

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  whatsapp: true,
  instagram: true,
  apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  geminiKey: '', // User will add their own free key
  useLocalDeepfake: true, // Use TensorFlow.js locally
  privacyMode: true // Hash sensitive data
};

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULT_SETTINGS);

  // Initialize stats
  chrome.storage.local.set({
    stats: {
      messagesChecked: 0,
      fakesDetected: 0,
      reelsScanned: 0,
      deepfakesDetected: 0
    }
  });
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DETECTED_FAKE') {
    // Update stats
    chrome.storage.local.get(['stats'], (result) => {
      const stats = result.stats || { messagesChecked: 0, fakesDetected: 0, reelsScanned: 0, deepfakesDetected: 0 };
      if (message.mediaType === 'text') {
        stats.messagesChecked++;
        if (message.isFake) stats.fakesDetected++;
      } else if (message.mediaType === 'video') {
        stats.reelsScanned++;
        if (message.isDeepfake) stats.deepfakesDetected++;
      }
      chrome.storage.local.set({ stats });
    });
  }

  // Handle API requests from content scripts (to avoid CORS)
  if (message.type === 'GEMINI_REQUEST') {
    fetch(message.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': message.apiKey
      },
      body: JSON.stringify(message.body)
    })
      .then(response => response.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.toString() }));

    return true; // Required for async sendResponse
  }
});
