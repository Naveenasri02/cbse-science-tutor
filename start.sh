#!/bin/bash
set -e

MODEL_PATH=${MODEL_PATH:-"/models/cbse-science-slm-v2-Q4_K_M.gguf"}
VLLM_PORT=${VLLM_PORT:-8001}
SERVER_PORT=${SERVER_PORT:-8000}

echo "🚀 Starting CBSE Chatbot Server..."

# Start vLLM in background
echo "  [1/2] Starting vLLM on port $VLLM_PORT..."
python -m vllm.entrypoints.openai.api_server \
    --model "$MODEL_PATH" \
    --host 0.0.0.0 \
    --port "$VLLM_PORT" \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.4 \
    --dtype auto \
    --api-key "cbse-sk-local" \
    &

VLLM_PID=$!

# Wait for vLLM to be ready
echo "  Waiting for vLLM..."
for i in $(seq 1 60); do
    if curl -sf "http://localhost:$VLLM_PORT/health" > /dev/null 2>&1; then
        echo "  ✓ vLLM ready"
        break
    fi
    sleep 2
done

# Start FastAPI backend
echo "  [2/2] Starting FastAPI backend on port $SERVER_PORT..."
export VLLM_BASE_URL="http://localhost:$VLLM_PORT/v1"
export VLLM_MODEL=$(basename "$MODEL_PATH" .gguf)
export VLLM_API_KEY="cbse-sk-local"

python server.py &
BACKEND_PID=$!

echo "🎉 All services running!"
echo "  vLLM: http://localhost:$VLLM_PORT (PID: $VLLM_PID)"
echo "  Backend: http://localhost:$SERVER_PORT (PID: $BACKEND_PID)"

# Keep container alive
wait
