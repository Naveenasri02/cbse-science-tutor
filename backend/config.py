import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM (vLLM on same machine) ──
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8002/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "invergent/Qwen3-30B-A3B-AWQ")
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
    SYSTEM_PROMPT + "\n\n"
    "VOICE OUTPUT RULES (this response will be read aloud by TTS):\n"
    "- Write in flowing paragraphs. Convert any bullet points or numbered lists into connected sentences.\n"
    "- No markdown, no asterisks, no bold, no emojis, no special formatting characters.\n"
    "- Use contractions (it's, you'll, that's) and transition phrases (Moving on, Another key point is, Now) for natural speech.\n"
    "- Start with a BRIEF natural filler phrase like: 'So,', 'Well,', 'Okay so,', 'Right,', 'Alright,', 'Hmm,', 'Let me think...', 'Good question,'. "
    "Vary these — don't repeat the same filler every time. After the filler, immediately continue with the actual answer.\n"
    "- Do NOT end with questions like 'Would you like to know more?' or 'Want me to explain further?' — just give the complete answer.\n"
    "- ALWAYS reply in the same language the student uses.\n"
    "- If the student's speech is unclear, politely ask them to repeat.\n"
    "/no_think"
)

# ── STT (faster-whisper on GPU) ──
STT_MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "large-v3-turbo")
STT_DEVICE = os.getenv("STT_DEVICE", "cuda")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")

# ── TTS (Kokoro ONNX on GPU) ──
TTS_MODEL_PATH = os.getenv("TTS_MODEL_PATH", "/workspace/kokoro-v1.0.onnx")
TTS_VOICES_PATH = os.getenv("TTS_VOICES_PATH", "/workspace/voices-v1.0.bin")
TTS_VOICE = os.getenv("TTS_VOICE", "af_heart")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.0"))

# Language code (from Whisper) → Kokoro TTS voice
# Languages supported by Kokoro v1.0
LANG_VOICE_MAP = {
    "en": "af_heart",       # English → American female
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

# ── Server ──
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# CBSE topic filter (disabled — all CBSE subjects allowed)
def is_cbse_related(text: str) -> bool:
    return True
