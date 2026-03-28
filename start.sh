#!/bin/bash
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
export ONNX_PROVIDER=CUDAExecutionProvider

# Install ffmpeg if not present
which ffmpeg > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }

# Start LLM server
cd /workspace
nohup python3 -m llama_cpp.server --model /workspace/model.gguf --host 0.0.0.0 --port 8002 --n_gpu_layers -1 --n_ctx 4096 --chat_format chatml > /workspace/llm_server.log 2>&1 &
echo "LLM PID=$!"

# Wait for LLM
for i in $(seq 1 30); do curl -s http://localhost:8002/health > /dev/null 2>&1 && break; sleep 2; done
echo "LLM ready"

# Start FastAPI
cd /workspace/app
nohup python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 --log-level info > /workspace/fastapi_server.log 2>&1 &
echo "FastAPI PID=$!"
echo "Started!"
