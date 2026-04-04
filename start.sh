#!/bin/bash
set -e

# Environment for GPU inference
export HF_HOME=/workspace/.cache/huggingface
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cuda_runtime/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cufft/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cusolver/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cusparse/lib:/usr/local/lib/python3.11/dist-packages/nvidia/nccl/lib:/usr/local/lib/python3.11/dist-packages/nvidia/nvjitlink/lib:${LD_LIBRARY_PATH:-}

# Symlink cuDNN/cuBLAS so ONNX Runtime finds them (Kokoro TTS GPU)
ln -sf /usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib/libcudnn*.so* /usr/local/lib/ 2>/dev/null
ln -sf /usr/local/lib/python3.11/dist-packages/nvidia/cublas/lib/libcublas*.so* /usr/local/lib/ 2>/dev/null
ldconfig 2>/dev/null

# Ensure HuggingFace cache is on workspace
mkdir -p /workspace/.cache/huggingface
ln -sf /workspace/.cache/huggingface /root/.cache/huggingface 2>/dev/null || true

# Ensure RAG directories exist
mkdir -p /workspace/vector_db
mkdir -p /workspace/uploads

# Install ffmpeg if not present
which ffmpeg > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }

# ── Download Kokoro TTS model if not present ──
if [ ! -f /workspace/kokoro-v1.0.onnx ]; then
  echo "Downloading Kokoro TTS model..."
  wget -q -O /workspace/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  wget -q -O /workspace/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  echo "Kokoro model downloaded"
fi

# ── Start LLM server (vLLM with Qwen3-30B-A3B MoE AWQ) ──
nohup vllm serve invergent/Qwen3-30B-A3B-AWQ \
  --host 0.0.0.0 \
  --port 8002 \
  --gpu-memory-utilization 0.55 \
  --max-model-len 16384 \
  --api-key cbse-sk-local \
  --dtype auto \
  --quantization awq_marlin \
  > /workspace/llm_server.log 2>&1 &
echo "LLM (vLLM Qwen3-30B-A3B MoE AWQ) PID=$!"

echo "Waiting for LLM server..."
for i in $(seq 1 60); do
  curl -s http://localhost:8002/health > /dev/null 2>&1 && break
  sleep 5
done
echo "LLM ready"

# ── Start FastAPI (STT + Kokoro TTS load in-process on GPU) ──
cd /workspace/cbse-chatbot/backend
nohup python3 -u -m uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info \
  > /workspace/fastapi_server.log 2>&1 &
echo "FastAPI PID=$!"
echo "All services started! (LLM on :8002, FastAPI+STT+TTS on :8000)"
