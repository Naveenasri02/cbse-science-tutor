#!/bin/bash
set -e

# Environment for GPU inference
export HF_HOME=/workspace/.cache/huggingface
export PATH=/usr/local/cuda/bin:$PATH

# Ensure HuggingFace cache is on workspace
mkdir -p /workspace/.cache/huggingface
ln -sf /workspace/.cache/huggingface /root/.cache/huggingface 2>/dev/null || true

# Install ffmpeg if not present
which ffmpeg > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }

# ── Fix TTS stage config (lower VRAM from 0.8 to 0.5) ──
TTS_YAML=$(python3 -c "import vllm_omni; import os; print(os.path.join(os.path.dirname(vllm_omni.__file__), 'model_executor/stage_configs/voxtral_tts.yaml'))")
if [ -f "$TTS_YAML" ]; then
  sed -i 's/gpu_memory_utilization: 0.8/gpu_memory_utilization: 0.5/' "$TTS_YAML"
  echo "Patched TTS stage config: gpu_memory_utilization 0.8 -> 0.5"
fi

# ── Start TTS server FIRST (needs more VRAM, start before LLM) ──
cd /workspace
nohup vllm serve mistralai/Voxtral-4B-TTS-2603 --omni \
  --host 0.0.0.0 \
  --port 8003 \
  --dtype bfloat16 \
  > /workspace/tts_server.log 2>&1 &
echo "TTS (Voxtral) PID=$!"

# Wait for TTS to load before starting LLM
echo "Waiting for TTS server..."
for i in $(seq 1 90); do
  curl -s http://localhost:8003/health > /dev/null 2>&1 && break
  sleep 5
done
echo "TTS ready"

# ── Start LLM server (vLLM with Qwen3-8B-AWQ, uses less VRAM) ──
nohup vllm serve Qwen/Qwen3-8B-AWQ \
  --host 0.0.0.0 \
  --port 8002 \
  --gpu-memory-utilization 0.25 \
  --max-model-len 2048 \
  --api-key cbse-sk-local \
  --dtype auto \
  --quantization awq \
  > /workspace/llm_server.log 2>&1 &
echo "LLM (vLLM AWQ) PID=$!"

echo "Waiting for LLM server..."
for i in $(seq 1 60); do
  curl -s http://localhost:8002/health > /dev/null 2>&1 && break
  sleep 5
done
echo "LLM ready"

# ── Start FastAPI (STT loads in-process, TTS/LLM via HTTP) ──
cd /workspace/cbse-chatbot/backend
nohup python3 -u -m uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info \
  > /workspace/fastapi_server.log 2>&1 &
echo "FastAPI PID=$!"
echo "All services started!"
