"""
Voice Chat Server — All-in-One GPU Backend
STT (Parakeet TDT) + LLM (vLLM) + TTS (Kokoro ONNX GPU) + RAG (ChromaDB) on single GPU.
Streaming WebSocket pipeline with barge-in support and document Q&A.
"""

import asyncio
import json
import io
import os
import re
import uuid
import wave
import time
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

import config

# Dedicated single-thread executor for STT — keeps CUDA context warm
_stt_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt")

# ── Load Models ─────────────────────────────────────────────

print("🔧 Loading models...")

print("  [1/4] TTS engine...")
from tts.kokoro_tts import KokoroTTS
tts = KokoroTTS()
print("  ✓ TTS ready")

print("  [2/4] STT...")
from stt.parakeet_stt import ParakeetSTT
stt = ParakeetSTT()
print("  ✓ STT ready")

print("  [3/4] LLM client...")
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

print("  [4/4] RAG pipeline...")
from rag.pipeline import RAGPipeline
rag = RAGPipeline()
print("  ✓ RAG ready")

# Dedicated executor for RAG embedding (avoid blocking event loop)
_rag_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rag")


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~3.5 chars per token for English."""
    return max(1, len(text) // 4)


def _build_chatml_prompt(messages: list, prefill: str = "", max_ctx: int = 6000) -> str:
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

app = FastAPI(title="Voice Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── RAG Document Upload API ────────────────────────────────

@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Query(...),
):
    """Upload a PDF/DOCX document for RAG-powered Q&A."""
    filename = file.filename or "document"
    lower = filename.lower()
    if not lower.endswith((".pdf", ".docx", ".doc")):
        return JSONResponse(status_code=400, content={"error": "Unsupported file type. Use PDF, DOCX, or DOC."})

    file_bytes = await file.read()
    if len(file_bytes) > config.MAX_UPLOAD_SIZE:
        return JSONResponse(status_code=413, content={"error": f"File too large. Max: {config.MAX_UPLOAD_SIZE // 1024 // 1024} MB"})

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_rag_executor, rag.ingest, session_id, file_bytes, filename)
        return JSONResponse(content=result)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        print(f"❌ Upload error: {e}")
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Processing failed: {str(e)}"})


@app.get("/api/documents")
async def list_documents(session_id: str = Query(...)):
    """List uploaded documents for a session."""
    docs = rag.list_documents(session_id)
    return JSONResponse(content={"documents": docs})


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, session_id: str = Query(...)):
    """Delete a document from the session's vector store."""
    deleted = rag.delete_document(session_id, doc_id)
    return JSONResponse(content={"deleted": deleted, "doc_id": doc_id})


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


# Strip non-English characters (Qwen3 sometimes leaks Chinese/other scripts)
_NON_ENGLISH = re.compile(r'[^\x00-\x7F\u2018\u2019\u201C\u201D\u2013\u2014\u2026°±²³]+')

