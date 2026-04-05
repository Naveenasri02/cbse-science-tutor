"""Production RAG pipeline — hybrid retrieval, reranking, query intelligence, source attribution."""

import uuid
import time
import re
import asyncio
import httpx
import config
from rag.embedder import Embedder
from rag.chunker import process_document
from rag.store import VectorStore
from rag.reranker import Reranker

_SUMMARY_PATTERNS = re.compile(
    r"\b(summary|summarize|summarise|overview|what is this|what does this|"
    r"tell me about|describe this|about this document|what'?s in this|"
    r"main points|key points|highlights|brief|tldr|tl;dr|full content|"
    r"entire document|whole document|everything about|all about)\b",
    re.IGNORECASE,
)


async def _llm_generate(prompt: str, max_tokens: int = 128) -> str:
    """Call vLLM for short generations (query analysis, contextual embedding)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{config.VLLM_BASE_URL}/chat/completions",
            json={
                "model": config.VLLM_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.1,
            },
            headers={"Authorization": f"Bearer {config.VLLM_API_KEY}"},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def _llm_generate_sync(prompt: str, max_tokens: int = 128) -> str:
    """Synchronous wrapper for _llm_generate (used in thread pool)."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, _llm_generate(prompt, max_tokens))
            return future.result(timeout=30)
    else:
        return asyncio.run(_llm_generate(prompt, max_tokens))


