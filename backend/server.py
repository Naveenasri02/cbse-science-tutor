"""
CBSE Voice Chat Server — All-in-One GPU Backend
STT (faster-whisper) + LLM (vLLM) + TTS (Voxtral via vllm-omni) on single GPU.
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

print("  [1/3] TTS client...")
from tts.voxtral_tts import VoxtralTTSEngine
tts = VoxtralTTSEngine()
print("  ✓ TTS ready")

print("  [2/3] STT...")
from stt.whisper_stt import WhisperSTT
stt = WhisperSTT()
print("  ✓ STT ready")

print("  [3/3] LLM client...")
from openai import AsyncOpenAI
llm_client = AsyncOpenAI(
    api_key=config.VLLM_API_KEY,
    base_url=config.VLLM_BASE_URL,
)
import httpx
_llm_http = httpx.AsyncClient(
    base_url=config.VLLM_BASE_URL.rstrip("/v1"),
    timeout=30.0,
    headers={"Authorization": f"Bearer {config.VLLM_API_KEY}"},
)
print("  ✓ LLM ready")


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~3.5 chars per token for English."""
    return max(1, len(text) // 4)


def _build_chatml_prompt(messages: list, prefill: str = "", max_ctx: int = 3200) -> str:
    """Build a ChatML prompt string with optional assistant pre-fill.
    Trims older messages (keeping system prompt) to stay within max_ctx tokens."""
    # Always keep system prompt (first message) and prefill overhead
    overhead = _estimate_tokens(prefill) + 50  # assistant header + prefill + stop tokens
    system_cost = _estimate_tokens(messages[0]["content"]) + 10 if messages else 0
    budget = max_ctx - overhead - system_cost

    # Walk from newest to oldest (skip system at index 0), accumulate until budget exhausted
    kept = []
    for m in reversed(messages[1:]):
        cost = _estimate_tokens(m["content"]) + 10  # header tokens
        if budget - cost < 0:
            break
        budget -= cost
        kept.append(m)
    kept.reverse()

    final = [messages[0]] + kept if messages else kept
    parts = []
    for m in final:
        parts.append(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>")
    parts.append(f"<|im_start|>assistant\n{prefill}")
    return "\n".join(parts)

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
        """Stream LLM → TTS concurrently. TTS runs in background while LLM keeps streaming."""
        full_reply = ""
        tts_buffer = ""
        first_tts_sent = False
        t0 = time.perf_counter()
        tts_tasks = []  # track background TTS tasks
        llm_first_token_time = None  # track when first token arrived

        voice_messages = [
            {"role": "system", "content": config.VOICE_SYSTEM_PROMPT},
            *conversation_history[1:],
        ]
        prompt = _build_chatml_prompt(voice_messages, prefill="<think>\n\n</think>\n\n")

        try:
            await ws.send_json({"type": "llm_start"})

            async with _llm_http.stream(
                "POST", "/v1/completions",
                json={
                    "prompt": prompt,
                    "max_tokens": 60,
                    "temperature": 0.0,
                    "stop": ["<|im_end|>"],
                    "stream": True,
                    "cache_prompt": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue
                    chunk = json.loads(line[6:])
                    delta = chunk["choices"][0].get("text", "")
                    if not delta:
                        continue

                    if llm_first_token_time is None:
                        llm_first_token_time = time.perf_counter()

                    full_reply += delta
                    await ws.send_json({"type": "llm_delta", "text": delta})

                    tts_buffer += delta
                    send_text = ""

                    # Strategy: split at punctuation OR after enough words
                    split_chars = ".,!?;:" if not first_tts_sent else ".!?,"
                    split_idx = -1
                    for sc in split_chars:
                        idx = tts_buffer.rfind(sc)
                        if idx > split_idx:
                            split_idx = idx

                    if split_idx >= 0:
                        candidate = tts_buffer[:split_idx + 1].strip()
                        min_len = 5 if not first_tts_sent else 3
                        if len(candidate) >= min_len:
                            send_text = candidate
                            tts_buffer = tts_buffer[split_idx + 1:]
                    elif not first_tts_sent:
                        # Fallback: send first chunk after 4 complete words
                        words = tts_buffer.strip().split()
                        if len(words) >= 4 and len(tts_buffer) > len(tts_buffer.rstrip()):
                            send_text = tts_buffer.strip()
                            tts_buffer = ""

                    if send_text:
                        task = asyncio.create_task(_send_tts(ws, send_text))
                        tts_tasks.append(task)
                        first_tts_sent = True

            # Send remaining buffer
            if tts_buffer.strip():
                task = asyncio.create_task(_send_tts(ws, tts_buffer.strip()))
                tts_tasks.append(task)

            await ws.send_json({"type": "llm_done"})

            # Wait for all TTS tasks to finish
            if tts_tasks:
                await asyncio.gather(*tts_tasks, return_exceptions=True)

            await ws.send_json({"type": "tts_done"})

            if full_reply:
                conversation_history.append({"role": "assistant", "content": full_reply.strip()})
                if len(conversation_history) > 21:
                    del conversation_history[1:-20]

            print(f"✅ [{time.perf_counter()-t0:.2f}s] Voice reply: {full_reply[:60]}...")

        except asyncio.CancelledError:
            print(f"⚡ Voice pipeline cancelled: {full_reply[:40]}...")
            for t in tts_tasks:
                t.cancel()
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

                    # Use raw completions with think pre-fill for instant answers
                    prompt = _build_chatml_prompt(conversation_history, prefill="<think>\n\n</think>\n\n")
                    full_reply = ""
                    try:
                        async with _llm_http.stream(
                            "POST", "/v1/completions",
                            json={
                                "prompt": prompt,
                                "max_tokens": 512,
                                "temperature": 0.3,
                                "stop": ["<|im_end|>"],
                                "stream": True,
                                "cache_prompt": True,
                            },
                        ) as resp:
                            async for line in resp.aiter_lines():
                                if not line.startswith("data: ") or line == "data: [DONE]":
                                    continue
                                chunk = json.loads(line[6:])
                                delta = chunk["choices"][0].get("text", "")
                                if delta:
                                    full_reply += delta
                                    await ws.send_json({"type": "llm_delta", "text": delta})
                    except Exception as e:
                        await ws.send_json({"type": "error", "text": str(e)})
                        continue

                    await ws.send_json({"type": "llm_done"})

                    if full_reply:
                        conversation_history.append({"role": "assistant", "content": full_reply.strip()})
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
                    # Decode webm → WAV using ffmpeg (run in executor to avoid blocking)
                    try:
                        import subprocess
                        loop = asyncio.get_event_loop()
                        def _decode_webm(data):
                            return subprocess.run(
                                ["ffmpeg", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
                                input=data, capture_output=True, timeout=5
                            )
                        proc = await loop.run_in_executor(None, _decode_webm, audio_bytes)
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
