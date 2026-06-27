"""
MODULE 1 — FastAPI Backend (frontend/app.py)
=============================================
The REST API that the Lovable frontend talks to.
Also the entry point for Baseten deployment.

Endpoints:
  POST /chat         — send a text message (+ optional image/video)
  POST /transcribe   — send an audio file, get back transcribed text
  GET  /health       — health check (for Baseten / monitoring)

Running locally:
    uvicorn frontend.app:app --reload --port 8000

Exposing to Lovable via ngrok:
    ngrok http 8000
    # Copy the https://xxxx.ngrok.io URL into your Lovable project

Deploying to Baseten (for teammates):
    baseten deploy frontend/app.py
    # Share the Baseten URL with teammates
"""

import os
import sys
import uuid
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Add parent dir so we can import sibling modules
sys.path.append(str(Path(__file__).parent.parent))

from agent.triage_agent import run_triage_turn
from voice.voice import transcribe_file, text_to_speech

load_dotenv()

# ── App setup ─────────────────────────────────────────────────
app = FastAPI(
    title="Clinical Triage Agent API",
    description="First-aid triage assistant — for prototype use only",
    version="0.1.0"
)

# CORS: allow Lovable (and localhost) to call this API.
# In production, restrict origins to your specific Lovable domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # Lock this down before any real deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory session store ───────────────────────────────────
# Maps session_id → conversation history (list of LangChain messages)
# For a real deployment, replace with Redis or a database.
sessions: dict[str, list] = {}


# ── Request / Response models ─────────────────────────────────

class ChatResponse(BaseModel):
    session_id: str
    response:   str          # Agent's text response
    audio_url:  Optional[str] = None  # Future: URL to TTS audio file


class TranscribeResponse(BaseModel):
    text: str                # Whisper transcription of uploaded audio


class HealthResponse(BaseModel):
    status: str


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health_check():
    """
    Simple health check. Baseten and monitoring tools call this.
    Returns 200 OK if the server is up.
    """
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(
    message:    str           = Form(...),
    session_id: Optional[str] = Form(None),
    image:      Optional[UploadFile] = File(None),
):
    """
    Main chat endpoint. Called by the Lovable frontend on every user message.

    Form fields:
      message:    The user's text (required)
      session_id: Conversation session ID (optional — created on first turn)
      image:      An uploaded image file (optional — for visual assessment)

    Returns:
      session_id: Use this in all subsequent requests for the same conversation
      response:   The agent's text response (including any escalation notice)

    How Lovable calls this:
      const formData = new FormData();
      formData.append("message", userText);
      formData.append("session_id", sessionId);
      if (imageFile) formData.append("image", imageFile);

      const res = await fetch("https://YOUR_NGROK_OR_BASETEN_URL/chat", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
    """

    # Create a new session if none provided
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    # Retrieve existing conversation history for this session
    history = sessions.get(session_id, [])

    # Handle optional image upload
    image_path = None
    if image:
        # Save the uploaded image to a temp file
        suffix = Path(image.filename).suffix if image.filename else ".jpg"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(await image.read())
        tmp.close()
        image_path = tmp.name

    try:
        # Run one turn of the triage conversation
        response_text, updated_history = run_triage_turn(
            user_text=message,
            conversation_history=history,
            image_path=image_path
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")
    finally:
        # Clean up temp image file
        if image_path:
            Path(image_path).unlink(missing_ok=True)

    # Save the updated history back to the session store
    sessions[session_id] = updated_history

    return ChatResponse(
        session_id=session_id,
        response=response_text
    )


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...)
):
    """
    Accepts an audio recording (WAV, MP3, M4A, WEBM) and returns
    the Whisper transcription as text.

    The Lovable frontend records audio in the browser using the
    MediaRecorder API and sends the blob here.

    How Lovable calls this:
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const res = await fetch("https://YOUR_URL/transcribe", {
        method: "POST",
        body: formData
      });
      const { text } = await res.json();
      // Then send `text` to /chat as the user's message
    """
    suffix = Path(audio.filename).suffix if audio.filename else ".webm"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(await audio.read())
    tmp.close()

    try:
        text = transcribe_file(tmp.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    finally:
        Path(tmp.name).unlink(missing_ok=True)

    return TranscribeResponse(text=text)


@app.post("/tts")
async def tts(text: str = Form(...)):
    """
    Converts text to speech using ElevenLabs and returns the audio as bytes.
    Optional — the Lovable frontend can also call ElevenLabs directly
    if you want to avoid routing audio through your backend.

    Returns: audio/mpeg bytes
    """
    from fastapi.responses import Response

    audio_bytes = text_to_speech(text)
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="TTS generation failed")

    return Response(content=audio_bytes, media_type="audio/mpeg")
