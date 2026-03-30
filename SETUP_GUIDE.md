# CBSE Science Tutor — Complete Setup & Deployment Guide

## Table of Contents
1. [Project Structure](#1-project-structure)
2. [Prerequisites](#2-prerequisites)
3. [Backend Setup (RunPod GPU Server)](#3-backend-setup-runpod-gpu-server)
4. [Frontend Setup (Local + Vercel)](#4-frontend-setup-local--vercel)
5. [Environment Variables](#5-environment-variables)
6. [Server Startup Commands](#6-server-startup-commands)
7. [Vercel Deployment](#7-vercel-deployment)
8. [Architecture Overview](#8-architecture-overview)
9. [Troubleshooting](#9-troubleshooting)
10. [All Source Files Reference](#10-all-source-files-reference)

---

## 1. Project Structure

```
cbse-chatbot/
├── backend/
│   ├── server.py            # Main FastAPI WebSocket server (STT → LLM → TTS pipeline)
│   ├── config.py            # All configuration, prompts, CBSE keywords
│   ├── requirements.txt     # Python dependencies
│   ├── stt/
│   │   ├── __init__.py
│   │   └── whisper_stt.py   # Whisper STT wrapper (faster-whisper, GPU)
│   └── tts/
│       ├── __init__.py
│       └── kokoro_tts.py    # Kokoro TTS wrapper (ONNX, GPU)
├── frontend/
│   ├── index.html           # HTML entry point (PWA meta tags)
│   ├── package.json         # Node dependencies
│   ├── vite.config.js       # Vite config with dev proxy
│   ├── .env                 # Local dev env (VITE_WS_URL)
│   ├── .env.production      # Production env (RunPod WS URL)
│   ├── public/
│   │   ├── favicon.svg
│   │   ├── icons.svg
│   │   ├── manifest.json    # PWA manifest
│   │   └── sw.js            # Service worker
│   └── src/
│       ├── main.jsx         # React entry point + SW registration
│       ├── index.css        # Global styles (Tailwind, markdown, animations)
│       ├── App.jsx          # Main app: WS, voice, audio player orchestration
│       ├── components/
│       │   ├── ChatArea.jsx     # Chat messages + welcome screen + suggestions
│       │   ├── Message.jsx      # Single message: markdown + KaTeX rendering
│       │   ├── InputBar.jsx     # Text input + mic + send buttons
│       │   ├── Sidebar.jsx      # Chat history sidebar
│       │   └── VoiceStatus.jsx  # Voice status pill indicator
│       └── hooks/
│           ├── useWebSocket.js  # WebSocket connection + auto-reconnect
│           ├── useVoice.js      # AudioWorklet PCM capture + VAD
│           └── useAudioPlayer.js # Gapless audio playback queue
├── start.sh                 # RunPod startup script (both servers)
└── MVP_BRIEF.md             # Client-facing brief document
```

---

## 2. Prerequisites

### Local Machine (for frontend development)
- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- **Git**
- **Vercel CLI**: `npm i -g vercel`

### GPU Server (RunPod or any NVIDIA GPU machine)
- **NVIDIA GPU** with ≥ 16GB VRAM (L40S 48GB recommended)
- **CUDA** 12.x installed
- **Python** 3.11+
- **ffmpeg** (for webm fallback audio decoding)
- **Storage**: ≥ 30GB for models and packages

### Models Required
| Model | Size | Path on Server |
|-------|------|----------------|
| Custom Qwen3-8B Q4_K_M GGUF | ~5GB | `/workspace/model.gguf` |
| Kokoro TTS v1.0 ONNX | ~80MB | `/workspace/app/voices/kokoro-v1.0.onnx` |
| Kokoro Voices v1.0 | ~15MB | `/workspace/app/voices/voices-v1.0.bin` |
| Whisper Small | ~500MB | Auto-downloaded by faster-whisper to HF cache |

---

## 3. Backend Setup (RunPod GPU Server)

### Step 1: Create RunPod Pod
1. Go to [runpod.io](https://runpod.io)
2. Deploy a GPU pod:
   - **GPU**: L40S (48GB) or A100 (80GB)
   - **Template**: RunPod PyTorch 2.x
   - **Disk**: 30GB+ workspace volume
   - **Ports**: Expose **8000** (FastAPI) and **8002** (LLM)
3. Note your Pod ID (e.g., `9c8il089dx1vq9`)
4. SSH in or use web terminal

### Step 2: Install Python Packages

```bash
# CRITICAL: Install to /workspace to avoid filling root disk (only 5GB)
pip install --target=/workspace/pylibs \
  fastapi==0.135.2 \
  uvicorn[standard]==0.42.0 \
  websockets \
  python-dotenv \
  openai>=2.30 \
  httpx>=0.27 \
  faster-whisper>=1.2 \
  soundfile>=0.13 \
  kokoro-onnx>=0.5 \
  numpy>=2.0 \
  onnxruntime-gpu>=1.24 \
  llama-cpp-python>=0.3.19

# Install ffmpeg
apt-get update -qq && apt-get install -y -qq ffmpeg

# Symlink HuggingFace cache to workspace (avoids filling root)
mkdir -p /workspace/.cache/huggingface
ln -sf /workspace/.cache/huggingface /root/.cache/huggingface
```

### Step 3: Upload Backend Code

Upload the entire `backend/` folder to `/workspace/app/` on RunPod:

```bash
# From local machine (Windows):
scp -i ~/.runpod/ssh/RunPod-Key-Go -P <SSH_PORT> -r backend/* root@<POD_IP>:/workspace/app/

# Directory structure on RunPod should be:
# /workspace/app/
#   ├── server.py
#   ├── config.py
#   ├── stt/
#   │   ├── __init__.py
#   │   └── whisper_stt.py
#   ├── tts/
#   │   ├── __init__.py
#   │   └── kokoro_tts.py
#   └── voices/
#       ├── kokoro-v1.0.onnx
#       └── voices-v1.0.bin
```

### Step 4: Upload the GGUF Model

```bash
# Place your custom model at:
/workspace/model.gguf
```

### Step 5: Upload TTS Voice Files

Download Kokoro ONNX model and voices:
```bash
cd /workspace/app/voices/
# Download from Kokoro ONNX release or your backup
# kokoro-v1.0.onnx and voices-v1.0.bin should be here
```

### Step 6: Upload start.sh

```bash
scp -i ~/.runpod/ssh/RunPod-Key-Go -P <SSH_PORT> start.sh root@<POD_IP>:/workspace/start.sh
chmod +x /workspace/start.sh
```

---

## 4. Frontend Setup (Local + Vercel)

### Step 1: Install Dependencies

```bash
cd frontend
npm install
```

### Step 2: Configure Environment

Create `.env` for local development:
```
VITE_WS_URL=ws://localhost:8000/ws/voice
```

Create `.env.production` for production:
```
VITE_WS_URL=wss://<YOUR_RUNPOD_POD_ID>-8000.proxy.runpod.net/ws/voice
```

### Step 3: Run Locally

```bash
npm run dev
# Opens at http://localhost:5173
```

### Step 4: Build for Production

```bash
npm run build
# Output in frontend/dist/
```

### Frontend Dependencies (package.json)

```json
{
  "dependencies": {
    "@ricky0123/vad-web": "^0.0.30",
    "@tailwindcss/vite": "^4.2.2",
    "katex": "^0.16.44",
    "marked": "^17.0.5",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-icons": "^5.6.0",
    "tailwindcss": "^4.2.2"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.4",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^9.39.4",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.4.0",
    "vite": "^8.0.1",
    "vite-plugin-static-copy": "^4.0.0"
  }
}
```

---

## 5. Environment Variables

### Backend (RunPod — set via export or .env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHONPATH` | `/workspace/pylibs` | Custom pip install path |
| `LD_LIBRARY_PATH` | `/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:/usr/local/cuda/lib64` | cuDNN + CUDA libs |
| `ONNX_PROVIDER` | `CUDAExecutionProvider` | GPU for TTS ONNX |
| `HF_HOME` | `/workspace/.cache/huggingface` | HuggingFace cache dir |
| `VLLM_BASE_URL` | `http://localhost:8002/v1` | LLM server URL |
| `VLLM_MODEL` | `cbse-science-v2` | Model name for health check |
| `VLLM_API_KEY` | `cbse-sk-local` | API key (local, any value) |
| `STT_MODEL_SIZE` | `small` | Whisper model: tiny/base/small/medium |
| `STT_DEVICE` | `cuda` | STT device: cuda/cpu |
| `STT_COMPUTE_TYPE` | `float16` | STT precision |
| `TTS_VOICE` | `af_heart` | Kokoro voice ID |
| `TTS_SPEED` | `1.1` | TTS playback speed |
| `SERVER_PORT` | `8000` | FastAPI port |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |

### Frontend (Vercel / .env)

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_WS_URL` | `wss://<pod-id>-8000.proxy.runpod.net/ws/voice` | Backend WebSocket URL |

---

## 6. Server Startup Commands

### ⚠️ CRITICAL: Model Loading Order
**TTS (ONNX Runtime) MUST load BEFORE STT (CTranslate2/faster-whisper)**
Otherwise you get: `libcudnn_graph.so.9: undefined symbol: cudnnGetLibConfig`
The `server.py` already handles this (loads TTS first, then STT).

### Start LLM Server (llama-cpp-python)

```bash
export PYTHONPATH=/workspace/pylibs
export PATH=/usr/local/cuda/bin:$PATH

nohup python3 -m llama_cpp.server \
  --model /workspace/model.gguf \
  --host 0.0.0.0 \
  --port 8002 \
  --n_gpu_layers -1 \
  --n_ctx 4096 \
  --n_batch 1024 \
  --flash_attn true \
  --chat_format chatml \
  --n_threads 4 \
  > /workspace/llm_server.log 2>&1 &

# Wait for ready
for i in $(seq 1 30); do
  curl -s http://localhost:8002/health > /dev/null 2>&1 && break
  sleep 2
done
echo "LLM ready"
```

**LLM Server Flags Explained:**
| Flag | Value | Purpose |
|------|-------|---------|
| `--n_gpu_layers -1` | All layers | Offload entire model to GPU |
| `--n_ctx 4096` | 4096 tokens | Context window for conversations |
| `--n_batch 1024` | 1024 tokens | Batch size for prompt processing |
| `--flash_attn true` | Enabled | Flash Attention for faster inference |
| `--chat_format chatml` | ChatML | Token format matching Qwen3 |
| `--n_threads 4` | 4 CPU threads | For any CPU-side operations |

### Start FastAPI Server

```bash
cd /workspace/app
export PYTHONPATH=/workspace/pylibs
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:/usr/local/cuda/lib64
export ONNX_PROVIDER=CUDAExecutionProvider
export HF_HOME=/workspace/.cache/huggingface

nohup python3 -u -m uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info \
  > /tmp/fastapi.log 2>&1 &
```

### Using start.sh (Both Servers)

```bash
cd /workspace
chmod +x start.sh
bash start.sh
```

### Verify Both Servers

```bash
# LLM server
curl http://localhost:8002/v1/models
# Should return: {"object":"list","data":[{"id":"/workspace/model.gguf",...}]}

# FastAPI server
curl http://localhost:8000/health
# Should return: {"status":"ok","model":"cbse-science-v2"}
```

---

## 7. Vercel Deployment

### First-Time Setup

```bash
cd frontend
vercel login
vercel link          # Link to your Vercel project
```

### Deploy to Production

```bash
cd frontend
vercel --prod --yes
```

### Set Environment Variable on Vercel

```bash
# In Vercel dashboard → Project → Settings → Environment Variables
# Add: VITE_WS_URL = wss://<pod-id>-8000.proxy.runpod.net/ws/voice
```

### Important Notes
- Auto-deploy from GitHub may NOT work if the Vercel project is linked to a subdirectory
- Use `vercel --prod --yes` from the `frontend/` directory for reliable deployments
- The WebSocket URL format for RunPod is: `wss://<POD_ID>-8000.proxy.runpod.net/ws/voice`

---

## 8. Architecture Overview

```
┌────────────────────┐        WebSocket (wss://)       ┌────────────────────────┐
│                    │ ◄──────────────────────────────► │                        │
│   FRONTEND         │                                  │   BACKEND (RunPod)     │
│   React 19 + Vite  │                                  │   FastAPI + GPU        │
│   Vercel CDN       │                                  │                        │
│                    │                                  │   ┌──────────────────┐ │
│  ┌──────────────┐  │   Binary audio (PCM/webm)       │   │ STT              │ │
│  │ AudioWorklet │──┼──────────────────────────────►  │   │ Whisper small    │ │
│  │ PCM Capture  │  │                                  │   │ CUDA FP16        │ │
│  └──────────────┘  │                                  │   │ ~21ms            │ │
│                    │                                  │   └────────┬─────────┘ │
│  ┌──────────────┐  │                                  │            │            │
│  │ VAD Engine   │  │                                  │   ┌────────▼─────────┐ │
│  │ Freq-band    │  │   JSON: {llm_delta, text}       │   │ LLM              │ │
│  │ 300-3400 Hz  │  │ ◄────────────────────────────── │   │ Qwen3-8B Q4_K_M  │ │
│  └──────────────┘  │                                  │   │ llama.cpp GPU    │ │
│                    │                                  │   │ ~310ms (35 tok)  │ │
│  ┌──────────────┐  │                                  │   └────────┬─────────┘ │
│  │ Audio Player │  │   Binary: WAV audio chunks      │            │            │
│  │ Gapless      │  │ ◄────────────────────────────── │   ┌────────▼─────────┐ │
│  │ Scheduled    │  │                                  │   │ TTS              │ │
│  └──────────────┘  │                                  │   │ Kokoro ONNX      │ │
│                    │                                  │   │ CUDA             │ │
│  ┌──────────────┐  │                                  │   │ ~80-190ms        │ │
│  │ Markdown     │  │                                  │   └──────────────────┘ │
│  │ + KaTeX      │  │                                  │                        │
│  └──────────────┘  │                                  │   Total: ~500-600ms    │
└────────────────────┘                                  └────────────────────────┘
```

### Pipeline Flow

**Voice Chat:**
1. User speaks → AudioWorklet captures raw PCM at 48kHz
2. VAD detects speech (energy + frequency-band analysis)
3. On silence (900ms) → downsample to 16kHz → send as Float32 binary
4. Server: STT transcribes (21ms) → LLM generates with ChatML pre-fill (310ms) → TTS streams chunks
5. Client: gapless audio playback, barge-in stops audio on first speech frame (<16ms)

**Text Chat:**
1. User types message → sends JSON `{type: "text_chat", text: "..."}`
2. Server: LLM generates with streaming → sends `llm_delta` JSON chunks
3. Client: throttled markdown + KaTeX rendering (80ms intervals)

### Key Optimizations
| Optimization | Benefit |
|-------------|---------|
| ChatML think pre-fill | Eliminates 50ms think token waste |
| Raw `/v1/completions` | Allows prompt pre-fill (chat endpoint doesn't) |
| `cache_prompt: true` | Skips re-encoding repeated context |
| AudioWorklet PCM | Saves 116ms (no webm encode + ffmpeg decode) |
| Frequency-band VAD | Only detects human voice, ignores ambient noise |
| Throttled markdown | UI stays smooth during streaming |
| Gapless audio scheduling | No gaps between TTS chunks |
| Ref-based barge-in | <16ms interrupt (avoids React state staleness) |
| Smart prompt truncation | Supports 20+ exchanges without overflow |

---

## 9. Troubleshooting

### Common Issues

**1. cuDNN conflict crash**
```
libcudnn_graph.so.9: undefined symbol: cudnnGetLibConfig
```
**Fix:** Ensure TTS loads BEFORE STT in server.py. The `LD_LIBRARY_PATH` must include cuDNN lib path.

**2. LLM returns empty after 5-6 messages**
```
ValueError: Requested tokens exceed context window
```
**Fix:** Increase `--n_ctx` to 4096. The `_build_chatml_prompt()` function trims history automatically.

**3. Root disk full on RunPod**
Root overlay is only 5GB. Always install to `/workspace/pylibs`:
```bash
pip install --target=/workspace/pylibs <package>
```

**4. Vercel deploy not updating**
Auto-deploy may not work for subdirectory projects. Deploy manually:
```bash
cd frontend && vercel --prod --yes
```

**5. WebSocket connection fails**
- Check RunPod pod is running
- Verify port 8000 is exposed
- URL format: `wss://<POD_ID>-8000.proxy.runpod.net/ws/voice`
- SSH port changes on every pod restart

**6. Voice doesn't detect speech**
- Check browser permissions for microphone
- Test in Chrome/Edge (AudioWorklet required)
- Ensure no other app is using the microphone

### Log Files (RunPod)
```bash
# FastAPI logs
tail -f /tmp/fastapi.log

# LLM server logs
tail -f /workspace/llm_server.log
```

### Health Checks
```bash
curl http://localhost:8000/health    # FastAPI
curl http://localhost:8002/v1/models # LLM
```

---

## 10. All Source Files Reference

### Backend Python Packages (requirements.txt)

```
fastapi==0.135.*
uvicorn[standard]==0.42.*
websockets>=13.0
python-dotenv>=1.0
openai>=2.30
httpx>=0.27
faster-whisper>=1.2
soundfile>=0.13
kokoro-onnx>=0.5
numpy>=2.0
onnxruntime-gpu>=1.24
llama-cpp-python>=0.3.19
```

### RunPod SSH Access

```powershell
# SSH (port changes on restart — check RunPod dashboard)
ssh -i ~/.runpod/ssh/RunPod-Key-Go -p <PORT> root@<POD_IP>

# SCP upload
scp -i ~/.runpod/ssh/RunPod-Key-Go -P <PORT> <local_file> root@<POD_IP>:/workspace/app/
```

### RunPod API (check pod status)

```bash
curl -s "https://api.runpod.io/graphql?api_key=<YOUR_API_KEY>" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ myself { pods { id name runtime { uptimeInSeconds gpus { id } } } } }"}'
```

---

## Quick Start Checklist (New Server)

- [ ] 1. Create RunPod pod (L40S or A100, 30GB workspace)
- [ ] 2. SSH into pod
- [ ] 3. Install Python packages to `/workspace/pylibs`
- [ ] 4. Upload `backend/` → `/workspace/app/`
- [ ] 5. Upload GGUF model → `/workspace/model.gguf`
- [ ] 6. Upload TTS voices → `/workspace/app/voices/`
- [ ] 7. Upload `start.sh` → `/workspace/start.sh`
- [ ] 8. Run `bash /workspace/start.sh`
- [ ] 9. Verify: `curl localhost:8000/health` and `curl localhost:8002/v1/models`
- [ ] 10. Update `frontend/.env.production` with new RunPod WS URL
- [ ] 11. `cd frontend && npm run build && vercel --prod --yes`
- [ ] 12. Test text chat + voice chat on live URL

---

*Last updated: 2026-03-30*
