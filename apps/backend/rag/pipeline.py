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


def _normalize_chunk_text(text: str) -> str:
    """Fix spacing artifacts from PDF extraction (e.g., 'measureCPRquality' → 'measure CPRquality').

    Handles common patterns from legacy chunks extracted without proper span spacing.
    Not a full fix for all-lowercase joins — those are fixed at extraction (chunker.py).
    """
    # Insert space between lowercase→uppercase transitions
    result = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    # Insert space before opening parenthesis when preceded by letter
    result = re.sub(r'([a-zA-Z])\(', r'\1 (', result)
    # Insert space after closing parenthesis when followed by letter
    result = re.sub(r'\)([a-zA-Z])', r') \1', result)
    # Insert space after period when followed by uppercase (sentence boundary)
    result = re.sub(r'\.([A-Z])', r'. \1', result)
    # Insert space after comma when followed by letter (not numbers like 700,000)
    result = re.sub(r',([a-zA-Z])', r', \1', result)
    # Collapse multiple spaces
    result = re.sub(r'  +', ' ', result)
    return result.strip()


# ── STOP WORDS for citation verification ──
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "and", "but", "or", "if", "while", "because", "until", "although",
    "that", "this", "these", "those", "it", "its", "i", "me", "my",
    "we", "our", "you", "your", "he", "him", "his", "she", "her",
    "they", "them", "their", "what", "which", "who", "whom",
    "also", "about", "up", "well", "however", "thus", "therefore",
})


def _extract_key_terms(text: str) -> set[str]:
    """Extract meaningful terms from text, filtering stop words."""
    words = re.findall(r'[a-zA-Z][a-zA-Z0-9]{2,}', text.lower())
    return {w for w in words if w not in _STOP_WORDS}


def _compute_term_overlap(claim_terms: set[str], chunk_text: str) -> float:
    """Compute fraction of claim terms found in chunk text."""
    if not claim_terms:
        return 0.0
    chunk_lower = chunk_text.lower()
    matched = sum(1 for t in claim_terms if t in chunk_lower)
    return matched / len(claim_terms)


