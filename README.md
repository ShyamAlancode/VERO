<h1 align="center">🛡️ VERO</h1>
<p align="center"><strong>See What's Real – Real-Time Misinformation & Deepfake Detector</strong></p>
<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/Gemini%202.0-Flash-orange?logo=google&logoColor=white" alt="Gemini">
  <img src="https://img.shields.io/badge/TensorFlow.js-Deepfake-red?logo=tensorflow&logoColor=white" alt="TF.js">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## What is VERO?

VERO is a **free Chrome extension** that detects fake news and deepfakes in real time on **WhatsApp Web** and **Instagram**. It uses a multi-model AI pipeline combining Google Gemini, TensorFlow.js, NewsAPI, and PIB Fact Check.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **AI Fact-Checking** | Gemini 2.0 Flash analyzes messages/captions with contextual news |
| 👁️ **Deepfake Detection** | TensorFlow.js runs locally in the browser on Instagram Reels |
| 📰 **Live News Context** | Cross-references with NewsAPI (100 req/day free) |
| 🇮🇳 **PIB Fact Check** | Links to Indian govt official fact-checking portal |
| ⚡ **< 1.5s Speed** | Results injected as non-intrusive badges/banners |
| 🔒 **Privacy First** | Deepfake detection is 100% local — no video data leaves your browser |

## 🏗️ Architecture

```
Extension (Chrome Manifest V3)
├── content-whatsapp.js  → MutationObserver + Gemini + NewsAPI + PIB
├── content-instagram.js → MutationObserver + TensorFlow.js + Gemini
├── background.js        → API proxy (Gemini, NewsAPI, PIB)
├── popup.html/js        → Settings + Live Stats (Google Sans fonts)
└── styles.css           → Warning badges & reel banners

Backend (FastAPI on Render)
├── /api/verify     → Full pipeline (Gemini + NewsAPI + PIB)
├── /api/news       → NewsAPI proxy
└── /api/pib        → PIB search link

Landing Page (Netlify)
└── Dark-mode premium landing with Catamaran + Google Sans fonts
```

## 🚀 Quick Start

### 1. Install Extension
```bash
git clone https://github.com/ShyamAlancode/VERO.git
```
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Pin VERO 🛡️ to your toolbar

### 2. Configure
1. Click the VERO icon
2. Enter your Gemini API key (free at [aistudio.google.com](https://aistudio.google.com))
3. Toggle WhatsApp / Instagram protection

### 3. Backend (Optional)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

## 🛠️ Tech Stack

| Component | Technology | Cost |
|-----------|-----------|------|
| LLM Analysis | Google Gemini 2.0 Flash | Free |
| Deepfake Detection | TensorFlow.js (CDN) | Free |
| Live News | NewsAPI | Free (100 req/day) |
| Fact Check | PIB Fact Check | Free |
| Backend | FastAPI on Render | Free |
| Landing Page | Netlify | Free |
| Fonts | Google Sans + Catamaran | Free |
| Icons | Feather Icons | Free |

## 📂 Project Structure

```
VERO/
├── extension/           # Chrome Extension
│   ├── fonts/           # Catamaran & Google Sans
│   ├── feather/         # Feather SVG icons
│   ├── icons/           # Extension icons (16/48/128)
│   ├── manifest.json    # V3 manifest
│   ├── background.js    # Service worker
│   ├── content-whatsapp.js
│   ├── content-instagram.js
│   ├── popup.html/js    # Settings UI
│   └── styles.css       # Injected styles
├── backend/             # FastAPI server
│   ├── main.py
│   ├── requirements.txt
│   └── vercel.json
├── landing/             # Netlify landing page
│   ├── index.html
│   ├── style.css
│   ├── fonts/
│   └── feather/
├── render.yaml          # Render deployment
└── README.md
```

## 📜 License

MIT License © 2026 ShyamAlancode
