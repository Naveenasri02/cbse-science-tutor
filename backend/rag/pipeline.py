import uuid
import time
import config
from rag.embedder import Embedder
from rag.chunker import process_document
from rag.store import VectorStore


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

    def retrieve_context(self, session_id: str, query: str) -> str:
        """Embed query, retrieve relevant chunks, return formatted context string."""
        if not self.store.has_documents(session_id):
            return ""

        query_vec = self.embedder.embed(query)
        results = self.store.query(session_id, query_vec)

        if not results:
            return ""

        # Build context string from retrieved chunks
        parts = []
        for i, r in enumerate(results, 1):
            parts.append(f"[{r['filename']}] {r['text']}")

        context = "\n---\n".join(parts)
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
