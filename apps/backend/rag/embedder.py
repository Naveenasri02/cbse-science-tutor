import numpy as np
from sentence_transformers import SentenceTransformer
import config


class Embedder:
    """BGE-small-en-v1.5 embedding model on GPU for RAG retrieval."""

    def __init__(self):
        print(f"  Loading embedding model {config.EMBEDDING_MODEL}...")
        self.model = SentenceTransformer(config.EMBEDDING_MODEL, device="cuda")
        self.dim = self.model.get_sentence_embedding_dimension()

        # Warmup
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
