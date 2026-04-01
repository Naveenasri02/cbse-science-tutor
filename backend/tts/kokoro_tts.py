import io
import os
import wave
import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro
import config


class KokoroTTS:
    """Kokoro TTS with GPU acceleration via ONNX Runtime CUDA."""

    def __init__(self):
        model_path = config.TTS_MODEL_PATH
        voices_path = config.TTS_VOICES_PATH
        print(f"  Loading Kokoro TTS (GPU)...")

        # Set cuDNN library path for CUDA provider
        cudnn_lib = "/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib"
        cublas_lib = "/usr/local/lib/python3.11/dist-packages/nvidia/cublas/lib"
        ld = os.environ.get("LD_LIBRARY_PATH", "")
        if cudnn_lib not in ld:
            os.environ["LD_LIBRARY_PATH"] = f"{cudnn_lib}:{cublas_lib}:{ld}"

        sess_opts = ort.SessionOptions()
        sess_opts.log_severity_level = 3  # suppress warnings
        sess = ort.InferenceSession(
            model_path,
            sess_options=sess_opts,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        active = sess.get_providers()
        print(f"  ONNX providers: {active}")

        self.kokoro = Kokoro.from_session(sess, voices_path)
        self.voice = config.TTS_VOICE
        self.speed = config.TTS_SPEED
        self.sr = 24000

        # Warmup with varying lengths to pre-compile all CUDA kernels
        warmup_phrases = [
            "warmup",
            "This is a test sentence",
            "Photosynthesis is the process by which green plants convert sunlight",
        ]
        for phrase in warmup_phrases:
            self.kokoro.create(phrase, voice=self.voice, speed=self.speed)
        # Second pass ensures kernels are fully cached
        for phrase in warmup_phrases:
            self.kokoro.create(phrase, voice=self.voice, speed=self.speed)
        print(f"  ✓ Kokoro TTS ready (voice={self.voice}, speed={self.speed})")

    def to_wav_bytes(self, text: str, voice: str = None) -> bytes:
        """Generate complete WAV audio from text."""
        v = voice or self.voice
        samples, sr = self.kokoro.create(text, voice=v, speed=self.speed)
        self.sr = sr
        audio_int16 = np.clip(samples * 32767, -32768, 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(audio_int16.tobytes())
        return buf.getvalue()

    def to_pcm_bytes(self, text: str, voice: str = None) -> bytes:
        """Generate raw PCM int16 bytes from text."""
        v = voice or self.voice
        samples, sr = self.kokoro.create(text, voice=v, speed=self.speed)
        self.sr = sr
        return np.clip(samples * 32767, -32768, 32767).astype(np.int16).tobytes()

    def stream_sentences(self, text: str, voice: str = None):
        """Split text into sentences and yield PCM for each.
        First sentence audio arrives fast while rest generates."""
        import re
        v = voice or self.voice
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            return
        for s in sentences:
            samples, sr = self.kokoro.create(s, voice=v, speed=self.speed)
            self.sr = sr
            pcm = np.clip(samples * 32767, -32768, 32767).astype(np.int16).tobytes()
            yield pcm
