import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM (vLLM on same machine) ──
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8002/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "Qwen/Qwen3-8B-AWQ")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "cbse-sk-local")

SYSTEM_PROMPT = (
    "You are a CBSE Class 10 tutor. Answer questions from the entire CBSE Class 10 syllabus — "
    "Science, Mathematics, Social Science (History, Geography, Political Science, Economics), English, and Hindi. "
    "Adapt your response based on how the user asks: "
    "If user says 'what is', 'define', or asks a short question, give a brief 2-3 sentence answer. "
    "If user says 'explain', 'describe', 'how does', give a medium answer with key points. "
    "If user says 'explain in detail', 'elaborate', 'tell me everything about', give a thorough answer. "
    "Match the depth and length of your answer to the user's question style. "
    "If the user sends an incomplete message like 'What is' or a fragment, try your best to guess the topic from context and answer helpfully. Never say 'your message is incomplete'. "
    "Be accurate, use proper terms, and keep answers student-friendly."
)

VOICE_SYSTEM_PROMPT = (
    "You are a friendly CBSE Class 10 tutor for Science, Maths, Social Science, English, Hindi. "
    "This is a VOICE conversation — speak naturally like a real teacher talking to a student. "
    "Use contractions (it's, you'll, that's), casual connectors (so, well, basically), "
    "and a warm encouraging tone. Give clear, complete answers in 2-4 sentences. "
    "Be direct, accurate, and conversational. No lists, no markdown, no special characters. "
    "If unclear, kindly ask the student to repeat. /no_think"
)

# ── STT (faster-whisper on GPU) ──
STT_MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "large-v3")
STT_DEVICE = os.getenv("STT_DEVICE", "cuda")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")

# ── TTS (Voxtral 4B) ──
TTS_VOICE = os.getenv("TTS_VOICE", "neutral_female")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.0"))

# ── Server ──
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# CBSE topic filter (disabled — all CBSE subjects allowed)
def is_cbse_related(text: str) -> bool:
    return True
