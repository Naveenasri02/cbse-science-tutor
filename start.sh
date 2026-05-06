#!/bin/bash
set -e

# Environment for GPU inference
export HF_HOME=/workspace/.cache/huggingface
export HF_HUB_CACHE=/workspace/.cache/huggingface/hub
export PATH=/usr/local/cuda/bin:$PATH

# Ensure HuggingFace cache is on workspace (persistent volume)
mkdir -p /workspace/.cache/huggingface
ln -sf /workspace/.cache/huggingface /root/.cache/huggingface 2>/dev/null || true

# Ensure RAG directories exist
mkdir -p /workspace/vector_db
mkdir -p /workspace/uploads

# Install ffmpeg if not present (used for doc parsing edge cases)
which ffmpeg > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }

# Voice (STT/TTS) is disabled at the application level via VOICE_ENABLED=false in
# the pod's environment. No model downloads or driver shims required here.

# ── Start LLM server (vLLM serving Gemma 4 E4B FP8) ──
MODEL_NAME="${MODEL_NAME:-prithivMLmods/gemma-4-E4B-it-FP8}"
GPU_UTIL="${GPU_MEMORY_UTILIZATION:-0.7}"
MAX_LEN="${MAX_MODEL_LEN:-8192}"

nohup vllm serve "$MODEL_NAME" \
  --host 0.0.0.0 \
  --port 8002 \
  --gpu-memory-utilization "$GPU_UTIL" \
  --max-model-len "$MAX_LEN" \
  --api-key cbse-sk-local \
  --dtype auto \
  --quantization compressed-tensors \
  --trust-remote-code \
  > /workspace/llm_server.log 2>&1 &
echo "LLM (vLLM $MODEL_NAME) PID=$!"

echo "Waiting for LLM server..."
for i in $(seq 1 120); do
  curl -s http://localhost:8002/health > /dev/null 2>&1 && break
  sleep 5
done
echo "LLM ready"

# ── Start FastAPI server (handles /api/upload, /api/documents, /ws/voice for chat) ──
# server.py imports from /app (image WORKDIR). VOICE_ENABLED=false means STT/TTS
# modules are never imported, so the stt/ and tts/ directories are not required.
cd /app
exec python3 -u -m uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info
