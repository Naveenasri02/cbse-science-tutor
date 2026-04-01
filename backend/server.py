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


def _build_chatml_prompt(messages: list, prefill: str = "", max_ctx: int = 1400) -> str:
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

    # Keep-alive: ping every 20s to prevent proxy timeouts
    async def keep_alive():
        try:
            while True:
                await asyncio.sleep(20)
                await ws.send_json({"type": "ping"})
        except Exception:
            pass

    ping_task = asyncio.create_task(keep_alive())

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
        """Stream LLM → TTS sequentially. TTS chunks sent in order for gapless playback."""
        full_reply = ""
        tts_buffer = ""
        first_tts_sent = False
        t0 = time.perf_counter()
        tts_queue = asyncio.Queue()
        tts_worker_task = None

        async def tts_worker():
            """Process TTS chunks sequentially to guarantee ordering."""
            while True:
                text = await tts_queue.get()
                if text is None:
                    break
                await _send_tts(ws, text)

        voice_messages = [
            {"role": "system", "content": config.VOICE_SYSTEM_PROMPT},
            *conversation_history[1:],
        ]
        prompt = _build_chatml_prompt(voice_messages, prefill="<think>\n\n</think>\n\n", max_ctx=1700)

        try:
            await ws.send_json({"type": "llm_start"})
            tts_worker_task = asyncio.create_task(tts_worker())

            async with _llm_http.stream(
                "POST", "/v1/completions",
                json={
                    "prompt": prompt,
                    "max_tokens": 150,
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

                    full_reply += delta
                    await ws.send_json({"type": "llm_delta", "text": delta})

                    tts_buffer += delta
                    send_text = ""

                    if not first_tts_sent:
                        # First chunk: fire at ANY punctuation (,;:.!?) for fast first audio
                        for sc in ".!?,;:":
                            idx = tts_buffer.rfind(sc)
                            if idx >= 0:
                                candidate = tts_buffer[:idx + 1].strip()
                                if len(candidate) >= 15:
                                    send_text = candidate
                                    tts_buffer = tts_buffer[idx + 1:]
                                    first_tts_sent = True
                                    break
                    else:
                        # Subsequent chunks: sentence boundaries for consistent pace
                        for sc in ".!?":
                            idx = tts_buffer.rfind(sc)
                            if idx >= 0:
                                candidate = tts_buffer[:idx + 1].strip()
                                if len(candidate) >= 5:
                                    send_text = candidate
                                    tts_buffer = tts_buffer[idx + 1:]
                                    break

                    if send_text:
                        await tts_queue.put(send_text)

            # Send remaining buffer
            if tts_buffer.strip():
                await tts_queue.put(tts_buffer.strip())

            await ws.send_json({"type": "llm_done"})

            # Signal worker to stop and wait
            await tts_queue.put(None)
            if tts_worker_task:
                await tts_worker_task

            await ws.send_json({"type": "tts_done"})

            if full_reply:
                conversation_history.append({"role": "assistant", "content": full_reply.strip()})
                if len(conversation_history) > 21:
                    del conversation_history[1:-20]

            print(f"✅ [{time.perf_counter()-t0:.2f}s] Voice reply: {full_reply[:60]}...")

        except asyncio.CancelledError:
            print(f"⚡ Voice pipeline cancelled: {full_reply[:40]}...")
            if tts_worker_task:
                tts_worker_task.cancel()
            if full_reply:
                clean = re.sub(r'<think>.*?</think>\s*', '', full_reply, flags=re.DOTALL).strip()
                if clean:
                    conversation_history.append({"role": "assistant", "content": clean})
                    if len(conversation_history) > 21:
                        del conversation_history[1:-20]
            raise
        except Exception as e:
            print(f"❌ Pipeline error: {e}")
            if tts_worker_task:
                tts_worker_task.cancel()
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
                    print(f"💬 Text chat: {user_text[:60]}")

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
                    t0 = time.perf_counter()
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
                        print(f"❌ Text LLM error: {e}")
                        await ws.send_json({"type": "error", "text": str(e)})
                        continue

                    await ws.send_json({"type": "llm_done"})
                    print(f"✅ [{time.perf_counter()-t0:.2f}s] Text reply: {full_reply[:60]}...")

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
        ping_task.cancel()
        await cancel_pipeline(notify=False)
        print("🔌 Client disconnected")
    except Exception as e:
        ping_task.cancel()
        print(f"❌ WS error: {e}")
        import traceback; traceback.print_exc()


def _pcm_to_wav(pcm_bytes: bytes, sr: int = 24000) -> bytes:
    """Wrap raw PCM int16 mono data in a WAV header."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


def _normalize_wav(wav_bytes: bytes, target_peak: float = 0.85) -> bytes:
    """Fast peak normalization for consistent volume."""
    with io.BytesIO(wav_bytes) as inp:
        with wave.open(inp, 'rb') as w:
            params = w.getparams()
            frames = w.readframes(w.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
    if len(samples) == 0:
        return wav_bytes
    peak = np.max(np.abs(samples))
    if peak < 1.0:
        return wav_bytes
    gain = (target_peak * 32767) / peak
    samples = np.clip(samples * gain, -32767, 32767).astype(np.int16)
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setparams(params)
        w.writeframes(samples.tobytes())
    return out.getvalue()


async def _send_tts(ws: WebSocket, text: str):
    """Stream TTS audio for low time-to-first-audio.
    Streams PCM from Voxtral, converts to mini-WAV chunks, sends progressively.
    Falls back to full WAV if streaming fails."""
    clean = strip_md_for_tts(text)
    if not clean:
        return
    try:
        t0 = time.perf_counter()
        loop = asyncio.get_event_loop()
        pcm_queue = asyncio.Queue()
        stream_error = [None]

        def _produce():
            try:
                for chunk in tts.stream_pcm(clean):
                    loop.call_soon_threadsafe(pcm_queue.put_nowait, chunk)
            except Exception as e:
                stream_error[0] = e
            loop.call_soon_threadsafe(pcm_queue.put_nowait, None)

        producer = loop.run_in_executor(None, _produce)

        sr = 24000
        min_bytes = int(sr * 0.35 * 2)  # ~0.35s per mini-WAV chunk
        pcm_buf = bytearray()
        sent_any = False

        while True:
            chunk = await pcm_queue.get()
            if chunk is None:
                break
            pcm_buf.extend(chunk)

            if len(pcm_buf) >= min_bytes:
                wav = _pcm_to_wav(bytes(pcm_buf), sr)
                wav = _normalize_wav(wav)
                if not sent_any:
                    await ws.send_json({"type": "tts_start"})
                    sent_any = True
                    print(f"🔊 TTS first audio [{time.perf_counter()-t0:.3f}s]")
                await ws.send_bytes(wav)
                pcm_buf = bytearray()

        # Flush remaining PCM
        if pcm_buf:
            wav = _pcm_to_wav(bytes(pcm_buf), sr)
            wav = _normalize_wav(wav)
            if not sent_any:
                await ws.send_json({"type": "tts_start"})
            await ws.send_bytes(wav)

        await producer

        if stream_error[0]:
            raise stream_error[0]

        print(f"🔊 TTS done [{time.perf_counter()-t0:.3f}s] {len(clean)} chars (streamed)")

    except Exception as stream_err:
        # Fallback to non-streaming
        print(f"⚠️ TTS stream failed ({stream_err}), using fallback")
        try:
            t0 = time.perf_counter()
            loop = asyncio.get_event_loop()
            wav_bytes = await loop.run_in_executor(None, tts.to_wav_bytes, clean)
            wav_bytes = _normalize_wav(wav_bytes)
            await ws.send_json({"type": "tts_start"})
            await ws.send_bytes(wav_bytes)
            print(f"🔊 TTS [{time.perf_counter()-t0:.3f}s] {len(clean)} chars (fallback)")
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
