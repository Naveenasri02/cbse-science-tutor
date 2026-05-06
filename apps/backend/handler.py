"""RunPod Serverless handler for CBSE backend (text-only, RAG enabled).

Replaces the WebSocket FastAPI server. Handles four ops:
  - chat: streaming RAG-grounded chat completion
  - upload: ingest a base64-encoded file into ChromaDB + auto-summary
  - list_documents: list ingested docs for a session
  - delete_document: remove a doc from the vector store

Voice models (Parakeet, Kokoro) are NEVER loaded — text-only build.
ChromaDB persists to /runpod-volume/chroma when a network volume is attached;
falls back to ephemeral /tmp/chroma when no volume.
"""
import os
import re
import sys
import json
import base64
import asyncio
import traceback
from pathlib import Path

print("[boot] handler.py starting...", flush=True)
print(f"[boot] python {sys.version.split()[0]}, cwd={os.getcwd()}", flush=True)

# Pre-import config: must point CHROMA persist dir before store.py is imported
_VOLUME = "/runpod-volume"
try:
    if Path(_VOLUME).exists():
        os.environ.setdefault("CHROMA_PERSIST_PATH", f"{_VOLUME}/chroma")
    else:
        os.environ.setdefault("CHROMA_PERSIST_PATH", "/tmp/chroma")
    Path(os.environ["CHROMA_PERSIST_PATH"]).mkdir(parents=True, exist_ok=True)
    print(f"[boot] CHROMA_PERSIST_PATH={os.environ['CHROMA_PERSIST_PATH']}", flush=True)
except Exception as e:
    print(f"[boot] WARN volume setup failed, using /tmp: {e}", flush=True)
    os.environ["CHROMA_PERSIST_PATH"] = "/tmp/chroma"
    Path("/tmp/chroma").mkdir(parents=True, exist_ok=True)

print("[boot] importing config...", flush=True)
import config
print(f"[boot] config OK. VLLM_BASE_URL={config.VLLM_BASE_URL}", flush=True)

print("[boot] importing httpx, runpod...", flush=True)
import httpx
import runpod
print(f"[boot] runpod version: {getattr(runpod, '__version__', 'unknown')}", flush=True)

# Lazy-init RAG components on first request (cold start)
_rag = None

# Track sessions where only irrelevant documents have been uploaded
# key=session_id, value={"total": int, "irrelevant": int}
_session_doc_relevance: dict[str, dict] = {}

_HTTP = httpx.AsyncClient(
    base_url=config.VLLM_BASE_URL.rstrip("/v1"),
    timeout=httpx.Timeout(connect=10.0, read=180.0, write=10.0, pool=10.0),
    headers={"Authorization": f"Bearer {config.VLLM_API_KEY}"},
)


def _lazy_init_rag():
    global _rag
    if _rag is not None:
        return _rag
    from rag.pipeline import RAGPipeline
    _rag = RAGPipeline()
    return _rag


# Pre-warm RAG at module load so first user chat doesn't pay the ~30s
# embedder cold-start (BGE-large into CPU RAM via sentence-transformers).
# In pod mode, this means handler.py's startup takes ~30s longer but every
# user-facing request is fast. Failures are tolerated — chat falls back to
# the lazy path on first call.
if os.environ.get("PREWARM_RAG", "1") == "1":
    try:
        print("[boot] pre-warming RAG embedder (PREWARM_RAG=1)...", flush=True)
        _lazy_init_rag()
        print("[boot] RAG embedder ready", flush=True)
    except Exception as _prewarm_err:
        print(f"[boot] WARN: RAG pre-warm failed, falling back to lazy: {_prewarm_err}", flush=True)


def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL).strip()


def _format_context(chunks):
    if not chunks:
        return ""
    lines = []
    for i, c in enumerate(chunks):
        ref = i + 1
        src = c.get("filename") or "doc"
        page = f", p.{c['page']}" if c.get("page") is not None else ""
        lines.append(f"[{ref}] ({src}{page}) {c.get('text', '')}")
    return "\n\nRelevant context (cite as [N]):\n" + "\n\n".join(lines)


