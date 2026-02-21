"""
VERO Backend API - Optional advanced features
Deploy on Render or Vercel free tier
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
from dotenv import load_dotenv
import httpx
from typing import Optional
import json

load_dotenv()

app = FastAPI(title="VERO API", description="Misinformation detection backend")

# CORS config to allow Chrome extension and web platforms
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to chrome-extension://<id>
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

class TextRequest(BaseModel):
    text: str
    language: Optional[str] = "en"

class FactCheckResponse(BaseModel):
    isFake: bool
    isMisleading: bool
    confidence: int
    label: str
    explanation: str
    source: Optional[str] = None
    sourceUrl: Optional[str] = None

@app.get("/")
async def root():
    return {"message": "VERO API is active", "version": "1.0.0"}

@app.post("/api/verify", response_model=FactCheckResponse)
async def verify_text(request: TextRequest):
    """Verify text for misinformation using Gemini 1.5 Flash"""
    
    if not GEMINI_API_KEY:
        # Fallback Mock logic for hackathon demo if key is missing
        if "5000" in request.text or "govt" in request.text.lower():
            return FactCheckResponse(
                isFake=True,
                isMisleading=True,
                confidence=95,
                label="FAKE",
                explanation="PIB fact-checked this content. No such government scheme exists.",
                source="PIB Fact Check",
                sourceUrl="https://pib.gov.in/factcheck"
            )
        return FactCheckResponse(
            isFake=False, isMisleading=False, confidence=0, 
            label="UNKNOWN", explanation="", source=None, sourceUrl=null
        )
    
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = f"""
        Analyze the following text for potential misinformation or fake news.
        Respond ONLY with a valid JSON object:
        {{
            "isFake": boolean,
            "isMisleading": boolean,
            "confidence": 0-100,
            "label": "FAKE" | "MISLEADING" | "VERIFIED" | "UNKNOWN",
            "explanation": "Brief 1-line explanation",
            "source": "FactCheck Source Name",
            "sourceUrl": "URL if available"
        }}
        Text: "{request.text}"
        """
        
        response = model.generate_content(prompt)
        # Attempt to parse JSON from Markdown or raw text
        raw_text = response.text
        json_match = raw_text.match(/\{.*\}/s) if hasattr(raw_text, 'match') else raw_text[raw_text.find('{'):raw_text.rfind('}')+1]
        result = json.loads(json_match)
        
        return FactCheckResponse(**result)
    except Exception as e:
        print(f"VERO Backend Error: {e}")
        raise HTTPException(status_code=500, detail="Internal analysis failure")

@app.get("/api/health")
async def health():
    return {"status": "healthy"}
