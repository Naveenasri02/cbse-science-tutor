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
    "- Your FIRST word must be a content word about the topic. "
    "NEVER start with: Sure, Ok, Of course, Great, Well, Absolutely, Right, Yeah, So, Definitely, Alright, Certainly, Oh, Yes, Hmm, Interesting.\n"
    "- Do NOT end with questions like 'Would you like to know more?' or 'Want me to explain further?' — just give the complete answer.\n"
    "- ALWAYS reply in the same language the student uses.\n"
    "- If the student's speech is unclear, politely ask them to repeat.\n"
    "/no_think"
)

# ── STT (faster-whisper on GPU) ──
STT_MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "large-v3-turbo")
STT_DEVICE = os.getenv("STT_DEVICE", "cuda")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")

# ── TTS (Edge TTS — Microsoft Neural Voices) ──
TTS_VOICE = os.getenv("TTS_VOICE", "en-IN-NeerjaNeural")

# Language code (from Whisper) → Edge TTS voice
LANG_VOICE_MAP = {
    "en": "en-IN-NeerjaNeural",       # English (Indian)
    "hi": "hi-IN-SwaraNeural",        # Hindi
    "fr": "fr-FR-DeniseNeural",       # French
    "es": "es-ES-ElviraNeural",       # Spanish
    "ja": "ja-JP-NanamiNeural",       # Japanese
    "zh": "zh-CN-XiaoxiaoNeural",     # Chinese
    "ko": "ko-KR-SunHiNeural",        # Korean
    "pt": "pt-BR-FranciscaNeural",    # Portuguese
    "it": "it-IT-ElsaNeural",         # Italian
}
TTS_SUPPORTED_LANGS = set(LANG_VOICE_MAP.keys())

# ── Server ──
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# CBSE topic filter (disabled — all CBSE subjects allowed)
def is_cbse_related(text: str) -> bool:
    return True
