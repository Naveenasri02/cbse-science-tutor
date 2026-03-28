"""
CBSE Voice Chat Server — All-in-One GPU Backend
STT (faster-whisper) + LLM (vLLM/OpenAI) + TTS (Kokoro) on single GPU.
Streaming WebSocket pipeline with barge-in support.
"""

import asyncio
import json
import io
import re
import wave
import time
import numpy as np
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import config

# ── Load Models ─────────────────────────────────────────────

print("🔧 Loading models...")

print("  [1/3] STT...")
from stt.whisper_stt import WhisperSTT
stt = WhisperSTT()
print("  ✓ STT ready")

print("  [2/3] TTS...")
from tts.kokoro_tts import KokoroTTS
tts = KokoroTTS()
print("  ✓ TTS ready")

print("  [3/3] LLM client...")
from openai import AsyncOpenAI
llm_client = AsyncOpenAI(
    api_key=config.VLLM_API_KEY,
    base_url=config.VLLM_BASE_URL,
)
print("  ✓ LLM ready")

# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(title="CBSE Voice Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve React build if available
_static = Path(__file__).parent / "static"
if _static.exists():
    @app.get("/")
    async def index():
        return FileResponse(_static / "index.html")
    app.mount("/static", StaticFiles(directory=_static), name="static")
    # Catch-all for React Router (SPA)
    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        file = _static / path
        if file.exists() and file.is_file():
            return FileResponse(file)
        return FileResponse(_static / "index.html")


# ── Helpers ─────────────────────────────────────────────────

