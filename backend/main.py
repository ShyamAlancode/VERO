"""
VERO – FastAPI Backend
Free-tier misinformation and deepfake detection API.
Deploy to Vercel for free hosting.
"""

import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="VERO API",
    description="Real-time misinformation and deepfake detection backend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "https://web.whatsapp.com",
        "https://www.instagram.com",
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
HF_TOKEN = os.getenv("HF_TOKEN", "")
HF_TEXT_MODEL = "hamzab/roberta-fake-news-classification"
HF_API_BASE = "https://api-inference.huggingface.co/models"


# ── Schemas ───────────────────────────────────────────────────────────────────
class TextRequest(BaseModel):
    text: str


class VideoRequest(BaseModel):
    video_url: str


class AnalysisResult(BaseModel):
    label: str          # "FAKE" | "REAL" | "DEEPFAKE" | "AUTHENTIC" | "UNKNOWN"
    confidence: float   # 0.0 – 1.0
    detail: str = ""


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": "VERO API", "version": "1.0.0"}


# ── Text analysis ─────────────────────────────────────────────────────────────
@app.post("/analyze/text", response_model=AnalysisResult)
async def analyze_text(req: TextRequest):
    text = req.text.strip()
    if len(text) < 20:
        return AnalysisResult(label="SKIP", confidence=0.0, detail="Text too short")

    headers = {"Content-Type": "application/json"}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{HF_API_BASE}/{HF_TEXT_MODEL}",
                json={"inputs": text},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        # HuggingFace returns [[{label, score}, ...]]
        results = data[0] if isinstance(data[0], list) else data
        top = max(results, key=lambda x: x["score"])

        label = "FAKE" if "fake" in top["label"].lower() else "REAL"
        return AnalysisResult(label=label, confidence=round(top["score"], 4))

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="HuggingFace API timeout")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"HF API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Video / deepfake analysis ─────────────────────────────────────────────────
@app.post("/analyze/video", response_model=AnalysisResult)
async def analyze_video(req: VideoRequest):
    """
    Phase 1: Returns a mock result.
    Phase 2: Wire a real deepfake detection model
             (e.g. EfficientNet-B4 via ONNX Runtime, or a free HF space).
    """
    video_url = req.video_url.strip()
    if not video_url:
        return AnalysisResult(label="SKIP", confidence=0.0, detail="No URL provided")

    # TODO (Phase 2): Call deepfake detection model
    # For now, return AUTHENTIC as a safe default
    return AnalysisResult(
        label="AUTHENTIC",
        confidence=0.51,
        detail="Phase 1 mock – deepfake model wiring in Phase 2",
    )
