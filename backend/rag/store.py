import os
import chromadb
from chromadb.config import Settings
import config


class VectorStore:
    """ChromaDB wrapper for per-session document storage."""

    def __init__(self):
        persist_dir = config.CHROMA_PERSIST_DIR
        os.makedirs(persist_dir, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_dir)
        print(f"  ✓ ChromaDB ready (persist={persist_dir})")

    def _collection_name(self, session_id: str) -> str:
        """Sanitize session_id into a valid ChromaDB collection name."""
        # ChromaDB requires: 3-63 chars, alphanumeric/underscore/hyphen, starts/ends with alphanum
        name = f"s_{session_id.replace('-', '_')}"
        name = ''.join(c if c.isalnum() or c == '_' else '_' for c in name)
        return name[:63] if len(name) >= 3 else name.ljust(3, '_')

    def add_document(
        self,
        session_id: str,
        doc_id: str,
        chunks: list[str],
        embeddings: list[list[float]],
        filename: str,
    ) -> int:
        """Store document chunks with embeddings. Returns number of chunks stored."""
        col = self.client.get_or_create_collection(
            name=self._collection_name(session_id),
            metadata={"hnsw:space": "cosine"},
        )
        ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id, "filename": filename, "chunk_idx": i} for i in range(len(chunks))]

        col.add(
            ids=ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
        )
        return len(chunks)

    def query(
        self,
        session_id: str,
        query_embedding: list[float],
        top_k: int = None,
    ) -> list[dict]:
        """Retrieve top-k most relevant chunks. Returns list of {text, filename, score}."""
        k = top_k or config.RAG_TOP_K
        col_name = self._collection_name(session_id)

        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return []

        if col.count() == 0:
            return []

        results = col.query(
            query_embeddings=[query_embedding],
            n_results=min(k, col.count()),
        )

        docs = []
        for i in range(len(results["documents"][0])):
            docs.append({
                "text": results["documents"][0][i],
                "filename": results["metadatas"][0][i].get("filename", ""),
                "score": 1 - results["distances"][0][i],  # cosine distance → similarity
            })
        return docs

    def delete_document(self, session_id: str, doc_id: str) -> int:
        """Remove all chunks for a document. Returns count deleted."""
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return 0

        # Get all chunk IDs for this doc
        results = col.get(where={"doc_id": doc_id})
        if results["ids"]:
            col.delete(ids=results["ids"])
            return len(results["ids"])
        return 0

    def delete_session(self, session_id: str):
        """Delete entire collection for a session."""
        col_name = self._collection_name(session_id)
        try:
            self.client.delete_collection(col_name)
        except Exception:
            pass

    def list_documents(self, session_id: str) -> list[dict]:
        """List unique documents in a session. Returns list of {doc_id, filename, chunk_count}."""
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return []

        if col.count() == 0:
            return []

        all_meta = col.get()["metadatas"]
        docs = {}
        for meta in all_meta:
            did = meta.get("doc_id", "")
            if did not in docs:
                docs[did] = {"doc_id": did, "filename": meta.get("filename", ""), "chunk_count": 0}
            docs[did]["chunk_count"] += 1
        return list(docs.values())

    def get_chunk_count(self, session_id: str) -> int:
        """Get total number of chunks in a session."""
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
            return col.count()
        except Exception:
            return 0

    def get_all_chunks_ordered(self, session_id: str) -> list[dict]:
        """Get ALL chunks ordered by document then chunk position."""
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return []

        if col.count() == 0:
            return []

        results = col.get(include=["documents", "metadatas"])
        docs = []
        for i in range(len(results["ids"])):
            docs.append({
                "text": results["documents"][i],
                "filename": results["metadatas"][i].get("filename", ""),
                "chunk_idx": results["metadatas"][i].get("chunk_idx", 0),
                "doc_id": results["metadatas"][i].get("doc_id", ""),
            })
        docs.sort(key=lambda d: (d["doc_id"], d["chunk_idx"]))
        return docs

    def has_documents(self, session_id: str) -> bool:
        """Check if session has any uploaded documents."""
        return self.get_chunk_count(session_id) > 0