async def _stream_llm(messages, max_tokens=1500):
    """Stream tokens from remote vLLM serverless. Yields delta strings."""
    body = {
        "model": config.VLLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }
    async with _HTTP.stream("POST", "/v1/chat/completions", json=body) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data: "):
                continue
            payload = line[6:].strip()
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
                delta = data.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta
            except json.JSONDecodeError:
                continue


# ── op: chat ────────────────────────────────────────────────

async def _op_chat(inp):
    assistant = inp.get("assistant", "general")
    session_id = inp.get("session_id", "default")
    history = inp.get("history", [])
    message = inp.get("message", "")
    workflow = inp.get("workflow") or ""

    if not message.strip():
        yield {"type": "error", "text": "empty message"}
        yield {"type": "llm_done"}
        return

    rag = _lazy_init_rag()

    # Hard document gate (mirrors server.py): if a workflow is selected or assistant requires docs,
    # block until at least one document is uploaded.
    _direct_doc_assistants = {"general"}
    has_docs = rag.has_documents(session_id)
    if not has_docs and (workflow or assistant in _direct_doc_assistants):
        upload_msg = config.get_upload_message(assistant, workflow)
        yield {"type": "llm_start"}
        yield {"type": "llm_delta", "text": upload_msg}
        yield {"type": "llm_done"}
        return

    # Irrelevant document gate
    tracker = _session_doc_relevance.get(session_id, {})
    if tracker.get("total", 0) > 0 and tracker.get("irrelevant", 0) == tracker.get("total", 0):
        role_info = config.ASSISTANT_ROLES.get(assistant, {})
        role_name = role_info.get("role", assistant)
        domain = role_info.get("domain", "this assistant's domain")
        msg = (
            f"The uploaded document doesn't appear to be relevant to the **{role_name} Assistant**. "
            f"I can only answer questions based on documents related to {domain}.\n\n"
            f"Please upload a relevant document to get started, or switch to the **General Assistant** which accepts any document type."
        )
        yield {"type": "llm_start"}
        yield {"type": "llm_delta", "text": msg}
        yield {"type": "llm_done"}
        return

    # Topic filter (workflow-aware)
    if not config.is_topic_related(message, workflow):
        reject_msg = config.get_workflow_reject_message(workflow)
        yield {"type": "llm_start"}
        yield {"type": "llm_delta", "text": reject_msg}
        yield {"type": "llm_done"}
        return

    # Build conversation history compatible with retrieval
    norm_history = []
    for m in history:
        role = m.get("role")
        content = m.get("content") or m.get("text", "")
        if role in ("user", "assistant") and content:
            norm_history.append({"role": role, "content": content})

    # RAG retrieval
    rag_context = ""
    sources = []
    try:
        result = rag.retrieve_context_with_sources(session_id, message, norm_history, workflow)
        rag_context = result.get("context", "")
        sources = result.get("sources", [])
    except Exception as e:
        print(f"[handler] RAG retrieval failed, proceeding without docs: {e}")

    if sources:
        yield {"type": "rag_sources", "sources": sources}

    # System prompt with workflow + assistant role
    system_prompt = config.get_system_prompt(assistant, workflow)
    if rag_context:
        system_prompt = system_prompt + rag_context

    messages = (
        [{"role": "system", "content": system_prompt}]
        + norm_history
        + [{"role": "user", "content": message}]
    )

    yield {"type": "llm_start"}
    full = ""
    try:
        async for delta in _stream_llm(messages, max_tokens=2048):
            full += delta
            yield {"type": "llm_delta", "text": delta}
    except Exception as e:
        yield {"type": "error", "text": f"llm error: {e}"}
        yield {"type": "llm_done"}
        return

    full = _strip_think(full)
    if sources and full:
        try:
            from rag.pipeline import verify_citations
            corrected, filtered = verify_citations(full, sources)
            if corrected != full or len(filtered) != len(sources):
                yield {"type": "citation_correction", "text": corrected, "sources": filtered}
        except Exception as e:
            print(f"[handler] citation verify failed: {e}")

    yield {"type": "llm_done"}


