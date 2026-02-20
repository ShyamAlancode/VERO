<h1 align="center">🛡️ VERO</h1>
<p align="center"><strong>Real-Time Misinformation & Deepfake Detector</strong></p>
<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Platform-Chrome-yellow?style=flat-square" />
  <img src="https://img.shields.io/badge/Backend-FastAPI-green?style=flat-square" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square" />
  <img src="https://img.shields.io/badge/AI-HuggingFace-orange?style=flat-square" />
</p>

---

## What is VERO?

**VERO** is a Chrome extension that detects misinformation and deepfakes **in real-time** while you browse WhatsApp Web and Instagram — injecting subtle, non-intrusive warning badges within **~1.5 seconds**.

| Feature | Detail |
|---|---|
| 📝 Text analysis | RoBERTa-based fake-news classifier (HuggingFace free tier) |
| 🎥 Deepfake detection | Video flag pipeline (Phase 2) |
| 💬 WhatsApp Web | Scans incoming message bubbles |
| 📸 Instagram | Scans post captions and story/reel videos |
| ⚡ Speed | Badge injection < 1.5 s (observer + debounce) |
| 🆓 Cost | 100% free-tier services |

---

## Project Structure

```
VERO/
├── extension/
│   ├── icons/               # Extension icons (16, 48, 128 px)
│   ├── manifest.json        # Chrome Manifest V3
│   ├── background.js        # Service worker — API routing
│   ├── content-whatsapp.js  # WhatsApp Web injection
│   ├── content-instagram.js # Instagram injection
│   ├── popup.html           # Settings popup UI
│   ├── popup.js             # Popup logic
│   └── styles.css           # Warning badge/banner styles
├── backend/
│   ├── main.py              # FastAPI app
│   ├── requirements.txt     # Python deps
│   └── vercel.json          # Vercel deployment
├── .gitignore
└── README.md
```

---

## Quick Start

### 1. Load the Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin VERO from the extensions toolbar 🎉

### 2. Set your HuggingFace Token *(optional but recommended)*

The extension calls the HuggingFace Inference API directly from the background worker.

1. Get a free token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Open `extension/background.js`
3. Replace `const HF_TOKEN = "";` with your token

### 3. Run the Backend Locally

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # add HF_TOKEN=your_token_here
uvicorn main:app --reload
```

Test it:

```bash
curl -X POST http://localhost:8000/analyze/text \
  -H "Content-Type: application/json" \
  -d '{"text": "SHOCKING: Scientists confirm moon is made of cheese!"}'
```

### 4. Deploy Backend to Vercel

```bash
npm i -g vercel
cd backend
vercel --prod
```

Copy the deployed URL and update `BACKEND_URL` in `extension/background.js`.

---

## How It Works

```
User browses WhatsApp / Instagram
        │
        ▼
Content Script (MutationObserver)
  detects new message / post
        │
        ▼
Background Service Worker
  → POST /analyze/text  (HuggingFace API)
  → POST /analyze/video (Backend / Phase 2)
        │
        ▼
Result: { label, confidence }
        │
   FAKE & conf ≥ threshold?
   ├─ YES → inject ⚠️ warning badge/banner
   └─ NO  → inject ✅ credible label (auto-hides)
```

---

## Environment Variables

Create `backend/.env`:

```
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Roadmap

- [x] Phase 1 – Project scaffold & text analysis
- [ ] Phase 2 – Real deepfake detection (EfficientNet-B4 / ONNX)
- [ ] Phase 3 – Image reverse-search for manipulated photos
- [ ] Phase 4 – Source credibility scoring
- [ ] Phase 5 – Firefox support

---

## License

MIT © 2025 [ShyamAlancode](https://github.com/ShyamAlancode)
