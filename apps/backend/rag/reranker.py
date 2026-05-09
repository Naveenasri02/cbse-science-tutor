"""Cross-encoder reranker for RAG retrieval precision."""

import os
from sentence_transformers import CrossEncoder
import config


class Reranker:
    """BGE Reranker v2 — scores (query, chunk) relevance with cross-attention.
    Device controlled by RERANKER_DEVICE env var (default 'cpu' to avoid
    fighting vLLM for VRAM on shared-GPU pods)."""

    def __init__(self):
        device = os.getenv("RERANKER_DEVICE", "cpu").lower()
        print(f"  Loading reranker {config.RERANKER_MODEL} on {device.upper()}...")
        self.model = CrossEncoder(config.RERANKER_MODEL, max_length=512, device=device)
        # Warmup
        self.model.predict([("warmup query", "warmup passage")])
        print("  ✓ Reranker ready")

    def rerank(self, query: str, chunks: list[dict], top_k: int = None) -> list[dict]:
        """Rerank chunks by cross-encoder relevance score.

        Args:
            query: User query string
            chunks: List of dicts with at least 'text' key
            top_k: Max results to return (default: config.RAG_RERANK_TOP_K)

        Returns:
            Reranked list of chunk dicts with added 'rerank_score' key,
            filtered by score threshold, limited to top_k.
        """
        if not chunks:
            return []

        k = top_k or config.RAG_RERANK_TOP_K
        threshold = config.RERANKER_SCORE_THRESHOLD

        # Create (query, passage) pairs for cross-encoder
        pairs = [(query, c["text"]) for c in chunks]

        # Score all pairs
        scores = self.model.predict(pairs, show_progress_bar=False)

        # Attach scores and sort by relevance
        scored = []
        for chunk, score in zip(chunks, scores):
            chunk_copy = dict(chunk)
            chunk_copy["rerank_score"] = float(score)
            scored.append(chunk_copy)

        scored.sort(key=lambda x: x["rerank_score"], reverse=True)

        # Filter by threshold and limit
        filtered = [c for c in scored if c["rerank_score"] >= threshold]

        return filtered[:k]

    def has_relevant_results(self, query: str, chunks: list[dict]) -> bool:
        """Quick check: are ANY chunks relevant to this query?
        Used for out-of-scope detection."""
        if not chunks:
            return False
        reranked = self.rerank(query, chunks, top_k=1)
        return len(reranked) > 0