def float32_to_wav(audio_f32: np.ndarray, sr: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        pcm = np.clip(audio_f32 * 32767, -32768, 32767).astype(np.int16)
        wf.writeframes(pcm.tobytes())
    buf.seek(0)
    return buf.read()


_MD_STRIP = [
    (re.compile(r'<think>.*?</think>', re.DOTALL), ''),
    (re.compile(r'#{1,6}\s*'), ''),
    (re.compile(r'\*\*\*(.+?)\*\*\*'), r'\1'),
    (re.compile(r'\*\*(.+?)\*\*'), r'\1'),
    (re.compile(r'\*(.+?)\*'), r'\1'),
    (re.compile(r'`{1,3}[^`]*`{1,3}'), ''),
    (re.compile(r'\$\$[^$]*\$\$'), ''),
    (re.compile(r'\$[^$]*\$'), ''),
    (re.compile(r'\[([^\]]+)\]\([^)]+\)'), r'\1'),
    (re.compile(r'^[-*]\s+', re.MULTILINE), ''),
    (re.compile(r'^\d+\.\s+', re.MULTILINE), ''),
    (re.compile(r'\|[^|]*\|'), ' '),
    (re.compile(r'^[-|:\s]+$', re.MULTILINE), ''),
    (re.compile(r'---+'), ''),
    (re.compile(r'[*_~`#|>]'), ''),
    (re.compile(r'\n{2,}'), '. '),
    (re.compile(r'\s{2,}'), ' '),
]


def strip_md_for_tts(text: str) -> str:
    for pat, repl in _MD_STRIP:
        text = pat.sub(repl, text)
    return text.strip()


# ── WebSocket Voice Handler ────────────────────────────────

@app.websocket("/ws/voice")
async def voice_endpoint(ws: WebSocket):
    await ws.accept()
    print("🔌 Client connected")

    conversation_history = [
        {"role": "system", "content": config.SYSTEM_PROMPT}
    ]
    pipeline_task = None

    async def cancel_pipeline(notify=True):
        nonlocal pipeline_task
        if pipeline_task and not pipeline_task.done():
            pipeline_task.cancel()
            try:
                await pipeline_task
            except (asyncio.CancelledError, Exception):
                pass
            if notify:
                try:
                    await ws.send_json({"type": "llm_done", "interrupted": True})
                    await ws.send_json({"type": "tts_done"})
                except Exception:
                    pass
        pipeline_task = None

    async def run_voice_pipeline(transcript: str):
        """Stream LLM → TTS. Cancellation-safe. Skips <think> blocks for TTS."""
        full_reply = ""
        tts_buffer = ""
        in_think = False
        first_tts_sent = False
        t0 = time.perf_counter()

        # Voice-optimized messages: short answers, no thinking
        voice_messages = [
            {"role": "system", "content": config.VOICE_SYSTEM_PROMPT},
            *conversation_history[1:],  # skip original system prompt
        ]

        try:
            await ws.send_json({"type": "llm_start"})

            stream = await llm_client.chat.completions.create(
                model=config.VLLM_MODEL,
                messages=voice_messages,
                stream=True,
                max_tokens=150,
                temperature=0.3,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_reply += delta
                    await ws.send_json({"type": "llm_delta", "text": delta})

                    # Track <think> blocks — don't TTS reasoning
                    if "<think>" in delta:
                        in_think = True
                        tts_buffer = ""
                    if "</think>" in delta:
                        in_think = False
                        tts_buffer = ""
                        continue

                    if not in_think:
                        tts_buffer += delta
                        stripped = tts_buffer.strip()
                        # Send TTS early: first chunk at 30+ chars, then at sentence boundaries
                        should_send = False
                        if not first_tts_sent and len(stripped) >= 30 and any(stripped.endswith(p) for p in [".", "!", "?", ",", ":", ";"]):
                            should_send = True
                        elif first_tts_sent and any(stripped.endswith(p) for p in [".", "!", "?", "\n"]):
                            should_send = True
                        if should_send:
                            await _send_tts(ws, stripped)
                            tts_buffer = ""
                            first_tts_sent = True

            if tts_buffer.strip() and not in_think:
                await _send_tts(ws, tts_buffer.strip())

            await ws.send_json({"type": "llm_done"})
            await ws.send_json({"type": "tts_done"})

            if full_reply:
                clean = re.sub(r'<think>.*?</think>\s*', '', full_reply, flags=re.DOTALL).strip()
                if clean:
                    conversation_history.append({"role": "assistant", "content": clean})
                    if len(conversation_history) > 21:
                        del conversation_history[1:-20]

            print(f"✅ [{time.perf_counter()-t0:.2f}s] Voice reply: {full_reply[:60]}...")

        except asyncio.CancelledError:
            print(f"⚡ Voice pipeline cancelled: {full_reply[:40]}...")
            if full_reply:
                clean = re.sub(r'<think>.*?</think>\s*', '', full_reply, flags=re.DOTALL).strip()
                if clean:
                    conversation_history.append({"role": "assistant", "content": clean})
                    if len(conversation_history) > 21:
                        del conversation_history[1:-20]
            raise
        except Exception as e:
            print(f"❌ Pipeline error: {e}")
            try:
                await ws.send_json({"type": "error", "text": str(e)})
                await ws.send_json({"type": "llm_done"})
                await ws.send_json({"type": "tts_done"})
            except Exception:
                pass

    try:
        while True:
            message = await ws.receive()

            # ── Text control messages ──
            if "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type", "")

                if msg_type == "interrupt":
                    print("⚡ Barge-in")
                    await cancel_pipeline()

                elif msg_type == "text_chat":
                    user_text = data.get("text", "").strip()
                    if not user_text:
                        continue

                    # Topic filter
                    if not config.is_cbse_related(user_text):
                        await ws.send_json({"type": "llm_start"})
                        await ws.send_json({"type": "llm_delta", "text": config.REJECT_MSG})
                        await ws.send_json({"type": "llm_done"})
                        continue

                    conversation_history.append({"role": "user", "content": user_text})
                    await ws.send_json({"type": "llm_start"})

                    full_reply = ""
                    try:
                        stream = await llm_client.chat.completions.create(
                            model=config.VLLM_MODEL,
                            messages=conversation_history,
                            stream=True,
                            max_tokens=2048,
                        )
                        async for chunk in stream:
                            delta = chunk.choices[0].delta.content
                            if delta:
                                full_reply += delta
                                await ws.send_json({"type": "llm_delta", "text": delta})
                    except Exception as e:
                        await ws.send_json({"type": "error", "text": str(e)})
                        continue

                    await ws.send_json({"type": "llm_done"})

                    if full_reply:
                        clean = re.sub(r'<think>.*?</think>\s*', '', full_reply, flags=re.DOTALL).strip()
                        conversation_history.append({"role": "assistant", "content": clean})
                        if len(conversation_history) > 21:
                            del conversation_history[1:-20]

                continue

            # ── Binary audio from browser ──
            if "bytes" in message:
                audio_bytes = message["bytes"]
                await cancel_pipeline()

                t0 = time.perf_counter()

                # Detect format: webm starts with 0x1A45DFA3 (EBML header)
                is_webm = len(audio_bytes) > 4 and audio_bytes[:4] == b'\x1a\x45\xdf\xa3'

                if is_webm:
                    # Decode webm → WAV using ffmpeg
                    try:
                        import subprocess
                        proc = subprocess.run(
                            ["ffmpeg", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
                            input=audio_bytes, capture_output=True, timeout=5
                        )
                        if proc.returncode != 0:
                            print(f"❌ ffmpeg error: {proc.stderr.decode()[:100]}")
                            continue
                        wav_bytes = proc.stdout
                    except FileNotFoundError:
                        # ffmpeg not available, try decoding as raw float32 fallback
                        print("⚠️ ffmpeg not found, trying raw float32 decode")
                        audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                        if len(audio_f32) < 1600:
                            continue
                        wav_bytes = float32_to_wav(audio_f32, sr=16000)
                    except Exception as e:
                        print(f"❌ Audio decode error: {e}")
                        continue
                else:
                    # Raw Float32 PCM (legacy)
                    audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                    if len(audio_f32) < 1600:
                        continue
                    wav_bytes = float32_to_wav(audio_f32, sr=16000)

                # STT in executor (blocking call)
                try:
                    loop = asyncio.get_event_loop()
                    transcript = await loop.run_in_executor(None, stt.transcribe, wav_bytes)
                except Exception as e:
                    print(f"❌ STT error: {e}")
                    await ws.send_json({"type": "error", "text": f"STT error: {e}"})
                    continue

                if not transcript or len(transcript.strip()) < 2:
                    await ws.send_json({"type": "vad_no_speech"})
                    continue

                print(f"🎤 [{time.perf_counter()-t0:.2f}s] User: {transcript}")

                # Topic filter
                if not config.is_cbse_related(transcript):
                    await ws.send_json({"type": "user_transcript", "text": transcript})
                    await ws.send_json({"type": "llm_start"})
                    await ws.send_json({"type": "llm_delta", "text": config.REJECT_MSG})
                    await ws.send_json({"type": "llm_done"})
                    await _send_tts(ws, config.REJECT_MSG)
                    await ws.send_json({"type": "tts_done"})
                    continue

                await ws.send_json({"type": "user_transcript", "text": transcript})
                conversation_history.append({"role": "user", "content": transcript})

                pipeline_task = asyncio.create_task(run_voice_pipeline(transcript))

    except (WebSocketDisconnect, RuntimeError):
        await cancel_pipeline(notify=False)
        print("🔌 Client disconnected")
    except Exception as e:
        print(f"❌ WS error: {e}")
        import traceback; traceback.print_exc()


async def _send_tts(ws: WebSocket, text: str):
    """Generate TTS and send as binary audio."""
    clean = strip_md_for_tts(text)
    if not clean:
        return
    try:
        t0 = time.perf_counter()
        loop = asyncio.get_event_loop()
        wav_bytes = await loop.run_in_executor(None, tts.to_wav_bytes, clean)
        print(f"🔊 TTS [{time.perf_counter()-t0:.3f}s] {len(clean)} chars -> {len(wav_bytes)//1024}KB")
        await ws.send_json({"type": "tts_start"})
        await ws.send_bytes(wav_bytes)
    except Exception as e:
        print(f"❌ TTS error: {e}")


# ── Health check ────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "model": config.VLLM_MODEL}


# ── Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"\n🚀 Starting server on port {config.SERVER_PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=config.SERVER_PORT, log_level="info")
