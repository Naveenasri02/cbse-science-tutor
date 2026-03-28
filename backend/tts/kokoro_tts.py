import io
import wave
import numpy as np
from kokoro_onnx import Kokoro
import config


class KokoroTTS:
    """Fast ONNX TTS."""

    def __init__(self):
        print(f"  Loading Kokoro TTS...")
        self.kokoro = Kokoro(config.TTS_MODEL_PATH, config.TTS_VOICES_PATH)
        self.voice = config.TTS_VOICE
        self.speed = config.TTS_SPEED
        # Warm up
        self.kokoro.create("warmup", voice=self.voice, speed=self.speed)

    def to_wav_bytes(self, text: str) -> bytes:
        samples, sr = self.kokoro.create(text, voice=self.voice, speed=self.speed)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            audio_int16 = np.clip(samples * 32767, -32768, 32767).astype(np.int16)
            wf.writeframes(audio_int16.tobytes())
        buf.seek(0)
        return buf.read()
