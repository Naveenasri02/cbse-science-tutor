import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM (vLLM on same machine) ──
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8002/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "invergent/Qwen3-30B-A3B-AWQ")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "cbse-sk-local")

SYSTEM_PROMPT = (
    "You are a helpful AI assistant. Answer questions clearly and accurately. "
    "Adapt your response based on how the user asks: "
    "If user says 'what is', 'define', or asks a short question, give a brief 2-3 sentence answer. "
    "If user says 'explain', 'describe', 'how does', give a medium answer with key points. "
    "If user says 'explain in detail', 'elaborate', 'tell me everything about', give a thorough answer. "
    "Match the depth and length of your answer to the user's question style. "
    "If the user sends an incomplete message like 'What is' or a fragment, try your best to guess the topic from context and answer helpfully. Never say 'your message is incomplete'. "
    "Be accurate, use proper terms, and keep answers clear and friendly."
)

VOICE_SYSTEM_PROMPT = (
    SYSTEM_PROMPT + "\n\n"
    "VOICE OUTPUT RULES (this response will be read aloud by TTS):\n"
    "- Write in flowing paragraphs. Convert any bullet points or numbered lists into connected sentences.\n"
    "- No markdown, no asterisks, no bold, no emojis, no special formatting characters.\n"
    "- Use contractions (it's, you'll, that's) and commas for natural speech rhythm.\n"
    "- Reply naturally based on the question, just like a normal conversation.\n"
    "- Do NOT end with questions like 'Would you like to know more?' or 'Want me to explain further?'\n"
    "- ALWAYS reply in the same language the student uses.\n"
    "- If the student's speech is unclear, politely ask them to repeat.\n"
    "/no_think"
)

# ── STT (NVIDIA Parakeet TDT 0.6B v2 on GPU) ──
STT_MODEL_NAME = os.getenv("STT_MODEL_NAME", "nvidia/parakeet-tdt-0.6b-v2")

# ── TTS (Kokoro ONNX on GPU) ──
TTS_MODEL_PATH = os.getenv("TTS_MODEL_PATH", "/workspace/kokoro-v1.0.onnx")
TTS_VOICES_PATH = os.getenv("TTS_VOICES_PATH", "/workspace/voices-v1.0.bin")
TTS_VOICE = os.getenv("TTS_VOICE", "af_bella")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.0"))

# Language code → Kokoro TTS voice
# Languages supported by Kokoro v1.0
LANG_VOICE_MAP = {
    "en": "af_bella",       # English → American female (most expressive)
    "fr": "ff_siwis",       # French
    "hi": "hf_alpha",       # Hindi
    "it": "if_sara",        # Italian
    "ja": "jf_alpha",       # Japanese
    "zh": "zf_xiaobei",     # Chinese (Mandarin)
    "pt": "pf_dora",        # Portuguese (Brazilian)
    "es": "ef_dora",        # Spanish
    "ko": "kf_alpha",       # Korean
}
TTS_SUPPORTED_LANGS = set(LANG_VOICE_MAP.keys())

# ── RAG (Document Q&A) ──
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "/workspace/vector_db")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "10"))
RAG_MAX_CONTEXT_TOKENS = int(os.getenv("RAG_MAX_CONTEXT_TOKENS", "900"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "300"))       # tokens per chunk
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "30"))   # overlap between chunks
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", str(50 * 1024 * 1024)))  # 50 MB
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/workspace/uploads")

RAG_CONTEXT_PROMPT = (
    "\n\nDOCUMENT CONTEXT (from uploaded files):\n"
    "{context}\n\n"
    "Use the above document context to answer the user's question. "
    "Base your response on the document content. "
    "If the answer is not in the documents, say so and use your general knowledge."
)

RAG_SUMMARY_PROMPT = (
    "\n\nFULL DOCUMENT CONTENT (from uploaded files):\n"
    "{context}\n\n"
    "The user wants a summary or overview of the above document. "
    "Provide a comprehensive summary covering ALL main sections, key details, and important information. "
    "Do not skip any section. Be thorough."
)

# ── Server ──
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# Topic filter (disabled — all topics allowed)
def is_topic_related(text: str) -> bool:
    return True
