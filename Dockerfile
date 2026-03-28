FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    libsndfile1 ffmpeg curl git \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Install vLLM for LLM inference
RUN pip install --no-cache-dir vllm

# Copy backend code
COPY backend/ /app/

# Copy React build (built in CI or locally)
COPY frontend/dist/ /app/static/

# Download Kokoro TTS model if not present
RUN mkdir -p /app/voices && \
    python -c "from kokoro_onnx import Kokoro; print('Kokoro available')" || true

# Pre-download Whisper model
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')" || true

# Expose port
EXPOSE 8000

# Start script: launch vLLM server + FastAPI backend
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
