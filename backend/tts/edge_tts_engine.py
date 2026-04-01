import edge_tts
import config


class EdgeTTSEngine:
    """Microsoft Edge TTS — fast cloud neural TTS with streaming."""

    def __init__(self):
        self.voice = config.TTS_VOICE
        self.sr = 24000
        print(f"  ✓ Edge TTS ready (voice={self.voice})")

    async def generate(self, text: str, voice: str = None) -> bytes:
        """Generate MP3 audio from text. Returns complete MP3 bytes."""
        v = voice or self.voice
        communicate = edge_tts.Communicate(text, voice=v)
        audio = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
        return audio
