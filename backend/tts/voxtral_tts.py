import httpx
import io
import struct
import wave
import config


class VoxtralTTSEngine:
    """Voxtral TTS client — calls vllm-omni server via HTTP.
    Uses instructions parameter for natural conversational voice style.
    Supports both standard and streaming modes."""

    def __init__(self, base_url: str = "http://localhost:8003/v1"):
        self.base_url = base_url
        self.voice = config.TTS_VOICE
        self.instructions = config.TTS_INSTRUCTIONS
        self._client = httpx.Client(timeout=30.0)
        print(f"  ✓ Voxtral TTS client ready (voice={self.voice})")

    def to_wav_bytes(self, text: str) -> bytes:
        response = self._client.post(
            f"{self.base_url}/audio/speech",
            json={
                "input": text,
                "model": "mistralai/Voxtral-4B-TTS-2603",
                "response_format": "wav",
                "voice": self.voice,
                "instructions": self.instructions,
                "language": "English",
            },
        )
        response.raise_for_status()
        return response.content

    def stream_pcm(self, text: str):
        """Stream raw PCM audio chunks for lower time-to-first-audio.
        Yields raw PCM int16 bytes as they arrive."""
        with self._client.stream(
            "POST",
            f"{self.base_url}/audio/speech",
            json={
                "input": text,
                "model": "mistralai/Voxtral-4B-TTS-2603",
                "response_format": "pcm",
                "voice": self.voice,
                "instructions": self.instructions,
                "language": "English",
                "stream": True,
                "stream_format": "audio",
            },
        ) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk
