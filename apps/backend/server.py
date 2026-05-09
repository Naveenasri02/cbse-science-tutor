"""
Voice Chat Server — Hybrid CPU/GPU Backend
LLM (vLLM, separate process) owns the GPU. This FastAPI process is CPU-only:
STT (Parakeet on CPU), TTS (Kokoro CPU), embedder (BGE on CPU), easyocr (CPU).
"""

import os
# Pod bootstrap exports EMBEDDING_DEVICE=cpu which makes document upload slow
# (BGE-large embedding ~10-50x slower on CPU). With voice off, vLLM has
# headroom on the GPU for the embedder + reranker (~2 GB combined). Override
# the bootstrap export here unless user explicitly opts into CPU via FORCE_CPU=1.
if os.getenv("FORCE_CPU", "0") != "1":
    os.environ["EMBEDDING_DEVICE"] = "cuda"
    os.environ["RERANKER_DEVICE"] = "cuda"

import asyncio
import json
import io
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

# Voice (STT/TTS) is OFF by default. Pod bootstrap exports VOICE_ENABLED=false,
# which we honor to keep boot fast and avoid CPU-NeMo/CPU-Kokoro overhead. To
# enable voice, set VOICE_ENABLED=true in the pod env AND ensure stt/, tts/
# dirs + voice deps + Kokoro model files are present.
VOICE_ENABLED = os.getenv("VOICE_ENABLED", "false").lower() in ("1", "true", "yes")
stt = None
tts = None
if VOICE_ENABLED:
    try:
        print("  [1/4] STT (torch/NeMo must load before ONNX to avoid CUDA conflict)...")
        from stt.parakeet_stt import ParakeetSTT
        stt = ParakeetSTT()
        print("  ✓ STT ready")
    except Exception as e:
        print(f"  ⚠️ STT load failed; voice input disabled: {type(e).__name__}: {str(e)[:120]}")
    try:
        print("  [2/4] TTS engine...")
        from tts.kokoro_tts import KokoroTTS
        tts = KokoroTTS()
        print("  ✓ TTS ready")
    except Exception as e:
        print(f"  ⚠️ TTS load failed; voice output disabled: {type(e).__name__}: {str(e)[:120]}")
else:
    print("  [1/4] STT skipped (VOICE_ENABLED=false)")
    print("  [2/4] TTS skipped (VOICE_ENABLED=false)")

print("  [3/4] LLM client...")
from openai import AsyncOpenAI
llm_client = AsyncOpenAI(
    api_key=config.VLLM_API_KEY,
    base_url=config.VLLM_BASE_URL,
)
import httpx
_llm_http = httpx.AsyncClient(
    base_url=config.VLLM_BASE_URL.rstrip("/v1"),
    timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
    headers={"Authorization": f"Bearer {config.VLLM_API_KEY}"},
)
print("  ✓ LLM ready")

print("  [4/4] RAG pipeline...")
from rag.pipeline import RAGPipeline, verify_citations
rag = RAGPipeline()
print("  ✓ RAG ready")

# Dedicated executor for RAG embedding (avoid blocking event loop)
_rag_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rag")

# Track sessions where only irrelevant documents have been uploaded
# key=session_id, value={"total": int, "irrelevant": int}
_session_doc_relevance: dict[str, dict] = {}


def _estimate_tokens(text: str) -> int:
    """Token estimate: ~2.8 chars per token (conservative for technical text)."""
    return max(1, int(len(text) / 2.8))


def _strip_think_blocks(text: str) -> str:
    """Strip <think>...</think> reasoning traces from LLM output.
    Qwen3 best practice: NEVER store think traces in conversation history —
    they cause context pollution, bloat, and off-topic drift."""
    return re.sub(r'<think>.*?</think>\s*', '', text, flags=re.DOTALL).strip()


# ── Conversation Summarization (Qwen3 hybrid sliding window) ────────────
# When history grows beyond SUMMARIZE_THRESHOLD messages, the oldest messages
# (beyond the recent SLIDING_WINDOW_SIZE) are condensed into a single summary.
# This gives the LLM long-term memory without consuming the full context window.
SLIDING_WINDOW_SIZE = 30      # Keep this many recent messages verbatim
SUMMARIZE_THRESHOLD = 40      # Trigger summarization when history exceeds this
SUMMARY_ROLE = "system"       # Inject summary as a system message

_SUMMARIZE_PROMPT = """Summarize the following conversation between a user and an AI assistant.
Capture the KEY information: what documents were discussed, what questions were asked,
what answers were given, and any important facts or decisions.
Be concise but preserve all factual content. Use 150 words or fewer.

Conversation to summarize:
{conversation}"""


