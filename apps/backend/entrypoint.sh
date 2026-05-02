#!/bin/bash
# Unified entrypoint: starts vLLM in background, then runs handler.py as the
# RunPod serverless entry point. handler.py talks to localhost:8002 for LLM.
set -u

LLM_PORT="${LLM_PORT:-8002}"
MODEL_NAME="${MODEL_NAME:-nvidia/Gemma-4-31B-IT-NVFP4}"
SERVED_NAME="${SERVED_MODEL_NAME:-${MODEL_NAME}}"
MAX_LEN="${MAX_MODEL_LEN:-16384}"
QUANT="${QUANTIZATION:-compressed-tensors}"
GPU_UTIL="${GPU_MEMORY_UTILIZATION:-0.85}"

echo "[entry] starting vLLM on port ${LLM_PORT} with model ${MODEL_NAME}"
nohup vllm serve "${MODEL_NAME}" \
  --host 0.0.0.0 \
  --port "${LLM_PORT}" \
  --max-model-len "${MAX_LEN}" \
  --quantization "${QUANT}" \
  --gpu-memory-utilization "${GPU_UTIL}" \
  --served-model-name "${SERVED_NAME}" \
  --trust-remote-code \
  > /tmp/vllm.log 2>&1 &
VLLM_PID=$!
echo "[entry] vllm PID=${VLLM_PID}"

echo "[entry] waiting for vllm /health (max 600s)..."
for i in $(seq 1 300); do
  if curl -s "http://localhost:${LLM_PORT}/health" > /dev/null 2>&1; then
    echo "[entry] vllm ready after ${i}*2 = $((i*2))s"
    break
  fi
  if ! kill -0 "${VLLM_PID}" 2>/dev/null; then
    echo "[entry] FATAL: vllm exited during startup — last log lines:"
    tail -50 /tmp/vllm.log
    exit 1
  fi
  sleep 2
done

if ! curl -s "http://localhost:${LLM_PORT}/health" > /dev/null 2>&1; then
  echo "[entry] FATAL: vllm did not become healthy within 600s — last log lines:"
  tail -50 /tmp/vllm.log
  exit 1
fi

# Point handler.py at the local vLLM
export VLLM_BASE_URL="http://localhost:${LLM_PORT}/v1"
# Use the served name (NOT the long snapshot path) for chat completions
export VLLM_MODEL="${SERVED_NAME}"
export VLLM_API_KEY="${VLLM_API_KEY:-local}"

echo "[entry] handing off to handler.py (VLLM_BASE_URL=${VLLM_BASE_URL})"
exec python -u /app/handler.py
