import uuid
import time
import re
import config
from rag.embedder import Embedder
from rag.chunker import process_document
from rag.store import VectorStore

_SUMMARY_PATTERNS = re.compile(
    r"\b(summary|summarize|summarise|overview|what is this|what does this|"
    r"tell me about|describe this|about this document|what'?s in this|"
    r"main points|key points|highlights|brief|tldr|tl;dr|full content|"
    r"entire document|whole document|everything about|all about)\b",
    re.IGNORECASE,
)


class RAGPipeline:
    """Orchestrates document upload, embedding, storage, and retrieval."""

    def __init__(self):
        print("  [RAG] Initializing pipeline...")
        self.embedder = Embedder()
        self.store = VectorStore()
        print("  ✓ RAG pipeline ready")

    def ingest(self, session_id: str, file_bytes: bytes, filename: str) -> dict:
        """Process and store a document. Returns metadata."""
        t0 = time.perf_counter()

        if len(file_bytes) > config.MAX_UPLOAD_SIZE:
            raise ValueError(f"File too large ({len(file_bytes) / 1024 / 1024:.1f} MB). Max: {config.MAX_UPLOAD_SIZE / 1024 / 1024:.0f} MB")

        # Parse & chunk
        chunks = process_document(file_bytes, filename)
        t_parse = time.perf_counter()

        # Embed all chunks
        embeddings = self.embedder.embed_batch(chunks)
        t_embed = time.perf_counter()

        # Store in ChromaDB
        doc_id = str(uuid.uuid4())[:12]
        chunk_count = self.store.add_document(session_id, doc_id, chunks, embeddings, filename)
        t_store = time.perf_counter()

        print(
            f"📄 Ingested \"{filename}\" → {chunk_count} chunks "
            f"[parse={t_parse-t0:.2f}s embed={t_embed-t_parse:.2f}s store={t_store-t_embed:.2f}s total={t_store-t0:.2f}s]"
        )

        return {
            "doc_id": doc_id,
            "filename": filename,
            "chunks": chunk_count,
            "size_mb": round(len(file_bytes) / 1024 / 1024, 2),
        }

    @staticmethod
    def _is_summary_query(query: str) -> bool:
        """Detect if user wants a document-level answer (summary/overview)."""
        return bool(_SUMMARY_PATTERNS.search(query))

    @staticmethod
    def _build_context(results: list[dict], max_tokens: int = None) -> str:
        """Build context string, truncated to fit within token budget."""
        budget = max_tokens or config.RAG_MAX_CONTEXT_TOKENS
        parts = []
        tokens_used = 0
        for r in results:
            chunk_tokens = int(len(r["text"]) / 2.8) + 5  # conservative estimate + header
            if tokens_used + chunk_tokens > budget:
                remaining_chars = int((budget - tokens_used) * 2.8)
                if remaining_chars > 100:
                    parts.append(f"[{r['filename']}] {r['text'][:remaining_chars]}...")
                break
            parts.append(f"[{r['filename']}] {r['text']}")
            tokens_used += chunk_tokens
        return "\n---\n".join(parts)

    def retrieve_context(self, session_id: str, query: str) -> str:
        """Embed query, retrieve relevant chunks, return formatted context string."""
        if not self.store.has_documents(session_id):
            return ""

        total_chunks = self.store.get_chunk_count(session_id)
        is_summary = self._is_summary_query(query)

        # Estimate total doc size in tokens
        all_chunks = self.store.get_all_chunks_ordered(session_id)
        total_doc_tokens = sum(int(len(c["text"]) / 2.8) + 5 for c in all_chunks)

        if total_doc_tokens <= config.RAG_MAX_CONTEXT_TOKENS:
            # Small doc: inject FULL document (like ChatGPT does)
            results = all_chunks
            print(f"  📄 RAG: full-doc injection ({len(results)} chunks, {total_doc_tokens} tokens — fits in context)")
        elif is_summary:
            # Summary query on large doc: get all chunks, _build_context will truncate
            results = all_chunks
            print(f"  📖 RAG: full-doc retrieval for summary ({len(results)} chunks, {total_doc_tokens} tokens)")
        else:
            # Specific question on large doc: semantic search
            try:
                query_vec = self.embedder.embed(query)
                results = self.store.query(session_id, query_vec, top_k=config.RAG_TOP_K)
                print(f"  🔍 RAG: semantic search ({len(results)} chunks, scores={[round(r.get('score',0),2) for r in results[:3]]})")
            except Exception as e:
                print(f"  ❌ RAG embedding/search failed: {e}")
                results = []

        if not results:
            return ""

        context = self._build_context(results)

        if is_summary:
            return config.RAG_SUMMARY_PROMPT.format(context=context)
        return config.RAG_CONTEXT_PROMPT.format(context=context)

    def delete_document(self, session_id: str, doc_id: str) -> bool:
        """Remove a document from the store."""
        count = self.store.delete_document(session_id, doc_id)
        if count > 0:
            print(f"🗑️ Deleted doc {doc_id} ({count} chunks)")
        return count > 0

    def list_documents(self, session_id: str) -> list[dict]:
        """List documents in a session."""
        return self.store.list_documents(session_id)

    def has_documents(self, session_id: str) -> bool:
        """Check if session has any documents."""
        return self.store.has_documents(session_id)
