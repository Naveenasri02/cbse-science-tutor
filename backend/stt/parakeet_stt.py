import numpy as np
import io
import tempfile
import os
import soundfile as sf


class ParakeetSTT:
    """GPU-accelerated NVIDIA Parakeet TDT 0.6B v2 — English-only, ultra-low latency."""

    def __init__(self):
        import nemo.collections.asr as nemo_asr

        print("  Loading Parakeet TDT 0.6B v2 on CUDA...")
        self.model = nemo_asr.models.ASRModel.from_pretrained(
            "nvidia/parakeet-tdt-0.6b-v2"
        )
        self.model.eval()
        self.model = self.model.cuda()

        # Warm up with multiple audio lengths to pre-compile CUDA kernels
        for length in [16000, 32000, 48000]:
            dummy = np.zeros(length, dtype=np.float32)
            self._transcribe_array(dummy)
        print("  ✓ Parakeet warmed up")

    def _transcribe_array(self, audio_f32: np.ndarray) -> str:
        """Transcribe a float32 numpy array via temp file."""
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False, dir="/tmp"
            ) as f:
                tmp_path = f.name
                sf.write(tmp_path, audio_f32, 16000)
            results = self.model.transcribe([tmp_path])
            if results and len(results) > 0:
                text = results[0] if isinstance(results[0], str) else str(results[0])
            else:
                text = ""
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
        return text.strip()

    def transcribe_raw(self, audio_f32: np.ndarray) -> tuple[str, str]:
        """Transcribe from raw float32 numpy array. Returns (text, language_code)."""
        if audio_f32.ndim > 1:
            audio_f32 = audio_f32.mean(axis=1)
        audio_f32 = audio_f32.astype(np.float32, copy=False)
        text = self._transcribe_array(audio_f32)
        return text, "en"

    def transcribe(self, audio_bytes: bytes) -> tuple[str, str]:
        """Transcribe from WAV bytes. Returns (text, language_code)."""
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        audio_data = audio_data.astype(np.float32)
        return self.transcribe_raw(audio_data)
