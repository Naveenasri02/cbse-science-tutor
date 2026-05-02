"""ChromaDB vector store with rich metadata for production RAG."""

import os
import json
import chromadb
from chromadb.config import Settings
import config


class VectorStore:
    """ChromaDB wrapper with per-session document storage and rich metadata."""

    def __init__(self):
        os.makedirs(config.CHROMA_PERSIST_DIR, exist_ok=True)
        self.client = chromadb.PersistentClient(path=config.CHROMA_PERSIST_DIR)
        print(f"  ✓ ChromaDB ready (persist={config.CHROMA_PERSIST_DIR})")

    def _collection_name(self, session_id: str) -> str:
        name = f"s_{session_id.replace('-', '_')}"
        name = ''.join(c if c.isalnum() or c == '_' else '_' for c in name)
        return name[:63] if len(name) >= 3 else name.ljust(3, '_')

    def add_document(
        self,
        session_id: str,
        doc_id: str,
        chunks: list,
        embeddings: list[list[float]],
        filename: str,
    ) -> int:
        """Store document chunks with embeddings and rich metadata."""
        col = self.client.get_or_create_collection(
            name=self._collection_name(session_id),
            metadata={"hnsw:space": "cosine"},
        )
        ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = []
        documents = []
        for i, chunk in enumerate(chunks):
            if isinstance(chunk, dict):
                documents.append(chunk["text"])
                metadatas.append({
                    "doc_id": doc_id,
                    "filename": filename,
                    "chunk_idx": i,
                    "type": chunk.get("type", "paragraph"),
                    "page": chunk.get("page", 0),
                    "page_end": chunk.get("page_end", chunk.get("page", 0)),
                    "section": chunk.get("section", ""),
                    "section_hierarchy": json.dumps(chunk.get("section_hierarchy", [])),
                    "position": chunk.get("position", i),
                })
            else:
                documents.append(chunk)
                metadatas.append({
                    "doc_id": doc_id,
                    "filename": filename,
                    "chunk_idx": i,
                    "type": "paragraph",
                    "page": 0,
                    "section": "",
                    "section_hierarchy": "[]",
                    "position": i,
                })

        col.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
        return len(chunks)

    def query(
        self,
        session_id: str,
        query_embedding: list[float],
        top_k: int = None,
        where: dict = None,
    ) -> list[dict]:
        """Retrieve top-k most relevant chunks with full metadata."""
        k = top_k or config.RAG_TOP_K
        col_name = self._collection_name(session_id)

        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return []

        if col.count() == 0:
            return []

        query_params = {
            "query_embeddings": [query_embedding],
            "n_results": min(k, col.count()),
        }
        if where:
            query_params["where"] = where

        results = col.query(**query_params)

        docs = []
        for i in range(len(results["documents"][0])):
            meta = results["metadatas"][0][i]
            hierarchy = meta.get("section_hierarchy", "[]")
            try:
                hierarchy = json.loads(hierarchy) if isinstance(hierarchy, str) else hierarchy
            except (json.JSONDecodeError, TypeError):
                hierarchy = []

            docs.append({
                "text": results["documents"][0][i],
                "filename": meta.get("filename", ""),
                "score": 1 - results["distances"][0][i],
                "page": meta.get("page", 0),
                "page_end": meta.get("page_end", meta.get("page", 0)),
                "section": meta.get("section", ""),
                "section_hierarchy": hierarchy,
                "type": meta.get("type", "paragraph"),
                "position": meta.get("position", 0),
                "doc_id": meta.get("doc_id", ""),
                "chunk_idx": meta.get("chunk_idx", 0),
            })
        return docs

    def delete_document(self, session_id: str, doc_id: str) -> int:
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
        except Exception:
            return 0
        results = col.get(where={"doc_id": doc_id})
        if results["ids"]:
            col.delete(ids=results["ids"])
            return len(results["ids"])
        return 0

    def delete_session(self, session_id: str):
        col_name = self._collection_name(session_id)
        try:
            self.client.delete_collection(col_name)
        except Exception:
            pass

    def list_documents(self, session_id: str) -> list[dict]:
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
        col_name = self._collection_name(session_id)
        try:
            col = self.client.get_collection(col_name)
            return col.count()
        except Exception:
            return 0

    def get_all_chunks_ordered(self, session_id: str) -> list[dict]:
        """Get ALL chunks ordered by document, page, position."""
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
            meta = results["metadatas"][i]
            hierarchy = meta.get("section_hierarchy", "[]")
            try:
                hierarchy = json.loads(hierarchy) if isinstance(hierarchy, str) else hierarchy
            except (json.JSONDecodeError, TypeError):
                hierarchy = []
            docs.append({
                "text": results["documents"][i],
                "filename": meta.get("filename", ""),
                "chunk_idx": meta.get("chunk_idx", 0),
                "doc_id": meta.get("doc_id", ""),
                "page": meta.get("page", 0),
                "page_end": meta.get("page_end", meta.get("page", 0)),
                "section": meta.get("section", ""),
                "section_hierarchy": hierarchy,
                "type": meta.get("type", "paragraph"),
                "position": meta.get("position", 0),
            })
        docs.sort(key=lambda d: (d["doc_id"], d["page"], d["position"]))
        return docs

    def get_document_topics(self, session_id: str) -> str:
        """Get uploaded document filenames for query analysis."""
        doc_list = self.list_documents(session_id)
        if not doc_list:
            return "No documents uploaded"
        return ", ".join(d["filename"] for d in doc_list)

    def has_documents(self, session_id: str) -> bool:
        return self.get_chunk_count(session_id) > 0
