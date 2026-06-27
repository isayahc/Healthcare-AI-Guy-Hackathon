"""
MODULE 2 — Voice Layer (voice/voice.py)
========================================
Handles two directions of voice I/O:
  - STT (Speech → Text): Records from the mic and transcribes with Whisper
  - TTS (Text → Speech): Sends agent responses to ElevenLabs and plays them

Testing options:
  1. Full local test (mic + playback):
         python voice/voice.py

  2. TTS only — test in ElevenLabs playground:
     - Go to https://elevenlabs.io/app/speech-synthesis
     - Select your voice (default: Rachel)
     - Paste any agent response and click Generate
     - This lets you tune the voice BEFORE wiring it into the app

  3. STT only — test with a pre-recorded file:
         python voice/voice.py --stt-file /path/to/audio.wav
"""

import os
import sys
import wave
import tempfile
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")

# ── Text-to-Speech (ElevenLabs) ──────────────────────────────

def text_to_speech(text: str, output_path: str | None = None) -> bytes:
    """
    Converts agent response text to speech using ElevenLabs.

    Args:
        text:        The agent's response text to speak aloud
        output_path: Optional path to save the audio file (.mp3)

    Returns:
        Raw audio bytes (can be streamed or saved)

    To test the voice independently:
      → Go to https://elevenlabs.io/app/speech-synthesis
      → Paste any sample agent response text
      → Adjust voice, stability, and similarity until the tone feels right
      → Note the voice ID from the URL and put it in your .env
    """
    try:
        from elevenlabs import ElevenLabs, play
        from elevenlabs.client import ElevenLabs as ElevenLabsClient
    except ImportError:
        print("ElevenLabs not installed. Run: pip install elevenlabs")
        return b""

    client = ElevenLabsClient(api_key=ELEVENLABS_API_KEY)

    # Voice settings tuned for a calm, clinical-but-warm tone:
    # - stability: 0.6 (not robotic, not too expressive)
    # - similarity_boost: 0.8 (stays close to the chosen voice)
    audio = client.generate(
        text=text,
        voice=ELEVENLABS_VOICE_ID,
        model="eleven_turbo_v2",   # Fast model, good for real-time response
        voice_settings={
            "stability": 0.6,
            "similarity_boost": 0.8,
            "style": 0.2,          # Slight warmth without overdoing it
            "use_speaker_boost": True
        }
    )

    # Collect the generator into bytes
    audio_bytes = b"".join(audio)

    # Optionally save to file
    if output_path:
        with open(output_path, "wb") as f:
            f.write(audio_bytes)
        print(f"Audio saved to: {output_path}")

    return audio_bytes


def play_audio(audio_bytes: bytes):
    """
    Plays audio bytes through the system's default speaker.
    Requires 'pyaudio' and the audio to be in MP3 format.
    Falls back to saving a temp file and using the system player if needed.
    """
    try:
        from elevenlabs import play
        play(audio_bytes)
    except Exception as e:
        # Fallback: save to temp file and open with system player
        print(f"Direct playback failed ({e}), saving to temp file...")
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name
        os.system(f"open '{tmp_path}'" if sys.platform == "darwin"
                  else f"xdg-open '{tmp_path}'")


# ── Speech-to-Text (Whisper) ─────────────────────────────────

def record_audio(duration_seconds: int = 10, sample_rate: int = 16000) -> str:
    """
    Records audio from the microphone and saves it to a temp WAV file.
    Returns the path to the WAV file.

    Requires: pip install pyaudio
    If pyaudio fails to install, try: conda install pyaudio
    """
    try:
        import pyaudio
    except ImportError:
        print("pyaudio not installed. Run: pip install pyaudio")
        return ""

    print(f"Recording for {duration_seconds} seconds... (speak now)")

    p = pyaudio.PyAudio()
    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=sample_rate,
        input=True,
        frames_per_buffer=1024
    )

    frames = []
    for _ in range(0, int(sample_rate / 1024 * duration_seconds)):
        data = stream.read(1024)
        frames.append(data)

    stream.stop_stream()
    stream.close()
    p.terminate()
    print("Recording complete.")

    # Save to a temp WAV file
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(p.get_sample_size(pyaudio.paInt16))
        wf.setframerate(sample_rate)
        wf.writeframes(b"".join(frames))

    return tmp.name


def transcribe_audio(audio_path: str) -> str:
    """
    Transcribes an audio file using OpenAI Whisper (runs locally).
    Returns the transcribed text.

    First run will download the 'base' Whisper model (~140MB).
    For better accuracy at the cost of speed, use model='small' or 'medium'.
    """
    try:
        import whisper
    except ImportError:
        print("Whisper not installed. Run: pip install openai-whisper")
        return ""

    print("Transcribing...")
    model = whisper.load_model("base")   # Downloads on first use
    result = model.transcribe(audio_path)
    text = result["text"].strip()
    print(f"Transcribed: {text}")
    return text


def speech_to_text(duration_seconds: int = 10) -> str:
    """
    Full pipeline: record from mic → transcribe with Whisper → return text.
    """
    audio_path = record_audio(duration_seconds=duration_seconds)
    if not audio_path:
        return ""
    text = transcribe_audio(audio_path)
    Path(audio_path).unlink(missing_ok=True)  # Clean up temp file
    return text


def transcribe_file(audio_path: str) -> str:
    """
    Transcribes a pre-existing audio file (WAV, MP3, M4A, etc).
    Useful for testing without a microphone.
    """
    return transcribe_audio(audio_path)


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Voice layer test")
    parser.add_argument("--stt-file", type=str,
                        help="Path to audio file for STT test (skips mic recording)")
    parser.add_argument("--tts-only", action="store_true",
                        help="Only test TTS with a sample phrase")
    args = parser.parse_args()

    # ── TTS test ──
    sample_text = (
        "It sounds like you may have a mild ankle sprain. "
        "Try to rest the ankle, apply an ice pack wrapped in a cloth for about "
        "20 minutes, and keep it elevated above your heart if you can. "
        "How would you describe the swelling — is it mild, or does it look quite puffy?"
    )

    print("\n── Voice Layer Test ──\n")
    print("Testing TTS (ElevenLabs)...")
    print(f"Text: {sample_text}\n")
    audio = text_to_speech(sample_text, output_path="voice/sample_output.mp3")
    if audio:
        print("Playing audio...")
        play_audio(audio)

    if args.tts_only:
        sys.exit(0)

    # ── STT test ──
    if args.stt_file:
        print(f"\nTesting STT on file: {args.stt_file}")
        result = transcribe_file(args.stt_file)
    else:
        print("\nTesting STT (microphone)...")
        result = speech_to_text(duration_seconds=8)

    print(f"\nSTT result: '{result}'")