def verify_citations(response_text: str, sources: list[dict]) -> tuple[str, list[dict]]:
    """Verify and correct citation-to-source mapping in LLM response.

    For each [N] citation, checks if the surrounding sentence actually matches source N.
    If not, reassigns to the best-matching source. Also redistributes citations when
    one source is over-cited (>60% of all citations) and better-matching sources exist.
    Returns corrected text and filtered sources with ref fields updated.
    """
    if not sources or not response_text:
        return response_text, sources

    citation_pattern = re.compile(r'\[(\d{1,2})\]')
    all_refs_in_text = set(int(m.group(1)) for m in citation_pattern.finditer(response_text))

    if not all_refs_in_text:
        return response_text, sources

    print(f"  🔍 Citation verify: refs in text={sorted(all_refs_in_text)}, available sources={[s['ref'] for s in sources]}")

    source_by_ref = {s["ref"]: s for s in sources}

    # Split into sentences with citations
    sentence_pattern = re.compile(
        r'([^.!?\n]+(?:\[[\d]{1,2}\])+)',
        re.DOTALL,
    )
    sentences = sentence_pattern.findall(response_text)

    # Count how often each ref is cited
    ref_counts = {}
    for m in citation_pattern.finditer(response_text):
        r = int(m.group(1))
        ref_counts[r] = ref_counts.get(r, 0) + 1
    total_citations = sum(ref_counts.values())

    # Detect over-cited source: one ref used for >60% of all citations
    dominant_ref = None
    if total_citations >= 4:
        for r, count in ref_counts.items():
            if count / total_citations > 0.6:
                dominant_ref = r
                print(f"  ⚠️ Source [{r}] over-cited: {count}/{total_citations} ({count*100//total_citations}%)")
                break

    # For each sentence with citations, find best-matching source
    sentence_assignments = []  # list of (sentence, [(ref, best_ref, best_overlap)])
    for sentence in sentences:
        refs_in_sentence = [int(m.group(1)) for m in citation_pattern.finditer(sentence)]
        if not refs_in_sentence:
            continue

        claim = citation_pattern.sub('', sentence).strip()
        claim_terms = _extract_key_terms(claim)
        if len(claim_terms) < 3:
            sentence_assignments.append((sentence, [(r, r, 0.0) for r in refs_in_sentence]))
            continue

        assignments = []
        for ref in refs_in_sentence:
            if ref not in source_by_ref:
                print(f"  ⚠️ Citation [{ref}] not in sources — skipping")
                assignments.append((ref, ref, 0.0))
                continue

            # Score ALL sources against this claim
            scored = []
            for s in sources:
                overlap = _compute_term_overlap(claim_terms, s.get("text", ""))
                scored.append((s["ref"], overlap))
            scored.sort(key=lambda x: -x[1])

            cited_overlap = _compute_term_overlap(claim_terms, source_by_ref[ref].get("text", ""))
            best_ref, best_overlap = scored[0]

            assignments.append((ref, best_ref, best_overlap))

        sentence_assignments.append((sentence, assignments))

    # Build remap: for each sentence, decide whether to remap citations
    remap_per_occurrence = []  # list of (sentence_text, old_ref, new_ref)
    for sentence, assignments in sentence_assignments:
        for old_ref, best_ref, best_overlap in assignments:
            if old_ref not in source_by_ref:
                continue
            cited_overlap = _compute_term_overlap(
                _extract_key_terms(citation_pattern.sub('', sentence).strip()),
                source_by_ref[old_ref].get("text", "")
            )

            # Remap if: (a) much better source exists, or (b) this ref is over-cited and a good alternative exists
            should_remap = False
            if best_ref != old_ref and best_overlap > cited_overlap + 0.2:
                should_remap = True
            elif dominant_ref and old_ref == dominant_ref and best_ref != old_ref and best_overlap >= cited_overlap * 0.8 and best_overlap >= 0.3:
                should_remap = True

            if should_remap:
                remap_per_occurrence.append((sentence, old_ref, best_ref))
                print(f"  🔄 [{old_ref}]→[{best_ref}] overlap: {cited_overlap:.2f}→{best_overlap:.2f} | claim: {citation_pattern.sub('', sentence).strip()[:50]}...")

    if not remap_per_occurrence:
        cited_sources = [s for s in sources if s["ref"] in all_refs_in_text]
        print(f"  ✅ Citations verified — no remap needed, {len(cited_sources)} cited sources")
        return response_text, cited_sources if cited_sources else sources

    # Apply per-sentence remapping
    corrected = response_text
    for sentence_text, old_ref, new_ref in remap_per_occurrence:
        # Replace [old_ref] with [new_ref] only within this sentence occurrence
        old_citation = f'[{old_ref}]'
        new_citation = f'[{new_ref}]'
        remapped_sentence = sentence_text.replace(old_citation, new_citation, 1)
        corrected = corrected.replace(sentence_text, remapped_sentence, 1)

    print(f"  🔄 Citation redistribution: {len(remap_per_occurrence)} remaps applied")

    final_refs = set(int(m.group(1)) for m in citation_pattern.finditer(corrected))

    cited_sources = []
    seen_refs = set()
    for s in sources:
        if s["ref"] in final_refs and s["ref"] not in seen_refs:
            cited_sources.append(s)
            seen_refs.add(s["ref"])

    print(f"  📎 Final cited sources: {[s['ref'] for s in cited_sources]}")
    return corrected, cited_sources if cited_sources else sources


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

        # Use workflow-aware context budget
        context_budget = config.get_rag_context_tokens(workflow)
        rerank_top_k = config.get_rag_rerank_top_k(workflow)
        is_analysis_wf = config.is_analysis_workflow(workflow)

        # Small doc: inject everything
        if total_doc_tokens <= context_budget:
            print(f"  📄 RAG: full-doc injection ({len(all_chunks)} chunks, ~{total_doc_tokens} tokens)")
            context, included = self._format_context_with_sources(all_chunks, is_summary=False, workflow=workflow)
            sources = self._extract_source_metadata(all_chunks[:included])
            return {"context": context, "sources": sources}

        # Query analysis: classify intent (used for routing only — NEVER as a hard
        # refusal trigger). Gemma 4 (4B) misclassifies abstract academic questions
        # as 'out_of_scope' even when the doc clearly contains the answer (the
        # classifier prompt biases toward out_of_scope "when in doubt"). Letting
        # actual hybrid retrieval + reranker decide is more reliable: if retrieval
        # finds chunks above the relevance threshold, we answer; if not, the
        # downstream "no sufficiently relevant information" path (line below)
        # produces an evidence-grounded refusal.
        query_type = self._analyze_query(session_id, search_query, workflow)
        print(f"  🧠 RAG: query classified as '{query_type}' (routing-only; never blocks retrieval)")

        is_summary = query_type == "summary" or self._is_summary_query(search_query)
        is_analysis = query_type == "analysis" or is_analysis_wf

        if is_summary:
            print(f"  📖 RAG: summary mode ({len(all_chunks)} chunks)")
            context_body, included = self._build_context_with_sources(all_chunks)
            context = config.RAG_SUMMARY_PROMPT.format(context=context_body)
            sources = self._extract_source_metadata(all_chunks[:included])
            return {"context": context, "sources": sources}

        # For analysis queries: use multi-pass retrieval for comprehensive coverage
        if is_analysis:
            results = self._analysis_retrieve(session_id, search_query, all_chunks)
            print(f"  🔬 RAG: analysis retrieval → {len(results)} chunks")
        else:
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
        reranked = self.reranker.rerank(search_query, results, top_k=rerank_top_k)

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

        # P4: For analysis queries, expand retrieved chunks to full section parents
        if is_analysis:
            reranked = self._expand_to_parents(reranked, all_chunks, context_budget)
            print(f"  📑 RAG: expanded to {len(reranked)} section parents")

        context, included = self._format_context_with_sources(reranked, is_summary=False, workflow=workflow)
        sources = self._extract_source_metadata(reranked[:included])
        return {"context": context, "sources": sources}

    @staticmethod
    def _extract_source_metadata(chunks: list[dict]) -> list[dict]:
        """Extract source metadata for streaming preview cards."""
        import unicodedata
        sources = []
        for i, c in enumerate(chunks):
            page = c.get("page", 0)
            page_end = c.get("page_end", page)
            raw_text = c["text"].strip()
            # NFKD normalize for consistent matching with PDF.js text layer
            highlight_text = unicodedata.normalize("NFKD", raw_text)
            display_text = _normalize_chunk_text(raw_text)
            sources.append({
                "ref": i + 1,
                "filename": c.get("filename", "unknown"),
                "page": page,
                "page_end": page_end,
                "section": c.get("section", ""),
                "score": round(c.get("rerank_score", c.get("rrf_score", c.get("score", 0))), 3),
                "text": highlight_text,
                "snippet": display_text[:150].strip(),
            })
            print(f"  📌 Source [{i+1}] p.{page}{f'-{page_end}' if page_end != page else ''} | {raw_text[:60].replace(chr(10), ' ')}...")
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
        """Use LLM to classify query: answerable / analysis / out_of_scope / ambiguous / summary."""
        try:
            doc_topics = self.store.get_document_topics(session_id)
            prompt = config.QUERY_ANALYSIS_PROMPT.format(doc_topics=doc_topics, query=query, workflow=workflow or "General")
            result = _llm_generate_sync(prompt, max_tokens=20)
            # Clean up response — extract just the classification word
            result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()
            result = result.lower().strip().strip(".")
            valid = {"answerable", "analysis", "out_of_scope", "ambiguous", "summary"}
            for v in valid:
                if v in result:
                    return v
            return "answerable"
        except Exception as e:
            print(f"  ⚠️ Query analysis failed: {e}")
            return "answerable"

    def _analysis_retrieve(self, session_id: str, query: str, all_chunks: list[dict]) -> list[dict]:
        """Multi-pass retrieval for analysis queries — generates aspect queries for comprehensive coverage."""
        aspect_queries = self._generate_aspect_queries(query)
        print(f"  🔬 RAG: analysis multi-pass with {len(aspect_queries)} aspect queries")

        all_results = []
        seen_texts = set()

        for aq in aspect_queries:
            aq_results = self._hybrid_retrieve(session_id, aq, all_chunks)
            for r in aq_results:
                key = r["text"][:100]
                if key not in seen_texts:
                    seen_texts.add(key)
                    all_results.append(r)

        return all_results

    def _generate_aspect_queries(self, query: str) -> list[str]:
        """Generate multiple search queries covering different aspects for comprehensive retrieval."""
        try:
            prompt = (
                "A user wants a comprehensive analysis of a document. Generate 4-5 diverse search queries "
                "that together would retrieve ALL important aspects of the document.\n\n"
                "Cover different angles: rights/protections, obligations/responsibilities, "
                "terms/conditions, key details/provisions, and any special clauses.\n\n"
                f"User's question: {query}\n\n"
                "Output each query on a separate line, numbered:\n"
                "1. <query>\n2. <query>\n3. <query>\n4. <query>\n"
                "/no_think"
            )
            result = _llm_generate_sync(prompt, max_tokens=200)
            result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()

            aspect_queries = [query]  # always include original query
            for line in result.split("\n"):
                line = line.strip()
                cleaned = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
                if cleaned and len(cleaned) > 5 and cleaned != query:
                    aspect_queries.append(cleaned)

            return aspect_queries[:6]  # cap at 6 total (original + 5 aspects)
        except Exception as e:
            print(f"  ⚠️ Aspect query generation failed: {e}")
            return [query]

    def _expand_to_parents(self, reranked: list[dict], all_chunks: list[dict], max_tokens: int) -> list[dict]:
        """Replace retrieved chunks with their full section (parent) content for deeper context."""
        # Group all chunks by (doc_id, section)
        section_map = {}
        for c in all_chunks:
            key = (c.get("doc_id", ""), c.get("section", ""), c.get("filename", ""))
            section_map.setdefault(key, []).append(c)

        # For chunks with no section, group by (doc_id, page) instead
        page_map = {}
        for c in all_chunks:
            if not c.get("section"):
                key = (c.get("doc_id", ""), c.get("page", 0), c.get("filename", ""))
                page_map.setdefault(key, []).append(c)

        seen_keys = set()
        parent_chunks = []
        tokens_used = 0

        for chunk in reranked:
            section = chunk.get("section", "")
            doc_id = chunk.get("doc_id", "")
            filename = chunk.get("filename", "")

            if section:
                key = (doc_id, section, filename)
                group_map = section_map
            else:
                key = (doc_id, chunk.get("page", 0), filename)
                group_map = page_map

            if key in seen_keys:
                continue
            seen_keys.add(key)

            siblings = group_map.get(key, [chunk])
            siblings_sorted = sorted(siblings, key=lambda x: (x.get("page", 0), x.get("position", 0)))

            parent_text = "\n\n".join(s["text"] for s in siblings_sorted)
            parent_tokens = int(len(parent_text) / 2.8) + 5

            # Check token budget
            if tokens_used + parent_tokens > max_tokens:
                # Try adding just the original chunk instead
                chunk_tokens = int(len(chunk["text"]) / 2.8) + 5
                if tokens_used + chunk_tokens <= max_tokens:
                    parent_chunks.append(chunk)
                    tokens_used += chunk_tokens
                break

            parent_chunk = dict(chunk)
            parent_chunk["text"] = parent_text
            parent_chunk["page_end"] = max(s.get("page_end", s.get("page", 0)) for s in siblings_sorted)
            parent_chunks.append(parent_chunk)
            tokens_used += parent_tokens

        return parent_chunks if parent_chunks else reranked[:3]

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
            # Show page range when chunk spans multiple pages
            page = c.get("page", "?")
            page_end = c.get("page_end")
            page_str = str(page) if (not page_end or page_end == page) else f"{page}-{page_end}"
            source_tag = config.RAG_CONTEXT_PROMPT_TEMPLATE.format(
                ref_num=ref_num,
                filename=c.get("filename", "unknown"),
                page=page_str,
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
        return "\n---\n".join(parts), len(parts)

    def _format_context_with_sources(self, chunks: list[dict], is_summary: bool, workflow: str = "") -> tuple[str, int]:
        """Build final context string with source citations and RAG prompt.
        Returns: (formatted_context, number_of_chunks_included)"""
        context, included = self._build_context_with_sources(chunks)
        if is_summary:
            return config.RAG_SUMMARY_PROMPT.format(context=context), included
        return config.get_rag_context_prompt(workflow).format(context=context), included

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