# ── op: upload (base64 file → RAG ingest + auto-summary) ────

async def _generate_doc_summary(rag, session_id: str, filename: str) -> dict:
    """Port of server.py _generate_doc_summary — NotebookLM-style overview."""
    all_chunks = rag.store.get_all_chunks_ordered(session_id)
    if not all_chunks:
        return {"summary": "", "suggested_questions": []}

    total_chars = sum(len(c["text"]) for c in all_chunks)
    if total_chars <= 16000:
        doc_content = "\n\n".join(c["text"] for c in all_chunks)
    else:
        front_parts, chars = [], 0
        for c in all_chunks:
            front_parts.append(c["text"])
            chars += len(c["text"])
            if chars > 10000:
                break
        back_parts, chars = [], 0
        for c in reversed(all_chunks):
            back_parts.insert(0, c["text"])
            chars += len(c["text"])
            if chars > 6000:
                break
        doc_content = "\n\n".join(front_parts) + "\n\n[...]\n\n" + "\n\n".join(back_parts)

    sections_with_pages = []
    for c in all_chunks:
        sec = c.get("section", "")
        page = c.get("page", 0)
        if sec and not any(s[0] == sec for s in sections_with_pages):
            sections_with_pages.append((sec, page))
    section_list = (
        "; ".join(f"{s} (p.{p})" if p else s for s, p in sections_with_pages[:20])
        if sections_with_pages else "No clear section headings detected"
    )

    prompt = (
        f"You are analyzing the document \"{filename}\".\n"
        f"Document sections: {section_list}\n"
        f"Total length: ~{total_chars} characters ({len(all_chunks)} chunks)\n\n"
        f"Document content:\n{doc_content[:16000]}\n\n"
        "Provide a comprehensive NotebookLM-style document overview in this EXACT format:\n\n"
        "DOCTYPE: <one of: Legal Document, Research Paper, Business Report, Policy Document, "
        "Technical Manual, Educational Material, Financial Document, HR Document, General Document>\n"
        "SUMMARY_START\n"
        "Write EXACTLY 2-3 short sentences (max 40 words total).\n"
        "SUMMARY_END\n"
        "THEMES: <comma-separated 4-8 key themes>\n"
        "ENTITIES: <comma-separated key people/orgs/dates/amounts>\n"
        "KEYFINDINGS: F1: ..., F2: ..., F3: ...\n"
        "TERMS: T1: term — definition, T2: term — definition\n"
        "TOC: S1: section_name|page, S2: section_name|page\n"
        "Q1: <question 1>\nQ2: <question 2>\nQ3: <question 3>\nQ4: <question 4>\nQ5: <question 5>\n"
        "/no_think"
    )

    summary, doc_type = "", ""
    themes, entities, questions, key_findings, terms, toc = [], [], [], [], [], []

    try:
        resp = await _HTTP.post("/v1/chat/completions", json={
            "model": config.VLLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1500,
            "temperature": 0.3,
        }, timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0))
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"].strip()
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    except Exception as e:
        print(f"[handler] auto-summary LLM call failed: {e}")
        return {
            "summary": "", "doc_type": "", "themes": [], "entities": [],
            "suggested_questions": [], "key_findings": [], "terms": [], "toc": [],
        }

    summary_match = re.search(r'SUMMARY_START\s*\n(.*?)\nSUMMARY_END', text, re.DOTALL)
    if summary_match:
        summary = summary_match.group(1).strip()
    if summary:
        sentences = re.split(r'(?<=[.!?])\s+', summary)
        summary = ' '.join(sentences[:3])

    for line in text.split("\n"):
        line = line.strip()
        if line.upper().startswith("DOCTYPE:"):
            doc_type = line[8:].strip()
        elif line.upper().startswith("THEMES:"):
            themes = [t.strip() for t in line[7:].split(",") if t.strip()]
        elif line.upper().startswith("ENTITIES:"):
            entities = [e.strip() for e in line[9:].split(",") if e.strip()]
        elif line.upper().startswith("KEYFINDINGS:"):
            rest = line[12:].strip()
            if rest:
                parts = re.split(r'\s*F\d+:\s*', rest)
                for p in parts:
                    if p.strip():
                        key_findings.append(p.strip())
        elif re.match(r'^F\d+:', line):
            parts = re.split(r'\s*F\d+:\s*', line)
            for p in parts:
                if p.strip():
                    key_findings.append(p.strip())
        elif re.match(r'^T\d:', line):
            t = line[3:].strip()
            if t:
                terms.append(t)
        elif re.match(r'^S\d:', line):
            s = line[3:].strip()
            if s:
                parts = s.split("|")
                entry = {"title": parts[0].strip()}
                if len(parts) > 1:
                    try:
                        entry["page"] = int(parts[1].strip())
                    except ValueError:
                        pass
                toc.append(entry)
        elif re.match(r'^Q\d:', line):
            q = line[3:].strip()
            if q:
                questions.append(q)

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


