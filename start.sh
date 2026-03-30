#!/bin/bash
set -e

# Environment for GPU inference (TTS needs cuDNN, STT needs CUDA)
export PYTHONPATH=/workspace/pylibs
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:/usr/local/cuda/lib64
export ONNX_PROVIDER=CUDAExecutionProvider
export HF_HOME=/workspace/.cache/huggingface
export PATH=/usr/local/cuda/bin:$PATH

# Ensure HuggingFace cache is on workspace (root disk is only 5GB)
ln -sf /workspace/.cache/huggingface /root/.cache/huggingface 2>/dev/null || true

# Install ffmpeg if not present
which ffmpeg > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }

# Start LLM server (llama-cpp-python with full GPU offload + flash attention)
cd /workspace
nohup python3 -m llama_cpp.server \
  --model /workspace/model.gguf \
  --host 0.0.0.0 \
  --port 8002 \
  --n_gpu_layers -1 \
  --n_ctx 2048 \
  --n_batch 512 \
  --flash_attn true \
  --chat_format chatml \
  --n_threads 4 \
  > /workspace/llm_server.log 2>&1 &
echo "LLM PID=$!"

# Wait for LLM server to be ready
for i in $(seq 1 30); do
  curl -s http://localhost:8002/health > /dev/null 2>&1 && break
  sleep 2
done
echo "LLM ready"

# Start FastAPI (loads TTS first, then STT to avoid cuDNN conflict)
cd /workspace/app
nohup python3 -u -m uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info \
  > /workspace/fastapi_server.log 2>&1 &
echo "FastAPI PID=$!"
echo "All services started!"
