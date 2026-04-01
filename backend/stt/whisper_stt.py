import numpy as np
import io
import soundfile as sf
from faster_whisper import WhisperModel
import config

# Common Whisper hallucinations triggered by background noise
_HALLUCINATIONS = {
    "thank you", "thanks", "thanks for watching", "thanks for listening",
    "subscribe", "please subscribe", "like and subscribe",
    "subtitle", "subtitles", "captions",
    "music", "applause", "laughter",
    "you", "bye", "okay", "hmm", "uh", "um",
    "the end", "so", "i'm sorry",
}


def _is_hallucination(text: str) -> bool:
    """Detect common Whisper hallucinations from noise/silence."""
    t = text.strip().lower().rstrip(".")
    if t in _HALLUCINATIONS:
        return True
    # Repeated short phrases (Whisper artifact on noise)
    words = t.split()
    if len(words) >= 4 and len(set(words)) <= 2:
        return True
    return False


class WhisperSTT:
    """GPU-accelerated Whisper STT optimized for low latency."""

    def __init__(self):
        print(f"  Loading Whisper {config.STT_MODEL_SIZE} on {config.STT_DEVICE}...")
        self.model = WhisperModel(
            config.STT_MODEL_SIZE,
            device=config.STT_DEVICE,
            compute_type="int8_float16",  # ~30% faster than float16, negligible accuracy loss
        )
        # Warm up: run a dummy transcription so CUDA kernels are compiled
        dummy = np.zeros(16000, dtype=np.float32)
        list(self.model.transcribe(dummy, language="en", beam_size=1)[0])
        print("  ✓ Whisper warmed up")

    def transcribe(self, audio_bytes: bytes) -> str:
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        audio_data = audio_data.astype(np.float32)

        segments, _ = self.model.transcribe(
            audio_data,
            language="en",
            beam_size=1,
            without_timestamps=True,   # skip timestamp computation
            condition_on_previous_text=False,  # skip cross-attention on prior text
            vad_filter=False,          # client VAD already filters — skip double VAD
        )
        text = " ".join(s.text for s in segments).strip()

        if _is_hallucination(text):
            return ""

        return text