async def _summarize_old_messages(old_messages: list) -> str:
    """Use the LLM to summarize old conversation messages into a condensed memory."""
    conv_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content'][:300]}"
        for m in old_messages
    )
    try:
        resp = await _llm_http.post("/v1/chat/completions", json={
            "model": config.VLLM_MODEL,
            "messages": [
                {"role": "system", "content": "You are a conversation summarizer. Be concise and factual."},
                {"role": "user", "content": _SUMMARIZE_PROMPT.format(conversation=conv_text)},
            ],
            "max_tokens": 256,
            "temperature": 0.1,
        })
        if resp.status_code == 200:
            data = resp.json()
            summary = data["choices"][0]["message"].get("content", "").strip()
            summary = _strip_think_blocks(summary)
            print(f"📝 Summarized {len(old_messages)} old messages → {len(summary)} chars")
            return summary
    except Exception as e:
        print(f"⚠️ Summarization failed: {e}")
    # Fallback: simple extractive summary
    return " | ".join(m["content"][:80] for m in old_messages[:10]) + " ..."


async def _maybe_summarize_history(conversation_history: list) -> None:
    """If conversation exceeds threshold, summarize old messages and compact.
    Keeps: [system_prompt, ?existing_summary, ...recent SLIDING_WINDOW_SIZE messages]"""
    if len(conversation_history) <= SUMMARIZE_THRESHOLD:
        return

    # Find where the summary slot is (index 1 if exists, otherwise we create it)
    has_summary = (
        len(conversation_history) > 1
        and conversation_history[1].get("role") == SUMMARY_ROLE
        and conversation_history[1].get("content", "").startswith("[Conversation Memory]")
    )

    start_idx = 2 if has_summary else 1
    recent_start = len(conversation_history) - SLIDING_WINDOW_SIZE
    if recent_start <= start_idx:
        return  # Not enough old messages to summarize

    old_messages = conversation_history[start_idx:recent_start]
    old_summary = conversation_history[1]["content"] if has_summary else ""

    # Build context for summarization (include previous summary if any)
    messages_to_summarize = old_messages
    if old_summary:
        messages_to_summarize = [{"role": "system", "content": old_summary}] + old_messages

    new_summary = await _summarize_old_messages(messages_to_summarize)
    summary_msg = {
        "role": SUMMARY_ROLE,
        "content": f"[Conversation Memory] {new_summary}"
    }

    # Compact: [system, summary, ...recent messages]
    recent_messages = conversation_history[recent_start:]
    conversation_history.clear()
    conversation_history.append({"role": "system", "content": ""})  # placeholder, gets overwritten
    conversation_history.append(summary_msg)
    conversation_history.extend(recent_messages)
    # Restore system prompt from first element saved before clear
    # (it gets overwritten each turn anyway in the main loop)

    print(f"🗜️ History compacted: {start_idx + len(old_messages) + len(recent_messages)} → {len(conversation_history)} messages")


def _trim_messages_to_budget(messages: list, max_ctx: int = 30000) -> list:
    """Trim older messages (keeping system prompt + optional summary) to stay within max_ctx tokens.
    Architecture: [system_prompt] + [?conversation_summary] + [recent_messages]
    Returned list is suitable for passing to vLLM /v1/chat/completions; vLLM will apply
    the model's chat template automatically."""
    if not messages:
        return []
    overhead = 50
    system_cost = _estimate_tokens(messages[0]["content"]) + 10
    budget = max_ctx - overhead - system_cost

    summary_cost = 0
    has_summary = (
        len(messages) > 1
        and messages[1].get("role") == SUMMARY_ROLE
        and messages[1].get("content", "").startswith("[Conversation Memory]")
    )
    if has_summary:
        summary_cost = _estimate_tokens(messages[1]["content"]) + 10
        budget -= summary_cost

    skip = 2 if has_summary else 1
    kept = []
    for m in reversed(messages[skip:]):
        cost = _estimate_tokens(m["content"]) + 10
        if budget - cost < 0:
            break
        budget -= cost
        kept.append(m)
    kept.reverse()

    final = [messages[0]]
    if has_summary:
        final.append(messages[1])
    final.extend(kept)
    return final

# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(title="Voice Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Warmup vLLM on first startup (prevents cold-start truncation) ──
@app.on_event("startup")
async def warmup_llm():
    """Send a short warmup request to vLLM so first real query isn't slow."""
    try:
        resp = await _llm_http.post("/v1/chat/completions", json={
            "model": config.VLLM_MODEL,
            "messages": [{"role": "user", "content": "Hi"}],
            "max_tokens": 8,
            "temperature": 0,
        })
        if resp.status_code == 200:
            print("  ✓ LLM warmup done")
        else:
            print(f"  ⚠️ LLM warmup returned {resp.status_code} (vLLM may still be loading)")
    except Exception as e:
        print(f"  ⚠️ LLM warmup skipped ({e}) — will warm on first request")

# ── RAG Document Upload API ────────────────────────────────

