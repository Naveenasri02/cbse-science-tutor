import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM (vLLM on same machine) ──
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8002/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "cbse-science-v2")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "cbse-sk-local")

SYSTEM_PROMPT = (
    "You are a CBSE Class 10 Science tutor. Answer ONLY from NCERT Class 10 Science textbook content. "
    "Adapt your response based on how the user asks: "
    "If user says 'what is', 'define', or asks a short question, give a brief 2-3 sentence answer. "
    "If user says 'explain', 'describe', 'how does', give a medium answer with key points. "
    "If user says 'explain in detail', 'elaborate', 'tell me everything about', give a thorough answer. "
    "Match the depth and length of your answer to the user's question style. "
    "Be accurate, use proper scientific terms, and keep answers student-friendly."
)

# ── STT (faster-whisper on GPU) ──
STT_MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "small")
STT_DEVICE = os.getenv("STT_DEVICE", "cuda")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")

# ── TTS (Kokoro ONNX) ──
_base = os.path.dirname(os.path.abspath(__file__))
TTS_MODEL_PATH = os.getenv("TTS_MODEL_PATH", os.path.join(_base, "voices", "kokoro-v1.0.onnx"))
TTS_VOICES_PATH = os.getenv("TTS_VOICES_PATH", os.path.join(_base, "voices", "voices-v1.0.bin"))
TTS_VOICE = os.getenv("TTS_VOICE", "af_heart")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.1"))

# ── Server ──
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# CBSE topic filter
CBSE_KEYWORDS = [
    "light", "reflection", "refraction", "lens", "mirror", "concave", "convex",
    "electricity", "current", "voltage", "resistance", "ohm", "circuit", "magnetic",
    "prism", "dispersion", "spectrum", "focal", "watt", "joule", "ampere",
    "acid", "base", "salt", "indicator", "chemical", "reaction", "equation",
    "metal", "non-metal", "carbon", "compound", "element", "periodic",
    "ionic", "covalent", "oxidation", "reduction", "corrosion",
    "hydrocarbon", "organic", "functional group", "homologous",
    "displacement", "decomposition", "combination", "neutralization",
    "cell", "tissue", "organ", "photosynthesis", "respiration", "nutrition",
    "digestion", "heart", "blood", "nerve", "brain", "neuron", "hormone",
    "reproduction", "pollination", "fertilization", "heredity", "evolution",
    "gene", "dna", "chromosome", "mendel", "dominant", "recessive",
    "ecosystem", "food chain", "biodiversity", "ozone", "pollution",
    "plant", "animal", "chlorophyll", "stomata", "xylem", "phloem",
    "excretion", "kidney", "nephron", "enzyme", "villi", "alveoli",
    "science", "cbse", "class 10", "ncert", "physics", "chemistry", "biology",
    "atom", "molecule", "proton", "neutron", "electron", "isotope",
    "force", "motion", "velocity", "acceleration", "newton", "gravity",
    "momentum", "friction", "kinetic", "potential", "energy",
    "wave", "frequency", "wavelength", "solenoid", "generator", "motor",
    "renewable", "non-renewable", "fossil fuel", "solar", "nuclear", "fission",
]

REJECT_MSG = "I can only help with CBSE Class 10 Science topics. Please ask about Physics, Chemistry, or Biology from the CBSE Class 10 syllabus."


def is_cbse_related(text: str) -> bool:
    text_lower = text.lower().strip()
    if len(text_lower.split()) <= 2:
        return True
    return any(kw in text_lower for kw in CBSE_KEYWORDS)
