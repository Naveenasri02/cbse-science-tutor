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
            compute_type=config.STT_COMPUTE_TYPE,
        )
        # Warm up with multiple audio lengths to pre-compile CUDA kernels
        for length in [16000, 32000, 48000]:
            dummy = np.zeros(length, dtype=np.float32)
            list(self.model.transcribe(dummy, language="en", beam_size=1)[0])
        print("  ✓ Whisper warmed up")

    def transcribe_raw(self, audio_f32: np.ndarray) -> str:
        """Transcribe from raw float32 numpy array directly (skip WAV encode/decode)."""
        if audio_f32.ndim > 1:
            audio_f32 = audio_f32.mean(axis=1)
        audio_f32 = audio_f32.astype(np.float32, copy=False)

        segments, _ = self.model.transcribe(
            audio_f32,
            language="en",
            beam_size=1,
            without_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        text = " ".join(s.text for s in segments).strip()
        return "" if _is_hallucination(text) else text

    def transcribe(self, audio_bytes: bytes) -> str:
        """Transcribe from WAV bytes (used for webm→wav decoded audio)."""
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        audio_data = audio_data.astype(np.float32)

        segments, _ = self.model.transcribe(
            audio_data,
            language="en",
            beam_size=1,
            without_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        text = " ".join(s.text for s in segments).strip()
        return "" if _is_hallucination(text) else text
