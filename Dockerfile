FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV VOICE_ENABLED=false

# System deps (minimal, no voice libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    ffmpeg curl git \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/bin/python3

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
