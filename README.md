# CBSE Science Tutor — Voice + Text AI Chatbot

CBSE Class 10 Science AI tutor with voice and text chat, powered by a fine-tuned Qwen3-8B model.

## Architecture

```
React PWA (Vercel) ◄──WSS──► RunPod GPU Pod (A100)
  • Browser VAD                • FastAPI + WebSocket
  • ChatGPT-like UI            • STT: faster-whisper (GPU)
  • PWA installable            • LLM: vLLM (GPU, 300+ tok/s)
  • Mobile responsive          • TTS: Kokoro ONNX
```

## Quick Start

### Frontend (React PWA)

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_WS_URL` in `.env` to your backend WebSocket URL.

### Backend (Local Development)

```bash
cd backend
pip install -r requirements.txt
python server.py
```

### Deploy to RunPod

1. Build frontend: `cd frontend && npm run build`
2. Build Docker: `docker build -t cbse-chatbot .`
3. Push to DockerHub / RunPod registry
4. Create RunPod GPU pod with the image
5. Set `VITE_WS_URL` in Vercel to RunPod pod URL

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + Vite + TailwindCSS |
| Voice | Silero VAD (browser) + Kokoro TTS |
| STT | faster-whisper (GPU) |
| LLM | vLLM + Qwen3-8B fine-tuned |
| Backend | FastAPI + WebSocket |
| Hosting | Vercel (frontend) + RunPod (backend) |