def _clean_delta(text: str) -> str:
    """Remove non-ASCII characters except common punctuation."""
    return _NON_ENGLISH.sub('', text)


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

    # Extract session_id from query params for per-chat RAG scoping
    session_id = ws.query_params.get("session_id", str(uuid.uuid4())[:12])
    print(f"🔌 Client connected (session={session_id})")

    conversation_history = [
        {"role": "system", "content": config.SYSTEM_PROMPT}
    ]
    pipeline_task = None
    # Debounce: wait briefly after receiving audio to catch rapid-fire VAD splits
    _audio_debounce_task = None
    _audio_generation = 0  # monotonic counter to identify latest audio

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

    async def run_voice_pipeline(transcript: str, detected_lang: str = "en"):
        """Stream LLM → TTS concurrently with aggressive first-chunk splitting."""
        full_reply = ""
        chunk_buffer = ""
        chunks_sent = 0
        t0 = time.perf_counter()

        # Determine TTS voice and language instruction for LLM
        if detected_lang in config.TTS_SUPPORTED_LANGS:
            tts_voice = config.LANG_VOICE_MAP[detected_lang]
            lang_instruction = ""
        else:
            tts_voice = config.TTS_VOICE
            lang_instruction = " Respond in English only — the student's language is not supported for voice output."

        voice_messages = [
            {"role": "system", "content": config.VOICE_SYSTEM_PROMPT + lang_instruction},
            *conversation_history[1:],
        ]

        # Inject RAG context if documents are uploaded
        loop = asyncio.get_event_loop()
        rag_context = await loop.run_in_executor(_rag_executor, rag.retrieve_context, session_id, transcript)
        if rag_context:
            voice_messages[0]["content"] += rag_context

        prompt = _build_chatml_prompt(voice_messages, prefill="<think>\n\n</think>\n\n", max_ctx=6000)

        # Async queue: LLM feeds sentences → TTS worker consumes them
        tts_q: asyncio.Queue = asyncio.Queue()

        async def tts_worker():
            """Generate and send TTS audio for each chunk as it arrives."""
            first_audio = True
            chunk_count = 0
            loop = asyncio.get_event_loop()
            while True:
                text = await tts_q.get()
                if text is None:
                    break
                clean = strip_md_for_tts(text)
                if not clean or len(clean.strip()) < 2:
                    continue
                try:
                    t1 = time.perf_counter()
                    pcm = await loop.run_in_executor(None, tts.to_pcm_bytes, clean, tts_voice)
                    tts_ms = (time.perf_counter() - t1) * 1000
                    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
                    peak = np.max(np.abs(samples))
                    if peak > 0:
                        samples = samples * (0.95 * 32767 / peak)
                    norm_pcm = np.clip(samples, -32767, 32767).astype(np.int16).tobytes()

                    wav = _pcm_to_wav(norm_pcm, sr=tts.sr)

                    if first_audio:
                        await ws.send_json({"type": "tts_start"})
                        print(f"🔊 First audio [{time.perf_counter()-t0:.3f}s] tts={tts_ms:.0f}ms \"{clean[:40]}\"")
                        first_audio = False
                    await ws.send_bytes(wav)
                    chunk_count += 1
                except Exception as e:
                    print(f"❌ TTS chunk error: {e}")
            print(f"🔊 TTS done [{time.perf_counter()-t0:.3f}s] ({chunk_count} chunks)")

        try:
            await ws.send_json({"type": "llm_start"})
            tts_task = asyncio.create_task(tts_worker())

            # Stream LLM tokens — aggressive first-chunk for fast TTS start
            async with _llm_http.stream(
                "POST", "/v1/completions",
                json={
                    "prompt": prompt,
                    "max_tokens": 2048,
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
                    if not delta:
                        continue
                    # Track LLM first token time
                    if not full_reply:
                        print(f"⚡ LLM first token [{time.perf_counter()-t0:.3f}s]")
                    full_reply += delta
                    chunk_buffer += delta
                    await ws.send_json({"type": "llm_delta", "text": delta})

                    # Chunk extraction — split at sentence boundaries for fluent TTS
                    while True:
                        if chunks_sent == 0:
                            # FIRST CHUNK: wait for first sentence/clause end
                            match = re.search(r'[.!?](?:\s|$)', chunk_buffer)
                            if not match:
                                match = re.search(r'[,;:](?:\s|$)', chunk_buffer)
                            if match:
                                end = match.end()
                                frag = chunk_buffer[:end].strip()
                                chunk_buffer = chunk_buffer[end:]
                                if frag:
                                    await tts_q.put(frag)
                                    chunks_sent += 1
                                    print(f'\U0001f4dd Chunk1 [{time.perf_counter()-t0:.3f}s] "{frag[:50]}"')
                            break
                        else:
                            # ALL SUBSEQUENT: full sentence boundaries
                            match = re.search(r'[.!?](?:\s|$)', chunk_buffer)
                            if not match:
                                if len(chunk_buffer.split()) >= 15:
                                    cm = re.search(r'[,;:](?:\s|$)', chunk_buffer)
                                    if cm:
                                        match = cm
                                if not match:
                                    break
                            end = match.end()
                            sentence = chunk_buffer[:end].strip()
                            chunk_buffer = chunk_buffer[end:]
                            if sentence:
                                await tts_q.put(sentence)
                                chunks_sent += 1

            # Flush remaining text to TTS
            if chunk_buffer.strip():
                await tts_q.put(chunk_buffer.strip())

            await tts_q.put(None)  # Signal TTS worker to finish
            await ws.send_json({"type": "llm_done"})
            await tts_task  # Wait for all TTS audio to send
            await ws.send_json({"type": "tts_done"})

            if full_reply:
                conversation_history.append({"role": "assistant", "content": full_reply.strip()})
                if len(conversation_history) > 21:
                    del conversation_history[1:-20]

            print(f"✅ [{time.perf_counter()-t0:.2f}s] Voice reply: {full_reply[:60]}...")

        except asyncio.CancelledError:
            print(f"⚡ Voice pipeline cancelled: {full_reply[:40]}...")
            tts_q.put_nowait(None)  # Stop TTS worker
            if full_reply:
                clean = re.sub(r'<think>.*?</think>\s*', '', full_reply, flags=re.DOTALL).strip()
                if clean:
                    conversation_history.append({"role": "assistant", "content": clean})
                    if len(conversation_history) > 21:
                        del conversation_history[1:-20]
            raise
        except Exception as e:
            print(f"❌ Pipeline error: {e}")
            tts_q.put_nowait(None)
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
                    if not config.is_topic_related(user_text):
                        await ws.send_json({"type": "llm_start"})
                        await ws.send_json({"type": "llm_delta", "text": config.REJECT_MSG})
                        await ws.send_json({"type": "llm_done"})
                        continue

                    conversation_history.append({"role": "user", "content": user_text})
                    await ws.send_json({"type": "llm_start"})

                    # Inject RAG context if documents are uploaded
                    text_messages = list(conversation_history)
                    loop = asyncio.get_event_loop()
                    rag_context = await loop.run_in_executor(_rag_executor, rag.retrieve_context, session_id, user_text)
                    if rag_context:
                        text_messages[0] = {"role": "system", "content": text_messages[0]["content"] + rag_context}

                    # Use raw completions with think pre-fill for instant answers
                    prompt = _build_chatml_prompt(text_messages, prefill="<think>\n\n</think>\n\n")
                    full_reply = ""
                    t0 = time.perf_counter()
                    try:
                        async with _llm_http.stream(
                            "POST", "/v1/completions",
                            json={
                                "prompt": prompt,
                                "max_tokens": 2048,
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
                _audio_generation += 1
                my_gen = _audio_generation

                # Cancel any pending debounced audio processing
                if _audio_debounce_task and not _audio_debounce_task.done():
                    _audio_debounce_task.cancel()
                    try:
                        await _audio_debounce_task
                    except (asyncio.CancelledError, Exception):
                        pass

                raw_bytes = message["bytes"]

                async def _debounced_audio(audio_bytes, gen):
                    nonlocal _audio_generation, pipeline_task
                    # Brief wait to catch rapid-fire VAD segments
                    await asyncio.sleep(0.30)
                    # If a newer audio chunk arrived during the wait, abandon this one
                    if gen != _audio_generation:
                        return

                    t0 = time.perf_counter()
                    loop = asyncio.get_event_loop()

                    # Detect format: webm starts with 0x1A45DFA3 (EBML header)
                    is_webm = len(audio_bytes) > 4 and audio_bytes[:4] == b'\x1a\x45\xdf\xa3'

                    if is_webm:
                        try:
                            import subprocess
                            def _decode_webm(data):
                                return subprocess.run(
                                    ["ffmpeg", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
                                    input=data, capture_output=True, timeout=5
                                )
                            proc = await loop.run_in_executor(None, _decode_webm, audio_bytes)
                            if proc.returncode != 0:
                                print(f"❌ ffmpeg error: {proc.stderr.decode()[:100]}")
                                return
                            wav_bytes = proc.stdout
                        except FileNotFoundError:
                            print("⚠️ ffmpeg not found, trying raw float32 decode")
                            audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                            if len(audio_f32) < 1600:
                                return
                            wav_bytes = float32_to_wav(audio_f32, sr=16000)
                        except Exception as e:
                            print(f"❌ Audio decode error: {e}")
                            return

                        stt_future = loop.run_in_executor(_stt_executor, stt.transcribe, wav_bytes)
                        await cancel_pipeline()
                        try:
                            transcript, detected_lang = await stt_future
                        except Exception as e:
                            print(f"❌ STT error: {e}")
                            await ws.send_json({"type": "error", "text": f"STT error: {e}"})
                            return
                    else:
                        # Raw Float32 PCM — pass numpy directly
                        audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                        if len(audio_f32) < 1600:
                            return

                        stt_future = loop.run_in_executor(_stt_executor, stt.transcribe_raw, audio_f32)
                        await cancel_pipeline()
                        try:
                            transcript, detected_lang = await stt_future
                        except Exception as e:
                            print(f"❌ STT error: {e}")
                            await ws.send_json({"type": "error", "text": f"STT error: {e}"})
                            return

                    # Check again — newer audio may have arrived during STT
                    if gen != _audio_generation:
                        return

                    if not transcript or len(transcript.strip()) < 2:
                        await ws.send_json({"type": "vad_no_speech"})
                        return

                    print(f"🎤 [{time.perf_counter()-t0:.2f}s] User ({detected_lang}): {transcript}")

                    # Topic filter
                    if not config.is_topic_related(transcript):
                        await ws.send_json({"type": "user_transcript", "text": transcript})
                        await ws.send_json({"type": "llm_start"})
                        await ws.send_json({"type": "llm_delta", "text": config.REJECT_MSG})
                        await ws.send_json({"type": "llm_done"})
                        await _send_tts(ws, config.REJECT_MSG)
                        await ws.send_json({"type": "tts_done"})
                        return

                    await ws.send_json({"type": "user_transcript", "text": transcript})
                    conversation_history.append({"role": "user", "content": transcript})

                    pipeline_task = asyncio.create_task(run_voice_pipeline(transcript, detected_lang))

                _audio_debounce_task = asyncio.create_task(_debounced_audio(raw_bytes, my_gen))

    except (WebSocketDisconnect, RuntimeError):
        ping_task.cancel()
        if _audio_debounce_task and not _audio_debounce_task.done():
            _audio_debounce_task.cancel()
        await cancel_pipeline(notify=False)
        print("🔌 Client disconnected")
    except Exception as e:
        ping_task.cancel()
        if _audio_debounce_task and not _audio_debounce_task.done():
            _audio_debounce_task.cancel()
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


async def _send_tts(ws: WebSocket, text: str, voice: str = None):
    """Stream TTS sentence-by-sentence for low latency.
    First sentence audio arrives in ~0.3s while rest generates in background."""
    clean = strip_md_for_tts(text)
    if not clean:
        return
    try:
        t0 = time.perf_counter()
        loop = asyncio.get_event_loop()
        first_audio = True

        q: asyncio.Queue = asyncio.Queue()

        def _generate():
            for pcm in tts.stream_sentences(clean, voice=voice):
                # Peak-normalize each sentence to 95%
                samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
                peak = np.max(np.abs(samples))
                if peak > 0:
                    samples = samples * (0.95 * 32767 / peak)
                norm = np.clip(samples, -32767, 32767).astype(np.int16).tobytes()
                q.put_nowait(norm)
            q.put_nowait(None)

        loop.run_in_executor(None, _generate)

        chunk_count = 0
        while True:
            pcm = await q.get()
            if pcm is None:
                break

            wav = _pcm_to_wav(pcm, sr=tts.sr)
            if first_audio:
                await ws.send_json({"type": "tts_start"})
                print(f"🔊 TTS first audio [{time.perf_counter()-t0:.3f}s]")
                first_audio = False

            await ws.send_bytes(wav)
            chunk_count += 1

        print(f"🔊 TTS done [{time.perf_counter()-t0:.3f}s] {len(clean)} chars ({chunk_count} chunks)")

    except Exception as e:
        print(f"❌ TTS error: {e}")
        import traceback; traceback.print_exc()
        try:
            t0 = time.perf_counter()
            wav_bytes = await loop.run_in_executor(None, tts.to_wav_bytes, clean)
            wav_bytes = _normalize_wav(wav_bytes, target_peak=0.95)
            await ws.send_json({"type": "tts_start"})
            await ws.send_bytes(wav_bytes)
            print(f"🔊 TTS [{time.perf_counter()-t0:.3f}s] {len(clean)} chars (fallback)")
        except Exception as e2:
            print(f"❌ TTS fallback error: {e2}")


# ── Health check ────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "model": config.VLLM_MODEL}


# ── Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"\n🚀 Starting server on port {config.SERVER_PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=config.SERVER_PORT, log_level="info")
