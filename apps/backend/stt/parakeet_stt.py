import numpy as np
import io
import os
import soundfile as sf


class ParakeetSTT:
    """NVIDIA Parakeet TDT 0.6B v2 — English-only ASR.
    Device controlled by STT_DEVICE env var ('cpu' default for memory-tight pods
    sharing GPU with vLLM; 'cuda' for dedicated GPU or large VRAM headroom)."""

    def __init__(self):
        import nemo.collections.asr as nemo_asr

        device = os.getenv("STT_DEVICE", "cpu").lower()
        print(f"  Loading Parakeet TDT 0.6B v2 on {device.upper()}...")
        # NeMo's from_pretrained defaults to CUDA if visible — pass map_location
        # explicitly so we never accidentally allocate VRAM that vLLM needs.
        self.model = nemo_asr.models.ASRModel.from_pretrained(
            "nvidia/parakeet-tdt-0.6b-v2",
            map_location="cuda" if device == "cuda" else "cpu",
        )
        self.model.eval()
        if device == "cuda":
            self.model = self.model.cuda()
        else:
            self.model = self.model.cpu()

        # Warm up with direct numpy arrays (15x faster than temp files)
        for length in [16000, 32000, 48000]:
            dummy = np.zeros(length, dtype=np.float32)
            self._transcribe_array(dummy)
        print("  ✓ Parakeet warmed up")

    def _transcribe_array(self, audio_f32: np.ndarray) -> str:
        """Transcribe a float32 numpy array directly (no file I/O)."""
        results = self.model.transcribe(audio=[audio_f32])
        if results and len(results) > 0:
            r = results[0]
            if isinstance(r, str):
                return r.strip()
            elif hasattr(r, 'text'):
                return r.text.strip()
            return str(r).strip()
        return ""

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
