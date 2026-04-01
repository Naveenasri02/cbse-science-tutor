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
    """GPU-accelerated Whisper STT."""

    def __init__(self):
        print(f"  Loading Whisper {config.STT_MODEL_SIZE} on {config.STT_DEVICE}...")
        self.model = WhisperModel(
            config.STT_MODEL_SIZE,
            device=config.STT_DEVICE,
            compute_type=config.STT_COMPUTE_TYPE,
        )

    def transcribe(self, audio_bytes: bytes) -> str:
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        audio_data = audio_data.astype(np.float32)

        segments, _ = self.model.transcribe(
            audio_data,
            language="en",
            beam_size=1,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
        )
        text = " ".join(s.text for s in segments).strip()

        if _is_hallucination(text):
            return ""

        return text
