"""
VERO Backend API - Optional advanced features
Deploy on Render free tier
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

# CORS for extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    return {"message": "VERO API is running", "status": "active"}

@app.post("/api/verify", response_model=FactCheckResponse)
async def verify_text(request: TextRequest):
    """Verify text for misinformation"""
    
    # If no API key, return mock response for demo
    if not GEMINI_API_KEY:
        # Simple mock logic
        if "5000" in request.text.lower() or "govt" in request.text.lower():
            return FactCheckResponse(
                isFake=True,
                isMisleading=True,
                confidence=95,
                label="FAKE",
                explanation="PIB fact-checked this in 2023. No such scheme exists.",
                source="PIB Fact Check",
                sourceUrl="https://pib.gov.in/factcheck"
            )
        return FactCheckResponse(
            isFake=False,
            isMisleading=False,
            confidence=0,
            label="UNKNOWN",
            explanation="",
            source=None,
            sourceUrl=None
        )
    
    # Use Gemini for fact-checking
    model = genai.GenerativeModel('gemini-1.5-flash')
    
    prompt = f"""
    You are a fact-checking AI. Analyze this message for misinformation:
    
    "{request.text}"
    
    Respond with a JSON object only:
    {{
        "isFake": boolean,
        "isMisleading": boolean,
        "confidence": 0-100,
        "label": "FAKE" or "MISLEADING" or "VERIFIED" or "UNKNOWN",
        "explanation": "Brief 1-line explanation",
        "source": "Source name if available",
        "sourceUrl": "URL if available"
    }}
    """
    
    try:
        response = model.generate_content(prompt)
        # Extract JSON from response
        text = response.text
        json_match = text.split('{', 1)[-1].rsplit('}', 1)[0]
        json_str = '{' + json_match + '}'
        result = json.loads(json_str)
        
        return FactCheckResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health():
    return {"status": "healthy"}

# To run: uvicorn main:app --reload
