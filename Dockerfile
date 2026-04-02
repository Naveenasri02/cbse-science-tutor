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

# Pre-download Parakeet TDT model
RUN python -c "import nemo.collections.asr as nemo_asr; nemo_asr.models.ASRModel.from_pretrained('nvidia/parakeet-tdt-0.6b-v2')" || true

# Expose port
EXPOSE 8000

# Start script: launch vLLM server + FastAPI backend
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