async def _op_upload(inp):
    """Decode base64 file, ingest, generate summary, run relevance check."""
    session_id = inp.get("session_id", "default")
    filename = inp.get("filename", "document")
    assistant = inp.get("assistant", "general")
    workflow = inp.get("workflow") or ""
    file_b64 = inp.get("file_b64", "")

    if not file_b64:
        yield {"type": "error", "text": "missing file_b64"}
        return

    try:
        file_bytes = base64.b64decode(file_b64)
    except Exception as e:
        yield {"type": "error", "text": f"invalid base64: {e}"}
        return

    if len(file_bytes) > config.MAX_UPLOAD_SIZE:
        yield {"type": "error", "text": f"file too large (max {config.MAX_UPLOAD_SIZE // 1024 // 1024} MB)"}
        return

    from rag.chunker import SUPPORTED_EXTENSIONS
    ext = filename.lower()[filename.lower().rfind("."):] if "." in filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        yield {"type": "error", "text": f"unsupported file type. supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"}
        return

    rag = _lazy_init_rag()

    try:
        result = rag.ingest(session_id, file_bytes, filename)
    except ValueError as e:
        yield {"type": "error", "text": str(e)}
        return
    except Exception as e:
        traceback.print_exc()
        yield {"type": "error", "text": f"ingest failed: {e}"}
        return

    # Auto-summary
    try:
        summary_data = await _generate_doc_summary(rag, session_id, filename)
        result.update({
            "summary": summary_data.get("summary", ""),
            "doc_type": summary_data.get("doc_type", ""),
            "themes": summary_data.get("themes", []),
            "entities": summary_data.get("entities", []),
            "suggested_questions": summary_data.get("suggested_questions", []),
            "key_findings": summary_data.get("key_findings", []),
            "terms": summary_data.get("terms", []),
            "toc": summary_data.get("toc", []),
        })
    except Exception as e:
        print(f"[handler] auto-summary failed: {e}")
        result.update({
            "summary": "", "doc_type": "", "themes": [], "entities": [],
            "suggested_questions": [], "key_findings": [], "terms": [], "toc": [],
        })

    # Relevance check
    try:
        relevance = config.check_document_relevance(
            doc_type=result.get("doc_type", ""),
            themes=result.get("themes", []),
            summary=result.get("summary", ""),
            assistant_key=assistant,
            workflow=workflow,
        )
        tracker = _session_doc_relevance.setdefault(session_id, {"total": 0, "irrelevant": 0})
        tracker["total"] += 1
        if not relevance["relevant"]:
            result["relevance_warning"] = relevance["warning"]
            result["summary"] = ""
            result["suggested_questions"] = []
            result["key_findings"] = []
            result["terms"] = []
            result["toc"] = []
            tracker["irrelevant"] += 1
    except Exception as e:
        print(f"[handler] relevance check failed: {e}")

    yield {"type": "upload_done", "result": result}