class RAGPipeline:
    """Production RAG: smart parsing → hybrid retrieval → reranking → grounded generation."""

    def __init__(self):
        print("  [RAG] Initializing production pipeline...")
        self.embedder = Embedder()
        self.store = VectorStore()
        self.reranker = Reranker()
        print("  ✓ RAG pipeline ready (embedder + store + reranker)")

    # ── INGESTION ──

    def ingest(self, session_id: str, file_bytes: bytes, filename: str) -> dict:
        """Parse, chunk, (optionally) contextualize, embed, and store a document."""
        t0 = time.perf_counter()

        if len(file_bytes) > config.MAX_UPLOAD_SIZE:
            raise ValueError(
                f"File too large ({len(file_bytes) / 1024 / 1024:.1f} MB). "
                f"Max: {config.MAX_UPLOAD_SIZE / 1024 / 1024:.0f} MB"
            )

        # 1. Parse & chunk → list of dicts with text + metadata
        chunk_dicts = process_document(file_bytes, filename)
        t_parse = time.perf_counter()

        # 2. Contextual embedding: prepend LLM-generated context to each chunk
        texts_to_embed = []
        if config.CONTEXTUAL_EMBEDDING and len(chunk_dicts) > 0:
            doc_preview = "\n".join(c["text"][:200] for c in chunk_dicts[:8])[:1500]
            texts_to_embed = self._contextualize_chunks(chunk_dicts, filename, doc_preview)
        else:
            texts_to_embed = [c["text"] for c in chunk_dicts]
        t_ctx = time.perf_counter()

        # 3. Embed all chunks
        embeddings = self.embedder.embed_batch(texts_to_embed)
        t_embed = time.perf_counter()

        # 4. Build BM25 index text (store raw text for keyword search)
        bm25_texts = [c["text"] for c in chunk_dicts]

        # 5. Store in ChromaDB (with rich metadata)
        doc_id = str(uuid.uuid4())[:12]
        chunk_count = self.store.add_document(session_id, doc_id, chunk_dicts, embeddings, filename)
        t_store = time.perf_counter()

        ctx_label = "ctx" if config.CONTEXTUAL_EMBEDDING else "no-ctx"
        print(
            f"📄 Ingested \"{filename}\" → {chunk_count} chunks "
            f"[parse={t_parse-t0:.2f}s {ctx_label}={t_ctx-t_parse:.2f}s "
            f"embed={t_embed-t_ctx:.2f}s store={t_store-t_embed:.2f}s total={t_store-t0:.2f}s]"
        )

        return {
            "doc_id": doc_id,
            "filename": filename,
            "chunks": chunk_count,
            "size_mb": round(len(file_bytes) / 1024 / 1024, 2),
        }

    def _contextualize_chunks(
        self, chunks: list[dict], filename: str, doc_preview: str
    ) -> list[str]:
        """Use LLM to prepend context to each chunk (Anthropic's technique)."""
        contextualized = []
        for chunk in chunks:
            try:
                prompt = config.CONTEXTUAL_CHUNK_PROMPT.format(
                    filename=filename,
                    doc_preview=doc_preview,
                    page=chunk.get("page", "?"),
                    chunk_text=chunk["text"][:800],
                )
                context = _llm_generate_sync(prompt, max_tokens=100)
                # Remove any /think tags from Qwen3
                context = re.sub(r'<think>.*?</think>', '', context, flags=re.DOTALL).strip()
                contextualized.append(f"{context}\n\n{chunk['text']}")
            except Exception as e:
                print(f"  ⚠️ Contextual embedding failed for chunk: {e}")
                contextualized.append(chunk["text"])
        return contextualized

    # ── RETRIEVAL ──

    def retrieve_context(self, session_id: str, query: str, conversation_history: list[dict] = None, workflow: str = "") -> str:
        """Full retrieval pipeline: rewrite → analyze → hybrid search → rerank → format with sources."""
        result = self.retrieve_context_with_sources(session_id, query, conversation_history, workflow)
        return result["context"]

    def retrieve_context_with_sources(self, session_id: str, query: str, conversation_history: list[dict] = None, workflow: str = "") -> dict:
        """Full retrieval pipeline returning context string + source metadata for streaming preview.

        Returns: {"context": str, "sources": [{"ref": int, "filename": str, "page": int, "section": str, "score": float}]}
        """
        if not self.store.has_documents(session_id):
            return {"context": "", "sources": []}

        # Rewrite query using conversation context for follow-up resolution
        search_query = self._rewrite_query(query, conversation_history)
        if search_query != query:
            print(f"  🔄 RAG: query rewritten: '{query[:50]}' → '{search_query[:50]}'")

        total_chunks = self.store.get_chunk_count(session_id)
        all_chunks = self.store.get_all_chunks_ordered(session_id)
        total_doc_tokens = sum(int(len(c["text"]) / 2.8) + 5 for c in all_chunks)

        # Small doc: inject everything
        if total_doc_tokens <= config.RAG_MAX_CONTEXT_TOKENS:
            print(f"  📄 RAG: full-doc injection ({len(all_chunks)} chunks, ~{total_doc_tokens} tokens)")
            context = self._format_context_with_sources(all_chunks, is_summary=False, workflow=workflow)
            sources = self._extract_source_metadata(all_chunks)
            return {"context": context, "sources": sources}

        # Query analysis: classify intent
        query_type = self._analyze_query(session_id, search_query, workflow)
        print(f"  🧠 RAG: query classified as '{query_type}'")

        if query_type == "out_of_scope":
            return {
                "context": (
                    "\n\n[RAG NOTE: The user's question appears unrelated to the uploaded documents. "
                    "Politely inform them that you can only answer questions about their uploaded documents.]\n"
                ),
                "sources": [],
            }

        if query_type == "ambiguous":
            return {
                "context": (
                    "\n\n[RAG NOTE: The user's question is ambiguous. "
                    "Ask them to clarify what specifically they're referring to in the documents.]\n"
                ),
                "sources": [],
            }

        is_summary = query_type == "summary" or self._is_summary_query(search_query)

        if is_summary:
            print(f"  📖 RAG: summary mode ({len(all_chunks)} chunks)")
            context_body = self._build_context_with_sources(all_chunks)
            context = config.RAG_SUMMARY_PROMPT.format(context=context_body)
            sources = self._extract_source_metadata(all_chunks)
            return {"context": context, "sources": sources}

        # Decompose complex queries into sub-queries for broader retrieval
        sub_queries = self._decompose_query(search_query)

        if len(sub_queries) > 1:
            print(f"  🔀 RAG: decomposed into {len(sub_queries)} sub-queries: {sub_queries}")
            all_results = []
            seen_texts = set()
            for sq in sub_queries:
                sq_results = self._hybrid_retrieve(session_id, sq, all_chunks)
                for r in sq_results:
                    key = r["text"][:100]
                    if key not in seen_texts:
                        seen_texts.add(key)
                        all_results.append(r)
            results = all_results
        else:
            results = self._hybrid_retrieve(session_id, search_query, all_chunks)

        if not results:
            return {"context": "", "sources": []}

        # Rerank all results together with the original query
        reranked = self.reranker.rerank(search_query, results, top_k=config.RAG_RERANK_TOP_K)

        # Deduplicate near-identical chunks (>85% text overlap)
        reranked = self._deduplicate_chunks(reranked)

        scores_str = [f"{r['rerank_score']:.3f}" for r in reranked[:3]]
        print(f"  🎯 RAG: reranked {len(results)}→{len(reranked)} chunks (top scores: {scores_str})")

        if not reranked:
            return {
                "context": (
                    "\n\n[RAG NOTE: No sufficiently relevant information was found in the uploaded documents "
                    "for this query. Let the user know their question doesn't seem to be covered in the documents.]\n"
                ),
                "sources": [],
            }

        context = self._format_context_with_sources(reranked, is_summary=False, workflow=workflow)
        sources = self._extract_source_metadata(reranked)
        return {"context": context, "sources": sources}

    @staticmethod
    def _extract_source_metadata(chunks: list[dict]) -> list[dict]:
        """Extract source metadata for streaming preview cards."""
        sources = []
        for i, c in enumerate(chunks):
            sources.append({
                "ref": i + 1,
                "filename": c.get("filename", "unknown"),
                "page": c.get("page", 0),
                "section": c.get("section", ""),
                "score": round(c.get("rerank_score", c.get("rrf_score", c.get("score", 0))), 3),
                "text": c["text"].strip(),
                "snippet": c["text"][:150].strip(),
            })
        return sources

    @staticmethod
    def _deduplicate_chunks(chunks: list[dict], threshold: float = 0.85) -> list[dict]:
        """Remove near-duplicate chunks based on character-level Jaccard similarity."""
        if len(chunks) <= 1:
            return chunks

        deduped = [chunks[0]]
        for candidate in chunks[1:]:
            is_dup = False
            cand_words = set(candidate["text"].lower().split())
            for kept in deduped:
                kept_words = set(kept["text"].lower().split())
                if not cand_words or not kept_words:
                    continue
                intersection = len(cand_words & kept_words)
                union = len(cand_words | kept_words)
                if union > 0 and intersection / union >= threshold:
                    is_dup = True
                    break
            if not is_dup:
                deduped.append(candidate)
        return deduped

    def _rewrite_query(self, query: str, conversation_history: list[dict] = None) -> str:
        """Rewrite a follow-up query into a self-contained search query using conversation context."""
        if not conversation_history or len(conversation_history) < 3:
            return query

        # Check if the query looks like a follow-up (short, uses pronouns, or lacks context)
        follow_up_indicators = [
            len(query.split()) < 8,
            any(w in query.lower().split() for w in ["it", "this", "that", "they", "them", "its", "those", "these", "he", "she"]),
            query.lower().startswith(("what about", "how about", "and ", "also ", "tell me more", "explain")),
        ]
        if not any(follow_up_indicators):
            return query

        # Build context from last 2-3 turns (skip system prompt at index 0)
        recent = conversation_history[-4:]  # last 2 user + 2 assistant turns
        turns_text = ""
        for msg in recent:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                # Truncate long assistant replies
                preview = content[:300] + "..." if len(content) > 300 else content
                turns_text += f"{role.upper()}: {preview}\n"

        try:
            prompt = (
                "Rewrite the user's follow-up question into a fully self-contained search query.\n"
                "Use the conversation context to resolve pronouns, references, and implicit topics.\n\n"
                f"Recent conversation:\n{turns_text}\n"
                f"Follow-up question: {query}\n\n"
                "Rewritten search query (one line, no explanation):\n"
                "/no_think"
            )
            rewritten = _llm_generate_sync(prompt, max_tokens=80)
            rewritten = re.sub(r'<think>.*?</think>', '', rewritten, flags=re.DOTALL).strip()
            # Clean up: remove quotes, prefixes
            rewritten = rewritten.strip('"\'').strip()
            if rewritten and len(rewritten) > 5:
                return rewritten
        except Exception as e:
            print(f"  ⚠️ Query rewriting failed: {e}")

        return query

    def _decompose_query(self, query: str) -> list[str]:
        """Decompose complex queries into sub-queries for broader retrieval coverage."""
        # Only decompose if query looks complex (comparisons, multiple topics, conjunctions)
        complexity_indicators = [
            any(w in query.lower() for w in ["compare", "contrast", "difference between", "versus", "vs"]),
            " and " in query.lower() and len(query.split()) > 10,
            any(w in query.lower() for w in ["both", "each", "respectively", "as well as"]),
            query.lower().count("section") > 1 or query.lower().count("chapter") > 1,
        ]
        if not any(complexity_indicators):
            return [query]

        try:
            prompt = (
                "Break this complex question into 2-3 simpler, independent search queries.\n"
                "Each sub-query should target a specific piece of information.\n"
                "If the question is already simple, return just the original.\n\n"
                f"Question: {query}\n\n"
                "Output each sub-query on a separate line, numbered:\n"
                "1. <sub-query>\n"
                "2. <sub-query>\n"
                "/no_think"
            )
            result = _llm_generate_sync(prompt, max_tokens=150)
            result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()

            sub_queries = []
            for line in result.split("\n"):
                line = line.strip()
                # Remove numbering like "1. " or "1) "
                cleaned = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
                if cleaned and len(cleaned) > 5:
                    sub_queries.append(cleaned)

            return sub_queries if len(sub_queries) >= 2 else [query]
        except Exception as e:
            print(f"  ⚠️ Query decomposition failed: {e}")
            return [query]

    def _analyze_query(self, session_id: str, query: str, workflow: str = "") -> str:
        """Use LLM to classify query: answerable / out_of_scope / ambiguous / summary."""
        try:
            doc_topics = self.store.get_document_topics(session_id)
            prompt = config.QUERY_ANALYSIS_PROMPT.format(doc_topics=doc_topics, query=query, workflow=workflow or "General")
            result = _llm_generate_sync(prompt, max_tokens=20)
            # Clean up response — extract just the classification word
            result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()
            result = result.lower().strip().strip(".")
            valid = {"answerable", "out_of_scope", "ambiguous", "summary"}
            for v in valid:
                if v in result:
                    return v
            return "answerable"
        except Exception as e:
            print(f"  ⚠️ Query analysis failed: {e}")
            return "answerable"

    def _hybrid_retrieve(self, session_id: str, query: str, all_chunks: list[dict]) -> list[dict]:
        """Dense embedding search + BM25 keyword search + RRF fusion."""
        try:
            # Dense search via ChromaDB
            query_vec = self.embedder.embed(query)
            dense_results = self.store.query(session_id, query_vec, top_k=config.RAG_TOP_K)

            # BM25 sparse search
            chunk_texts = [c["text"] for c in all_chunks]
            bm25_index = Embedder.build_bm25_index(chunk_texts)
            bm25_hits = Embedder.bm25_search(bm25_index, query, chunk_texts, top_k=config.RAG_TOP_K)

            # Map dense results to indices (match by text)
            text_to_idx = {c["text"][:100]: i for i, c in enumerate(all_chunks)}
            dense_indexed = []
            for r in dense_results:
                key = r["text"][:100]
                idx = text_to_idx.get(key, -1)
                if idx >= 0:
                    dense_indexed.append({"index": idx, "score": r.get("score", 0)})

            # RRF fusion
            merged = Embedder.reciprocal_rank_fusion(dense_indexed, bm25_hits)

            # Build result list from merged indices
            results = []
            seen = set()
            for item in merged[:config.RAG_TOP_K]:
                idx = item["index"]
                if idx < len(all_chunks) and idx not in seen:
                    seen.add(idx)
                    chunk = dict(all_chunks[idx])
                    chunk["rrf_score"] = item["rrf_score"]
                    results.append(chunk)

            print(f"  🔀 RAG: hybrid search → dense={len(dense_indexed)}, bm25={len(bm25_hits)}, fused={len(results)}")
            return results

        except Exception as e:
            print(f"  ❌ RAG hybrid search failed: {e}")
            # Fallback: dense-only
            try:
                query_vec = self.embedder.embed(query)
                return self.store.query(session_id, query_vec, top_k=config.RAG_TOP_K)
            except Exception:
                return []

    # ── CONTEXT FORMATTING ──

    @staticmethod
    def _is_summary_query(query: str) -> bool:
        return bool(_SUMMARY_PATTERNS.search(query))

    @staticmethod
    def _build_context_with_sources(chunks: list[dict], max_tokens: int = None) -> str:
        """Format chunks with numbered source attribution [1], [2], etc., respecting token budget."""
        budget = max_tokens or config.RAG_MAX_CONTEXT_TOKENS
        parts = []
        tokens_used = 0
        for i, c in enumerate(chunks):
            ref_num = i + 1
            source_tag = config.RAG_CONTEXT_PROMPT_TEMPLATE.format(
                ref_num=ref_num,
                filename=c.get("filename", "unknown"),
                page=c.get("page", "?"),
                section=c.get("section", ""),
                text=c["text"],
            )
            chunk_tokens = int(len(source_tag) / 2.8)
            if tokens_used + chunk_tokens > budget:
                remaining_chars = int((budget - tokens_used) * 2.8)
                if remaining_chars > 100:
                    parts.append(source_tag[:remaining_chars] + "...")
                break
            parts.append(source_tag)
            tokens_used += chunk_tokens
        return "\n---\n".join(parts)

    def _format_context_with_sources(self, chunks: list[dict], is_summary: bool, workflow: str = "") -> str:
        """Build final context string with source citations and RAG prompt."""
        context = self._build_context_with_sources(chunks)
        if is_summary:
            return config.RAG_SUMMARY_PROMPT.format(context=context)
        return config.get_rag_context_prompt(workflow).format(context=context)

    # ── DOCUMENT MANAGEMENT ──

    def delete_document(self, session_id: str, doc_id: str) -> bool:
        count = self.store.delete_document(session_id, doc_id)
        if count > 0:
            print(f"🗑️ Deleted doc {doc_id} ({count} chunks)")
        return count > 0

    def list_documents(self, session_id: str) -> list[dict]:
        return self.store.list_documents(session_id)

    def has_documents(self, session_id: str) -> bool:
        return self.store.has_documents(session_id)
