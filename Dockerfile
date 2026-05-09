FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV VOICE_ENABLED=false

# Base image already ships Python 3.11 + PyTorch 2.8 + cu12.8.
# vLLM 0.20.1 wheels expect cu12.8 runtime; cu12.4 base broke vLLM startup
# (FastAPI bound 8000 but vLLM never bound 8002 on the GPU).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY apps/backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Install vLLM 0.20.1 (supports Gemma 4 multimodal architecture)
RUN pip install --no-cache-dir vllm==0.20.1

# Copy backend code (excludes stt/ and tts/ via .dockerignore)
COPY apps/backend/ /app/

# Frontend is hosted on Vercel; no static dist embedded in this image.
# (Backup's Dockerfile copied apps/web/dist into /app/static for same-origin
# serving — we serve frontend from Vercel and connect via wss:// to this pod.)

# Expose FastAPI port (LLM port 8002 stays internal/localhost-only)
EXPOSE 8000

# Start script: launch vLLM (port 8002) + FastAPI server (port 8000)
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