# ── op: list_documents ──────────────────────────────────────

async def _op_list_documents(inp):
    session_id = inp.get("session_id", "default")
    rag = _lazy_init_rag()
    try:
        docs = rag.list_documents(session_id)
        yield {"type": "documents", "documents": docs}
    except Exception as e:
        yield {"type": "error", "text": f"list failed: {e}"}


# ── op: delete_document ─────────────────────────────────────

async def _op_delete_document(inp):
    session_id = inp.get("session_id", "default")
    doc_id = inp.get("doc_id", "")
    if not doc_id:
        yield {"type": "error", "text": "missing doc_id"}
        return
    rag = _lazy_init_rag()
    try:
        deleted = rag.delete_document(session_id, doc_id)
        yield {"type": "delete_done", "deleted": deleted, "doc_id": doc_id}
    except Exception as e:
        yield {"type": "error", "text": f"delete failed: {e}"}


async def _op_debug(inp):
    import subprocess
    log_path = inp.get("log_path", "/tmp/vllm.log")
    tail_lines = int(inp.get("tail", 200))
    info = {"log_path": log_path}
    try:
        info["log_exists"] = Path(log_path).exists()
        if info["log_exists"]:
            info["log_size"] = Path(log_path).stat().st_size
            with open(log_path, "r", errors="replace") as f:
                lines = f.readlines()
            info["log_tail"] = "".join(lines[-tail_lines:])
    except Exception as e:
        info["log_error"] = str(e)
    try:
        ps = subprocess.run(["ps", "auxww"], capture_output=True, text=True, timeout=5)
        info["ps_vllm_python"] = "\n".join(
            l for l in ps.stdout.splitlines() if "vllm" in l.lower() or "python" in l.lower()
        )
    except Exception as e:
        info["ps_error"] = str(e)
    try:
        nv = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total", "--format=csv"], capture_output=True, text=True, timeout=5)
        info["nvidia_smi"] = nv.stdout
    except Exception as e:
        info["nvidia_smi_error"] = str(e)
    yield {"type": "debug", "info": info}


# ── Dispatch ────────────────────────────────────────────────

async def _async_handler(event):
    inp = event.get("input", {}) or {}
    op = inp.get("op", "chat")

    if op == "chat":
        async for ev in _op_chat(inp):
            yield ev
        return
    if op == "upload":
        async for ev in _op_upload(inp):
            yield ev
        return
    if op == "list_documents":
        async for ev in _op_list_documents(inp):
            yield ev
        return
    if op == "delete_document":
        async for ev in _op_delete_document(inp):
            yield ev
        return
    if op == "debug":
        async for ev in _op_debug(inp):
            yield ev
        return

    yield {"type": "error", "text": f"unknown op: {op}"}


async def async_generator_handler(event):
    try:
        async for ev in _async_handler(event):
            yield ev
    except Exception as e:
        yield {"type": "error", "text": str(e), "traceback": traceback.format_exc()}


if __name__ == "__main__":
    print("[boot] registering handler with runpod.serverless.start...", flush=True)
    try:
        runpod.serverless.start({
            "handler": async_generator_handler,
            "return_aggregate_stream": True,
        })
        # If start() ever returns, that's wrong — log it so we can see
        print("[boot] WARNING: runpod.serverless.start returned (unexpected)", flush=True)
    except Exception as e:
        print(f"[boot] FATAL: runpod.serverless.start raised: {e}", flush=True)
        traceback.print_exc()
        raise
