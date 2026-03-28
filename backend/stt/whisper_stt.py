import numpy as np
import io
import soundfile as sf
from faster_whisper import WhisperModel
import config


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
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
        )
        return " ".join(s.text for s in segments).strip()