@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Query(...),
    assistant: str = Query(default="general"),
    workflow: str = Query(default=""),
):
    """Upload a document for RAG-powered Q&A."""
    from rag.chunker import SUPPORTED_EXTENSIONS
    filename = file.filename or "document"
    lower = filename.lower()
    ext = lower[lower.rfind("."):] if "." in lower else ""
    if ext not in SUPPORTED_EXTENSIONS:
        return JSONResponse(status_code=400, content={"error": f"Unsupported file type. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"})

    file_bytes = await file.read()
    if len(file_bytes) > config.MAX_UPLOAD_SIZE:
        return JSONResponse(status_code=413, content={"error": f"File too large. Max: {config.MAX_UPLOAD_SIZE // 1024 // 1024} MB"})

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_rag_executor, rag.ingest, session_id, file_bytes, filename)

        # Auto-generate summary + suggested questions after ingestion
        try:
            summary_data = await _generate_doc_summary(session_id, filename)
            result["summary"] = summary_data.get("summary", "")
            result["suggested_questions"] = summary_data.get("suggested_questions", [])
            result["doc_type"] = summary_data.get("doc_type", "")
            result["themes"] = summary_data.get("themes", [])
            result["entities"] = summary_data.get("entities", [])
            result["key_findings"] = summary_data.get("key_findings", [])
            result["terms"] = summary_data.get("terms", [])
            result["toc"] = summary_data.get("toc", [])
        except Exception as e:
            print(f"⚠️ Auto-summary generation failed (upload still successful): {e}")
            result["summary"] = ""
            result["suggested_questions"] = []
            result["doc_type"] = ""
            result["themes"] = []
            result["entities"] = []
            result["key_findings"] = []
            result["terms"] = []
            result["toc"] = []

        # Document-assistant relevance check
        try:
            relevance = config.check_document_relevance(
                doc_type=result.get("doc_type", ""),
                themes=result.get("themes", []),
                summary=result.get("summary", ""),
                assistant_key=assistant,
                workflow=workflow,
            )
            if not relevance["relevant"]:
                result["relevance_warning"] = relevance["warning"]
                # Clear summary data for irrelevant docs — only show the warning
                result["summary"] = ""
                result["suggested_questions"] = []
                result["key_findings"] = []
                result["terms"] = []
                result["toc"] = []
                # Track irrelevant doc for this session
                tracker = _session_doc_relevance.setdefault(session_id, {"total": 0, "irrelevant": 0})
                tracker["total"] += 1
                tracker["irrelevant"] += 1
                print(f"⚠️ Document relevance warning for '{filename}': {relevance['warning'][:100]}")
            else:
                tracker = _session_doc_relevance.setdefault(session_id, {"total": 0, "irrelevant": 0})
                tracker["total"] += 1
        except Exception as e:
            print(f"⚠️ Document relevance check failed: {e}")

        return JSONResponse(content=result)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        print(f"❌ Upload error: {e}")
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Processing failed: {str(e)}"})


