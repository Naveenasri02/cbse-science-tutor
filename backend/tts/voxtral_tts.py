import httpx
import config


class VoxtralTTSEngine:
    """Voxtral TTS client — calls vllm-omni server via HTTP."""

    def __init__(self, base_url: str = "http://localhost:8003/v1"):
        self.base_url = base_url
        self.voice = config.TTS_VOICE
        self._client = httpx.Client(timeout=30.0)
        print("  ✓ Voxtral TTS client ready (HTTP → vllm-omni)")

    def to_wav_bytes(self, text: str) -> bytes:
        response = self._client.post(
            f"{self.base_url}/audio/speech",
            json={
                "input": text,
                "model": "mistralai/Voxtral-4B-TTS-2603",
                "response_format": "wav",
                "voice": self.voice,
            },
        )
        response.raise_for_status()
        return response.content
