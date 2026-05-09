"""Production embedder: BGE-large + BM25 hybrid search support."""

import os
import numpy as np
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
import re
import config


def _tokenize_for_bm25(text: str) -> list[str]:
    """Simple whitespace + punctuation tokenizer for BM25."""
    return re.findall(r'\w+', text.lower())


class Embedder:
    """BGE-large-en-v1.5 embedding model + BM25 sparse index.
    Device controlled by EMBEDDING_DEVICE env var (default 'cpu' to avoid
    fighting vLLM for VRAM on shared-GPU pods)."""

    def __init__(self):
        device = os.getenv("EMBEDDING_DEVICE", "cpu").lower()
        print(f"  Loading embedding model {config.EMBEDDING_MODEL} on {device.upper()}...")
        self.model = SentenceTransformer(config.EMBEDDING_MODEL, device=device)
        self.dim = self.model.get_sentence_embedding_dimension()
        self.model.encode(["warmup sentence"], normalize_embeddings=True)
        print(f"  ✓ Embedder ready (dim={self.dim})")

    def embed(self, text: str) -> list[float]:
        """Embed a single text string. Returns normalized vector."""
        vec = self.model.encode(text, normalize_embeddings=True)
        return vec.tolist()

    def embed_batch(self, texts: list[str], batch_size: int = 64) -> list[list[float]]:
        """Embed multiple texts. Returns list of normalized vectors."""
        vecs = self.model.encode(texts, normalize_embeddings=True, batch_size=batch_size)
        return vecs.tolist()

    @staticmethod
    def build_bm25_index(texts: list[str]) -> BM25Okapi:
        """Build a BM25 sparse index from a list of texts."""
        tokenized = [_tokenize_for_bm25(t) for t in texts]
        return BM25Okapi(tokenized)

    @staticmethod
    def bm25_search(index: BM25Okapi, query: str, texts: list[str], top_k: int = 15) -> list[dict]:
        """Search BM25 index. Returns list of {index, score}."""
        tokenized_query = _tokenize_for_bm25(query)
        scores = index.get_scores(tokenized_query)
        top_indices = np.argsort(scores)[::-1][:top_k]
        results = []
        for idx in top_indices:
            if scores[idx] > 0:
                results.append({"index": int(idx), "score": float(scores[idx])})
        return results

    @staticmethod
    def reciprocal_rank_fusion(
        dense_results: list[dict],
        bm25_results: list[dict],
        dense_weight: float = None,
        bm25_weight: float = None,
        k: int = 60,
    ) -> list[dict]:
        """Merge dense and BM25 results using Reciprocal Rank Fusion.
        
        Each result dict must have 'index' key. Returns merged list sorted by RRF score.
        """
        dw = dense_weight or config.DENSE_WEIGHT
        bw = bm25_weight or config.BM25_WEIGHT
        rrf_scores = {}

        for rank, r in enumerate(dense_results):
            idx = r["index"]
            rrf_scores[idx] = rrf_scores.get(idx, 0) + dw * (1.0 / (k + rank + 1))

        for rank, r in enumerate(bm25_results):
            idx = r["index"]
            rrf_scores[idx] = rrf_scores.get(idx, 0) + bw * (1.0 / (k + rank + 1))

        merged = [{"index": idx, "rrf_score": score} for idx, score in rrf_scores.items()]
        merged.sort(key=lambda x: x["rrf_score"], reverse=True)
        return merged