async def _generate_doc_summary(session_id: str, filename: str) -> dict:
    """Generate a rich NotebookLM-style document overview with structured sections."""
    loop = asyncio.get_event_loop()
    all_chunks = await loop.run_in_executor(_rag_executor, rag.store.get_all_chunks_ordered, session_id)
    if not all_chunks:
        return {"summary": "", "suggested_questions": []}

    # Use up to ~16000 chars from the document for thorough coverage
    total_chars = sum(len(c["text"]) for c in all_chunks)
    if total_chars <= 16000:
        doc_content = "\n\n".join(c["text"] for c in all_chunks)
    else:
        # First 10000 chars + last 6000 chars for comprehensive coverage
        front_parts = []
        chars = 0
        for c in all_chunks:
            front_parts.append(c["text"])
            chars += len(c["text"])
            if chars > 10000:
                break
        back_parts = []
        chars = 0
        for c in reversed(all_chunks):
            back_parts.insert(0, c["text"])
            chars += len(c["text"])
            if chars > 6000:
                break
        doc_content = "\n\n".join(front_parts) + "\n\n[...]\n\n" + "\n\n".join(back_parts)

    # Extract section names with page numbers for structure overview
    sections_with_pages = []
    for c in all_chunks:
        sec = c.get("section", "")
        page = c.get("page", 0)
        if sec and not any(s[0] == sec for s in sections_with_pages):
            sections_with_pages.append((sec, page))
    section_list = "; ".join(f"{s} (p.{p})" if p else s for s, p in sections_with_pages[:20]) if sections_with_pages else "No clear section headings detected"

    prompt = (
        f"You are analyzing the document \"{filename}\".\n"
        f"Document sections: {section_list}\n"
        f"Total length: ~{total_chars} characters ({len(all_chunks)} chunks)\n\n"
        f"Document content:\n{doc_content[:16000]}\n\n"
        "Provide a comprehensive NotebookLM-style document overview in this EXACT format:\n\n"
        "DOCTYPE: <one of: Legal Document, Research Paper, Business Report, Policy Document, "
        "Technical Manual, Educational Material, Financial Document, HR Document, General Document>\n"
        "SUMMARY_START\n"
        "Write EXACTLY 2-3 short sentences (max 40 words total). Example format:\n"
        "\"A thesis on VR and AR-based CPR training by S Sai Naveena Sri at IIT Madras. "
        "Develops two platforms and validates SMART CPR as non-inferior to traditional methods via a 50-participant RCT.\"\n"
        "Do NOT exceed 40 words. Do NOT include long titles or full department names.\n"
        "SUMMARY_END\n"
        "THEMES: <comma-separated list of 4-8 key themes or topics covered>\n"
        "ENTITIES: <comma-separated list of key people, organizations, dates, or amounts mentioned>\n"
        "KEYFINDINGS: <numbered list of 3-5 most important findings, conclusions, or takeaways, "
        "each on its own line as F1: ..., F2: ..., etc.>\n"
        "TERMS: <3-5 important domain-specific terms with brief definitions, "
        "each on its own line as T1: term — definition, T2: term — definition, etc.>\n"
        "TOC: <document structure as numbered entries with page numbers, "
        "each on its own line as S1: section_name|page_number, S2: section_name|page_number, etc. "
        "Use the sections provided above or infer from content.>\n"
        "Q1: <specific question about the document's main purpose or findings>\n"
        "Q2: <specific question about a key detail, obligation, or requirement>\n"
        "Q3: <specific question about a specific section, clause, or topic>\n"
        "Q4: <specific question comparing or contrasting elements in the document>\n"
        "Q5: <specific question about implications, risks, or next steps>\n"
        "/no_think"
    )

    import re as _re
    async with httpx.AsyncClient(
        base_url=config.VLLM_BASE_URL,
        headers={"Authorization": f"Bearer {config.VLLM_API_KEY}"},
        timeout=60,
    ) as client:
        resp = await client.post("/chat/completions", json={
            "model": config.VLLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1500,
            "temperature": 0.3,
        })
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"].strip()
        text = _re.sub(r'<think>.*?</think>', '', text, flags=_re.DOTALL).strip()

    # Parse response — handle multi-paragraph SUMMARY_START/SUMMARY_END block
    summary = ""
    doc_type = ""
    themes = []
    entities = []
    questions = []
    key_findings = []
    terms = []
    toc = []

    # Extract multi-paragraph summary between markers
    summary_match = _re.search(r'SUMMARY_START\s*\n(.*?)\nSUMMARY_END', text, _re.DOTALL)
    if summary_match:
        summary = summary_match.group(1).strip()

    # Force summary to max 3 sentences regardless of LLM output
    if summary:
        sentences = _re.split(r'(?<=[.!?])\s+', summary)
        summary = ' '.join(sentences[:3])
    
    for line in text.split("\n"):
        line = line.strip()
        if line.upper().startswith("DOCTYPE:"):
            doc_type = line[8:].strip()
        elif line.upper().startswith("SUMMARY:") and not summary:
            # Fallback: single-line summary if markers not used
            raw = line[8:].strip()
            sentences = _re.split(r'(?<=[.!?])\s+', raw)
            summary = ' '.join(sentences[:3])
        elif line.upper().startswith("THEMES:"):
            themes = [t.strip() for t in line[7:].split(",") if t.strip()]
        elif line.upper().startswith("ENTITIES:"):
            entities = [e.strip() for e in line[9:].split(",") if e.strip()]
        elif line.upper().startswith("KEYFINDINGS:"):
            # Might be on same line or next lines
            rest = line[12:].strip()
            if rest:
                # Split in case multiple findings are on one line (F1: ... F2: ...)
                parts = _re.split(r'\s*F\d+:\s*', rest)
                for p in parts:
                    p = p.strip()
                    if p:
                        key_findings.append(p)
        elif _re.match(r'^F\d+:', line):
            # Single finding line — but may contain multiple (F1: ... F2: ...)
            parts = _re.split(r'\s*F\d+:\s*', line)
            for p in parts:
                p = p.strip()
                if p:
                    key_findings.append(p)
        elif _re.match(r'^T\d:', line):
            t = line[3:].strip()
            if t:
                terms.append(t)
        elif _re.match(r'^S\d:', line):
            s = line[3:].strip()
            if s:
                # Parse "section_name|page_number"
                parts = s.split("|")
                toc_entry = {"title": parts[0].strip()}
                if len(parts) > 1:
                    try:
                        toc_entry["page"] = int(parts[1].strip())
                    except ValueError:
                        pass
                toc.append(toc_entry)
        elif _re.match(r'^Q\d:', line):
            q = line[3:].strip()
            if q:
                questions.append(q)

    print(f"📋 Auto-summary generated for \"{filename}\": type={doc_type}, {len(summary)} chars, "
          f"{len(themes)} themes, {len(entities)} entities, {len(questions)} questions, "
          f"{len(key_findings)} findings, {len(terms)} terms, {len(toc)} toc entries")
    return {
        "summary": summary,
        "doc_type": doc_type,
        "themes": themes[:8],
        "entities": entities[:10],
        "suggested_questions": questions[:5],
        "key_findings": key_findings[:5],
        "terms": terms[:5],
        "toc": toc[:15],
    }


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


