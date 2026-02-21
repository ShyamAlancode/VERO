"""
VERO Backend API – Powered by Gemini + NewsAPI + PIB
Deploy on Render (free tier) or Vercel.
"""
import os
import json
import re
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyBQ7Mjoahx1BXChaofqafBEgs3Tj_RdlcU")
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "241b1aba62fd438aa81630a8e35f666e")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

app = FastAPI(title="VERO API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ────────────────────────────────────────────
class TextRequest(BaseModel):
    text: str
    language: Optional[str] = "en"

class VerifyResponse(BaseModel):
    isFake: bool
    isMisleading: bool
    confidence: int
    label: str
    explanation: str
    source: Optional[str] = None
    sourceUrl: Optional[str] = None
    newsContext: Optional[list] = None
    pibUrl: Optional[str] = None


# ─── Routes ────────────────────────────────────────────
@app.get("/")
async def root():
    return {"service": "VERO API", "status": "healthy", "version": "1.1.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/verify", response_model=VerifyResponse)
async def verify_text(req: TextRequest):
    """Full pipeline: NewsAPI context → PIB link → Gemini analysis"""

    # 1. Fetch news context
    news_context = ""
    news_articles = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://newsapi.org/v2/everything",
                params={"q": req.text[:100], "sortBy": "relevancy", "pageSize": 3, "apiKey": NEWSAPI_KEY}
            )
            if r.status_code == 200:
                articles = r.json().get("articles", [])
                news_articles = [{"title": a["title"], "source": a["source"]["name"], "url": a["url"]} for a in articles]
                if news_articles:
                    news_context = "\n\nRelated news:\n" + "\n".join(f'- "{a["title"]}" ({a["source"]})' for a in news_articles)
    except Exception:
        pass

    # 2. PIB link
    pib_url = f"https://factcheck.pib.gov.in/?s={req.text[:80]}"

    # 3. Gemini analysis
    prompt = f"""You are VERO, an AI fact-checker. Analyze this text for misinformation.
{news_context}

Text: "{req.text}"

Respond ONLY with valid JSON (no markdown):
{{"isFake": boolean, "isMisleading": boolean, "confidence": 0-100, "label": "FAKE"|"MISLEADING"|"VERIFIED"|"UNKNOWN", "explanation": "1-line reason", "source": "Source name", "sourceUrl": "URL"}}"""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{GEMINI_URL}?key={GEMINI_KEY}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.15, "maxOutputTokens": 512}
                }
            )
            r.raise_for_status()
            raw = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            result = json.loads(match.group()) if match else {}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {str(e)}")

    return VerifyResponse(
        isFake=result.get("isFake", False),
        isMisleading=result.get("isMisleading", False),
        confidence=result.get("confidence", 0),
        label=result.get("label", "UNKNOWN"),
        explanation=result.get("explanation", ""),
        source=result.get("source"),
        sourceUrl=result.get("sourceUrl"),
        newsContext=news_articles,
        pibUrl=pib_url
    )


@app.get("/api/news")
async def get_news(q: str):
    """Proxy endpoint for NewsAPI"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://newsapi.org/v2/everything",
                params={"q": q[:100], "sortBy": "relevancy", "pageSize": 5, "apiKey": NEWSAPI_KEY}
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/pib")
async def pib_search(q: str):
    """Returns PIB fact-check link"""
    return {"pibUrl": f"https://factcheck.pib.gov.in/?s={q[:80]}", "message": "Visit PIB Fact Check for official verification"}