# ── Health check (must be above SPA catch-all) ──────────────
@app.get("/health")
async def health():
    return {"status": "ok", "model": config.VLLM_MODEL}

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

    # Extract session_id and assistant type from query params
    session_id = ws.query_params.get("session_id", str(uuid.uuid4())[:12])
    assistant_key = ws.query_params.get("assistant", "")
    active_workflow = ""  # Updated when client sends workflow in text_chat
    print(f"🔌 Client connected (session={session_id}, assistant={assistant_key})")

    conversation_history = [
        {"role": "system", "content": config.get_system_prompt(assistant_key)}
    ]
    pipeline_task = None
    _active_tts_task = None  # Track TTS task for explicit cancellation
    # Debounce: wait briefly after receiving audio to catch rapid-fire VAD splits
    _audio_debounce_task = None
    _audio_generation = 0  # monotonic counter to identify latest audio

    # Track connection state for safe sends
    _ws_closed = False

    async def safe_send_json(data):
        """Send JSON, silently skip if connection is closed."""
        if _ws_closed:
            return
        try:
            await ws.send_json(data)
        except Exception:
            pass

    async def safe_send_bytes(data):
        """Send bytes, silently skip if connection is closed."""
        if _ws_closed:
            return
        try:
            await ws.send_bytes(data)
        except Exception:
            pass

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
        nonlocal pipeline_task, _active_tts_task
        # Cancel TTS task first — stops audio output immediately
        if _active_tts_task and not _active_tts_task.done():
            _active_tts_task.cancel()
            try:
                await _active_tts_task
            except (asyncio.CancelledError, Exception):
                pass
            _active_tts_task = None
        if pipeline_task and not pipeline_task.done():
            pipeline_task.cancel()
            try:
                await pipeline_task
            except (asyncio.CancelledError, Exception):
                pass
            if notify:
                try:
                    await safe_send_json({"type": "llm_done", "interrupted": True})
                    await safe_send_json({"type": "tts_done"})
                except Exception:
                    pass
        pipeline_task = None

    async def run_voice_pipeline(transcript: str, detected_lang: str = "en"):
        """Stream LLM → TTS concurrently with aggressive first-chunk splitting."""
        nonlocal _active_tts_task
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

        # Inject RAG context if documents are uploaded
        loop = asyncio.get_event_loop()
        rag_context = ""
        rag_sources = []
        try:
            rag_result = await loop.run_in_executor(
                _rag_executor, rag.retrieve_context_with_sources,
                session_id, transcript, list(conversation_history), active_workflow
            )
            rag_context = rag_result.get("context", "")
            rag_sources = rag_result.get("sources", [])
        except Exception as e:
            print(f"⚠️ Voice RAG retrieval failed (continuing without docs): {e}")

        # Send source preview cards to frontend before LLM starts
        if rag_sources:
            await safe_send_json({"type": "rag_sources", "sources": rag_sources})

        # When documents are uploaded, use the SAME detailed prompt as text chat
        # so voice responses match text quality. TTS strip_md_for_tts() handles speech formatting.
        # Without documents, use voice-optimized prompt for natural conversation.
        if rag_context:
            voice_messages = [
                {"role": "system", "content": config.get_system_prompt(assistant_key, active_workflow) + lang_instruction},
                *conversation_history[1:],
            ]
            voice_messages[0]["content"] += rag_context
            print(f"  📄 Voice RAG: injected context for '{transcript[:40]}' (using text-style prompt)")
        else:
            voice_messages = [
                {"role": "system", "content": config.get_voice_system_prompt(assistant_key, active_workflow) + lang_instruction},
                *conversation_history[1:],
            ]

        voice_messages = _trim_messages_to_budget(voice_messages)

        # Async queue: LLM feeds sentences → TTS worker consumes them
        tts_q: asyncio.Queue = asyncio.Queue()

        async def tts_worker():
            """Generate and send TTS audio for each chunk as it arrives."""
            first_audio = True
            chunk_count = 0
            loop = asyncio.get_event_loop()
            try:
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
                            await safe_send_json({"type": "tts_start"})
                            print(f"🔊 First audio [{time.perf_counter()-t0:.3f}s] tts={tts_ms:.0f}ms \"{clean[:40]}\"")
                            first_audio = False
                        await safe_send_bytes(wav)
                        chunk_count += 1
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        print(f"❌ TTS chunk error: {e}")
            except asyncio.CancelledError:
                print(f"⚡ TTS worker cancelled ({chunk_count} chunks sent)")
                return
            print(f"🔊 TTS done [{time.perf_counter()-t0:.3f}s] ({chunk_count} chunks)")

        try:
            await safe_send_json({"type": "llm_start"})
            tts_task = asyncio.create_task(tts_worker())
            _active_tts_task = tts_task

            # Stream LLM tokens — aggressive first-chunk for fast TTS start
            async with _llm_http.stream(
                "POST", "/v1/chat/completions",
                json={
                    "model": config.VLLM_MODEL,
                    "messages": voice_messages,
                    "max_tokens": 1536,
                    "temperature": 0.3,
                    "stream": True,
                },
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise RuntimeError(f"vLLM returned {resp.status_code}: {body.decode()[:200]}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue
                    chunk = json.loads(line[6:])
                    delta = chunk["choices"][0].get("delta", {}).get("content", "") or ""
                    finish = chunk["choices"][0].get("finish_reason")
                    if finish and finish == "length":
                        print(f"⚠️ Voice LLM hit token limit (finish_reason=length) after {len(full_reply)} chars")
                    if not delta:
                        continue
                    # Track LLM first token time
                    if not full_reply:
                        print(f"⚡ LLM first token [{time.perf_counter()-t0:.3f}s]")
                    full_reply += delta
                    chunk_buffer += delta
                    await safe_send_json({"type": "llm_delta", "text": delta})

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
            await safe_send_json({"type": "llm_done"})

            # Citation verification for voice pipeline
            if full_reply and rag_sources:
                clean_for_verify = _strip_think_blocks(full_reply)
                if clean_for_verify:
                    corrected_text, corrected_sources = verify_citations(clean_for_verify, rag_sources)
                    if corrected_text != clean_for_verify or len(corrected_sources) != len(rag_sources):
                        await safe_send_json({
                            "type": "citation_correction",
                            "text": corrected_text,
                            "sources": corrected_sources,
                        })

            await tts_task  # Wait for all TTS audio to send
            _active_tts_task = None
            await safe_send_json({"type": "tts_done"})

            if full_reply:
                clean_reply = _strip_think_blocks(full_reply)
                if clean_reply:
                    conversation_history.append({"role": "assistant", "content": clean_reply})
                    await _maybe_summarize_history(conversation_history)

            print(f"✅ [{time.perf_counter()-t0:.2f}s] Voice reply: {full_reply[:60]}...")

        except asyncio.CancelledError:
            print(f"⚡ Voice pipeline cancelled: {full_reply[:40]}...")
            # Explicitly cancel TTS task to stop audio immediately
            if tts_task and not tts_task.done():
                tts_task.cancel()
                try:
                    await tts_task
                except (asyncio.CancelledError, Exception):
                    pass
            _active_tts_task = None
            if full_reply:
                clean = _strip_think_blocks(full_reply)
                if clean:
                    conversation_history.append({"role": "assistant", "content": clean})
                    # Don't await summarize during cancel — just cap if needed
                    if len(conversation_history) > 201:
                        del conversation_history[1:-200]
            raise
        except Exception as e:
            print(f"❌ Pipeline error: {type(e).__name__}: {e}")
            import traceback; traceback.print_exc()
            tts_q.put_nowait(None)
            try:
                await safe_send_json({"type": "error", "text": str(e) or type(e).__name__})
                await safe_send_json({"type": "llm_done"})
                await safe_send_json({"type": "tts_done"})
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
                    want_tts = data.get("tts", False)
                    # Track workflow selection from frontend
                    msg_workflow = data.get("workflow", "")
                    if msg_workflow:
                        active_workflow = msg_workflow
                    if not user_text:
                        continue
                    print(f"💬 Text chat: {user_text[:60]} (workflow={active_workflow[:30]})")

                    # ── Hard Document Gate — require document upload before answering ──
                    # Applies when a workflow is selected OR for direct-doc assistants (no workflows)
                    _direct_doc_assistants = {"general"}
                    has_docs = rag.has_documents(session_id)
                    if not has_docs and (active_workflow or assistant_key in _direct_doc_assistants):
                        await safe_send_json({"type": "llm_start"})
                        upload_msg = config.get_upload_message(assistant_key, active_workflow)
                        await safe_send_json({"type": "llm_delta", "text": upload_msg})
                        await safe_send_json({"type": "llm_done"})
                        continue

                    # ── Irrelevant Document Gate — block if only irrelevant docs uploaded ──
                    tracker = _session_doc_relevance.get(session_id, {})
                    if tracker.get("total", 0) > 0 and tracker.get("irrelevant", 0) == tracker.get("total", 0):
                        role_info = config.ASSISTANT_ROLES.get(assistant_key, {})
                        role_name = role_info.get("role", assistant_key)
                        domain = role_info.get("domain", "this assistant's domain")
                        await safe_send_json({"type": "llm_start"})
                        await safe_send_json({"type": "llm_delta", "text": (
                            f"The uploaded document doesn't appear to be relevant to the **{role_name} Assistant**. "
                            f"I can only answer questions based on documents related to {domain}.\n\n"
                            f"Please upload a relevant document to get started, or switch to the **General Assistant** which accepts any document type."
                        )})
                        await safe_send_json({"type": "llm_done"})
                        continue

                    # Topic filter (workflow-aware)
                    if not config.is_topic_related(user_text, active_workflow):
                        await safe_send_json({"type": "llm_start"})
                        reject_msg = config.get_workflow_reject_message(active_workflow)
                        await safe_send_json({"type": "llm_delta", "text": reject_msg})
                        await safe_send_json({"type": "llm_done"})
                        continue

                    conversation_history.append({"role": "user", "content": user_text})
                    # Update system prompt with current workflow context
                    conversation_history[0] = {"role": "system", "content": config.get_system_prompt(assistant_key, active_workflow)}

                    if want_tts:
                        # Parallel LLM + TTS: response is streamed as text AND read aloud
                        await cancel_pipeline()
                        pipeline_task = asyncio.create_task(run_voice_pipeline(user_text))
                    else:
                        await safe_send_json({"type": "llm_start"})

                        # Inject RAG context if documents are uploaded
                        text_messages = list(conversation_history)
                        loop = asyncio.get_event_loop()
                        rag_context = ""
                        rag_sources = []
                        try:
                            rag_result = await loop.run_in_executor(
                                _rag_executor, rag.retrieve_context_with_sources,
                                session_id, user_text, list(conversation_history), active_workflow
                            )
                            rag_context = rag_result.get("context", "")
                            rag_sources = rag_result.get("sources", [])
                        except Exception as e:
                            print(f"⚠️ Text RAG retrieval failed (continuing without docs): {e}")

                        print(f"📎 RAG lookup: session={session_id}, has_context={bool(rag_context)}, context_len={len(rag_context)}, sources={len(rag_sources)}")

                        # Send source preview cards to frontend before LLM starts
                        if rag_sources:
                            await safe_send_json({"type": "rag_sources", "sources": rag_sources})

                        # If documents uploaded, inject RAG context; otherwise AI answers from knowledge
                        if rag_context:
                            text_messages[0] = {"role": "system", "content": text_messages[0]["content"] + rag_context}

                        # Use chat completions so vLLM applies the model's chat template
                        text_messages = _trim_messages_to_budget(text_messages)
                        full_reply = ""
                        t0 = time.perf_counter()
                        try:
                            async with _llm_http.stream(
                                "POST", "/v1/chat/completions",
                                json={
                                    "model": config.VLLM_MODEL,
                                    "messages": text_messages,
                                    "max_tokens": 2048,
                                    "temperature": 0.3,
                                    "stream": True,
                                },
                            ) as resp:
                                if resp.status_code != 200:
                                    body = await resp.aread()
                                    raise RuntimeError(f"vLLM returned {resp.status_code}: {body.decode()[:200]}")
                                async for line in resp.aiter_lines():
                                    if not line.startswith("data: ") or line == "data: [DONE]":
                                        continue
                                    chunk = json.loads(line[6:])
                                    delta = chunk["choices"][0].get("delta", {}).get("content", "") or ""
                                    finish = chunk["choices"][0].get("finish_reason")
                                    if finish and finish == "length":
                                        print(f"⚠️ Text LLM hit token limit (finish_reason=length) after {len(full_reply)} chars")
                                    if delta:
                                        full_reply += delta
                                        await safe_send_json({"type": "llm_delta", "text": delta})
                        except Exception as e:
                            print(f"❌ Text LLM error: {e}")
                            import traceback; traceback.print_exc()
                            try:
                                await safe_send_json({"type": "error", "text": str(e)})
                                await safe_send_json({"type": "llm_done"})
                            except Exception:
                                pass
                            # Save partial reply if any
                            if full_reply:
                                clean_reply = _strip_think_blocks(full_reply)
                                if clean_reply:
                                    conversation_history.append({"role": "assistant", "content": clean_reply})
                                    if len(conversation_history) > 201:
                                        del conversation_history[1:-200]
                            continue

                        # ── Citation verification: fix LLM citation mismatches ──
                        if full_reply and rag_sources:
                            clean_for_verify = _strip_think_blocks(full_reply)
                            if clean_for_verify:
                                corrected_text, corrected_sources = verify_citations(clean_for_verify, rag_sources)
                                if corrected_text != clean_for_verify or len(corrected_sources) != len(rag_sources):
                                    await safe_send_json({
                                        "type": "citation_correction",
                                        "text": corrected_text,
                                        "sources": corrected_sources,
                                    })
                                    rag_sources = corrected_sources

                        await safe_send_json({"type": "llm_done"})
                        print(f"✅ [{time.perf_counter()-t0:.2f}s] Text reply: {full_reply[:60]}...")

                        if full_reply:
                            clean_reply = _strip_think_blocks(full_reply)
                            if clean_reply:
                                conversation_history.append({"role": "assistant", "content": clean_reply})
                                await _maybe_summarize_history(conversation_history)

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
                    await asyncio.sleep(0.15)
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
                                await safe_send_json({"type": "vad_no_speech"})
                                return
                            wav_bytes = proc.stdout
                        except FileNotFoundError:
                            print("⚠️ ffmpeg not found, trying raw float32 decode")
                            audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                            if len(audio_f32) < 1600:
                                await safe_send_json({"type": "vad_no_speech"})
                                return
                            wav_bytes = float32_to_wav(audio_f32, sr=16000)
                        except Exception as e:
                            print(f"❌ Audio decode error: {e}")
                            await safe_send_json({"type": "vad_no_speech"})
                            return

                        stt_future = loop.run_in_executor(_stt_executor, stt.transcribe, wav_bytes)
                        try:
                            transcript, detected_lang = await stt_future
                        except Exception as e:
                            print(f"❌ STT error: {e}")
                            await safe_send_json({"type": "error", "text": f"STT error: {e}"})
                            return
                    else:
                        # Raw PCM from VAD — frontend sends float32 bytes (4 bytes/sample)
                        audio_f32 = np.frombuffer(audio_bytes, dtype=np.float32)
                        if len(audio_f32) < 800:
                            await safe_send_json({"type": "vad_no_speech"})
                            return

                        stt_future = loop.run_in_executor(_stt_executor, stt.transcribe_raw, audio_f32)
                        try:
                            transcript, detected_lang = await stt_future
                        except Exception as e:
                            print(f"❌ STT error: {e}")
                            await safe_send_json({"type": "error", "text": f"STT error: {e}"})
                            return

                    # Check again — newer audio may have arrived during STT
                    if gen != _audio_generation:
                        return

                    if not transcript or len(transcript.strip()) < 2:
                        await safe_send_json({"type": "vad_no_speech"})
                        return

                    # Only cancel pipeline AFTER confirming real speech via STT
                    # Echo/noise → empty transcript → pipeline continues undisturbed
                    await cancel_pipeline()

                    print(f"🎤 [{time.perf_counter()-t0:.2f}s] User ({detected_lang}): {transcript}")

                    # Hard document gate for voice — require docs first
                    if not rag.has_documents(session_id):
                        upload_msg = config.get_upload_message(assistant_key, active_workflow)
                        await safe_send_json({"type": "user_transcript", "text": transcript})
                        await safe_send_json({"type": "llm_start"})
                        await safe_send_json({"type": "llm_delta", "text": upload_msg})
                        await safe_send_json({"type": "llm_done"})
                        await _send_tts(ws, upload_msg)
                        await safe_send_json({"type": "tts_done"})
                        return

                    # Irrelevant document gate for voice — block if only irrelevant docs uploaded
                    tracker = _session_doc_relevance.get(session_id, {})
                    if tracker.get("total", 0) > 0 and tracker.get("irrelevant", 0) == tracker.get("total", 0):
                        role_info = config.ASSISTANT_ROLES.get(assistant_key, {})
                        role_name = role_info.get("role", assistant_key)
                        domain = role_info.get("domain", "this assistant's domain")
                        irrelevant_msg = (
                            f"The uploaded document doesn't appear to be relevant to the {role_name} Assistant. "
                            f"I can only answer questions based on documents related to {domain}. "
                            f"Please upload a relevant document to get started, or switch to the General Assistant which accepts any document type."
                        )
                        await safe_send_json({"type": "user_transcript", "text": transcript})
                        await safe_send_json({"type": "llm_start"})
                        await safe_send_json({"type": "llm_delta", "text": irrelevant_msg})
                        await safe_send_json({"type": "llm_done"})
                        await _send_tts(ws, irrelevant_msg)
                        await safe_send_json({"type": "tts_done"})
                        return

                    # Topic filter (workflow-aware)
                    if not config.is_topic_related(transcript, active_workflow):
                        reject_msg = config.get_workflow_reject_message(active_workflow)
                        await safe_send_json({"type": "user_transcript", "text": transcript})
                        await safe_send_json({"type": "llm_start"})
                        await safe_send_json({"type": "llm_delta", "text": reject_msg})
                        await safe_send_json({"type": "llm_done"})
                        await _send_tts(ws, reject_msg)
                        await safe_send_json({"type": "tts_done"})
                        return

                    await safe_send_json({"type": "user_transcript", "text": transcript})
                    conversation_history.append({"role": "user", "content": transcript})
                    # Update system prompt with current workflow context
                    conversation_history[0] = {"role": "system", "content": config.get_system_prompt(assistant_key, active_workflow)}

                    pipeline_task = asyncio.create_task(run_voice_pipeline(transcript, detected_lang))

                _audio_debounce_task = asyncio.create_task(_debounced_audio(raw_bytes, my_gen))

    except (WebSocketDisconnect, RuntimeError):
        _ws_closed = True
        ping_task.cancel()
        if _audio_debounce_task and not _audio_debounce_task.done():
            _audio_debounce_task.cancel()
        await cancel_pipeline(notify=False)
        print("🔌 Client disconnected")
    except Exception as e:
        _ws_closed = True
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
    async def safe_send_json(data):
        try:
            await ws.send_json(data)
        except Exception:
            pass

    async def safe_send_bytes(data):
        try:
            await ws.send_bytes(data)
        except Exception:
            pass

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
                await safe_send_json({"type": "tts_start"})
                print(f"🔊 TTS first audio [{time.perf_counter()-t0:.3f}s]")
                first_audio = False

            await safe_send_bytes(wav)
            chunk_count += 1

        print(f"🔊 TTS done [{time.perf_counter()-t0:.3f}s] {len(clean)} chars ({chunk_count} chunks)")

    except Exception as e:
        print(f"❌ TTS error: {e}")
        import traceback; traceback.print_exc()
        try:
            t0 = time.perf_counter()
            wav_bytes = await loop.run_in_executor(None, tts.to_wav_bytes, clean)
            wav_bytes = _normalize_wav(wav_bytes, target_peak=0.95)
            await safe_send_json({"type": "tts_start"})
            await safe_send_bytes(wav_bytes)
            print(f"🔊 TTS [{time.perf_counter()-t0:.3f}s] {len(clean)} chars (fallback)")
        except Exception as e2:
            print(f"❌ TTS fallback error: {e2}")


# ── Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"\n🚀 Starting server on port {config.SERVER_PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=config.SERVER_PORT, log_level="info")
