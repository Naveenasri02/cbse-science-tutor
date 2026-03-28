# CBSE Class 10 Science Voice Chatbot — Complete Deployment Guide

> **Last Updated:** March 2026
> **Repo:** https://github.com/Naveenasri02/cbse-science-tutor
> **Live URL:** https://frontend-murex-six-x762l521bi.vercel.app
> **Backend:** RunPod GPU Pod (L40S) — Pod ID `9c8il089dx1vq9`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Models & Sizes](#4-models--sizes)
5. [RunPod GPU Server Setup](#5-runpod-gpu-server-setup)
6. [Frontend Deployment (Vercel)](#6-frontend-deployment-vercel)
7. [Voice Chat Pipeline (How It Works)](#7-voice-chat-pipeline-how-it-works)
8. [WebSocket Protocol](#8-websocket-protocol)
9. [Performance Benchmarks](#9-performance-benchmarks)
10. [Critical Fixes & Lessons Learned](#10-critical-fixes--lessons-learned)
11. [Configuration Reference](#11-configuration-reference)
12. [Rebuilding From Scratch](#12-rebuilding-from-scratch)
13. [Troubleshooting](#13-troubleshooting)
14. [Credentials & Access](#14-credentials--access)

---

## 1. Architecture Overview

```
┌──────────────────┐         WebSocket (wss://)        ┌──────────────────────────┐
│                  │ ◄──────────────────────────────── │                          │
│  React PWA       │    JSON: control messages          │  RunPod GPU Pod (L40S)   │
│  (Vercel)        │    Binary: audio (webm/wav)        │                          │
│                  │ ────────────────────────────────► │  ┌────────────────────┐  │
│  - Voice Record  │                                    │  │ FastAPI :8000      │  │
│  - Silence Det.  │                                    │  │ ├─ STT (Whisper)   │  │
│  - Audio Player  │                                    │  │ ├─ TTS (Kokoro)    │  │
│  - Chat UI       │                                    │  │ └─ LLM Client      │  │
│  - Markdown+Math │                                    │  └────────┬───────────┘  │
└──────────────────┘                                    │           │ HTTP :8002    │
                                                        │  ┌────────▼───────────┐  │
                                                        │  │ llama-cpp-python   │  │
                                                        │  │ Qwen3-8B Q4_K_M   │  │
                                                        │  │ (36 layers on GPU) │  │
                                                        │  └────────────────────┘  │
                                                        └──────────────────────────┘
```

**One Pod, Three Services:**
- **Port 8002** — llama-cpp-python (LLM inference server)
- **Port 8000** — FastAPI (WebSocket server: STT + TTS + LLM orchestration)
- **Vercel** — React PWA frontend (static hosting)

---

## 2. Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Frontend** | React 19 + Vite 8 + TailwindCSS 4 | PWA with service worker |
| **Voice Input** | MediaRecorder + AnalyserNode | Native browser APIs, no library |
| **Voice Output** | Web Audio API | Playback queue with AudioBufferSourceNode |
| **STT** | faster-whisper `small` | GPU (CUDA), float16, VAD filter |
| **LLM** | Qwen3-8B Q4_K_M GGUF | Custom fine-tuned for CBSE Science |
| **LLM Server** | llama-cpp-python | ChatML format, 4096 context, all layers GPU |
| **TTS** | Kokoro ONNX v1.0 | GPU via onnxruntime-gpu + cuDNN 9 |
| **Backend** | FastAPI + uvicorn | WebSocket streaming, async pipeline |
| **Frontend Host** | Vercel | Static PWA deployment |
| **GPU Host** | RunPod | L40S (48GB VRAM), Ubuntu 22.04, CUDA 12.4 |
| **Audio Decode** | ffmpeg 4.4.2 | Server-side webm → WAV conversion |

---

## 3. Project Structure

```
cbse-chatbot/
├── Dockerfile                      # Container build (CUDA 12.4 base)
├── start.sh                        # RunPod startup script
├── .gitignore
│
├── backend/
│   ├── config.py                   # All config: prompts, ports, keywords
│   ├── requirements.txt            # Python deps
│   ├── server.py                   # FastAPI WebSocket server (main)
│   ├── stt/
│   │   ├── __init__.py
│   │   └── whisper_stt.py          # faster-whisper GPU STT
│   └── tts/
│       ├── __init__.py
│       └── kokoro_tts.py           # Kokoro ONNX TTS
│
├── frontend/
│   ├── package.json                # React deps
│   ├── vite.config.js              # Vite build config with dev proxy
│   ├── index.html                  # HTML entry
│   ├── .env.production             # Prod WebSocket URL
│   ├── public/
│   │   ├── manifest.json           # PWA manifest
│   │   ├── sw.js                   # Service worker
│   │   └── favicon.svg
│   └── src/
│       ├── App.jsx                 # Main orchestrator
│       ├── main.jsx                # Entry + PWA registration
│       ├── index.css               # Tailwind + dark theme styles
│       ├── components/
│       │   ├── ChatArea.jsx        # Message list display
│       │   ├── InputBar.jsx        # Text + voice input bar
│       │   ├── Message.jsx         # Markdown + KaTeX rendering
│       │   ├── Sidebar.jsx         # Chat history sidebar
│       │   └── VoiceStatus.jsx     # Voice state indicator
│       └── hooks/
│           ├── useWebSocket.js     # WS connect + auto-reconnect
│           ├── useVoice.js         # Mic recording + silence detection
│           └── useAudioPlayer.js   # TTS audio playback queue
```

---

## 4. Models & Sizes

| Model | Size | Location on RunPod | Purpose |
|-------|------|--------------------|---------|
| Qwen3-8B Q4_K_M GGUF | 4.7 GB | `/workspace/model.gguf` | LLM (fine-tuned CBSE Science) |
| Whisper `small` | ~500 MB | Auto-downloaded (HuggingFace cache) | Speech-to-Text |
| Kokoro v1.0 ONNX | ~300 MB | `/workspace/app/voices/kokoro-v1.0.onnx` | Text-to-Speech |
| Kokoro Voices | ~30 MB | `/workspace/app/voices/voices-v1.0.bin` | TTS voice profiles |

**Total GPU VRAM usage:** ~8 GB (LLM: 6.7GB, Whisper: ~0.5GB, Kokoro: ~0.5GB)

---

## 5. RunPod GPU Server Setup

### 5.1 Create Pod

1. Go to https://runpod.io → **GPU Pods** → **Deploy**
2. Select **L40S** (48GB) or **A40** (48GB) — minimum 24GB VRAM recommended
3. Template: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
4. Expose ports: **8000, 8002** (HTTP)
5. Volume: 50GB at `/workspace`

### 5.2 SSH Setup

```bash
# Generate SSH key (one-time)
ssh-keygen -t rsa -b 4096 -f ~/.runpod/ssh/RunPod-Key-Go

# Add public key to RunPod dashboard → Settings → SSH Keys

# Connect
ssh -i ~/.runpod/ssh/RunPod-Key-Go -p <PORT> root@<IP>
```

### 5.3 Install Dependencies

```bash
# System packages
apt-get update -qq && apt-get install -y -qq ffmpeg

# Python packages
pip install fastapi uvicorn[standard] websockets python-dotenv openai \
    faster-whisper soundfile kokoro-onnx numpy

# GPU-specific: llama-cpp-python with CUDA
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python[server] --no-cache-dir

# GPU TTS: onnxruntime-gpu (replaces onnxruntime)
pip uninstall -y onnxruntime
pip install onnxruntime-gpu
```

### 5.4 Upload Model & Code

```bash
# From local machine — upload model (use runpodctl for large files)
# Install: https://github.com/runpod/runpodctl
runpodctl send /path/to/model.gguf     # On source machine
runpodctl receive <code>                # On RunPod pod

# Upload backend code via SCP
scp -i ~/.runpod/ssh/RunPod-Key-Go -P <PORT> -r backend/* root@<IP>:/workspace/app/

# Download TTS models on pod
cd /workspace/app/voices
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

### 5.5 Critical Environment Variables

```bash
# Add to ~/.bashrc for persistence:
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
export ONNX_PROVIDER=CUDAExecutionProvider
```

**⚠️ WITHOUT these, TTS runs on CPU (8-15s) instead of GPU (0.19s)!**

The cuDNN 9 libraries are installed by `onnxruntime-gpu` at:
`/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib/`
but they're NOT in `LD_LIBRARY_PATH` by default.

### 5.6 Start Services

```bash
# Upload start.sh to /workspace/start.sh, then:
chmod +x /workspace/start.sh
bash /workspace/start.sh

# Or manually:

# Terminal 1: LLM Server
cd /workspace
python3 -m llama_cpp.server \
    --model /workspace/model.gguf \
    --host 0.0.0.0 --port 8002 \
    --n_gpu_layers -1 \
    --n_ctx 4096 \
    --chat_format chatml

# Terminal 2: FastAPI Server
cd /workspace/app
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
export ONNX_PROVIDER=CUDAExecutionProvider
python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 --log-level info
```

### 5.7 Verify

```bash
# LLM health
curl http://localhost:8002/health
# → {"status":"ok"}

# FastAPI health
curl http://localhost:8000/health
# → {"status":"ok","model":"cbse-science-v2"}

# Check GPU layers loaded
grep "offloaded" /workspace/llm_server.log
# → "llm_load_tensors: offloaded 36/36 layers to GPU"
```

### 5.8 RunPod Proxy URLs

RunPod auto-creates HTTPS proxy URLs:
- FastAPI: `https://<POD_ID>-8000.proxy.runpod.net`
- LLM: `https://<POD_ID>-8002.proxy.runpod.net`

WebSocket: `wss://<POD_ID>-8000.proxy.runpod.net/ws/voice`

---

## 6. Frontend Deployment (Vercel)

### 6.1 Set Production WebSocket URL

Edit `frontend/.env.production`:
```
VITE_WS_URL=wss://<POD_ID>-8000.proxy.runpod.net/ws/voice
```

### 6.2 Deploy to Vercel

```bash
cd frontend

# First time: link to Vercel project
npx vercel link

# Deploy
npx vercel --prod --yes --force
```

### 6.3 Vercel Project Settings

- **Framework:** Vite
- **Build Command:** `vite build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### 6.4 After Deployment

The aliased URL stays constant across deployments:
`https://frontend-murex-six-x762l521bi.vercel.app`

---

## 7. Voice Chat Pipeline (How It Works)

### Complete Flow (User speaks → Bot replies):

```
BROWSER                          SERVER (RunPod)
───────                          ──────────────
1. Mic open (MediaRecorder)
2. AnalyserNode checks volume
3. Voice detected (avg > 10)
   → onSpeechDetected()
   → If bot speaking: INTERRUPT
     (stop playback + send interrupt JSON)
4. User stops speaking
5. 0.8s silence detected
6. Stop recorder → webm blob
7. Send webm binary via WS ──────► 8. Receive binary
                                   9. Detect webm (0x1A45DFA3 header)
                                  10. ffmpeg: webm → WAV 16kHz mono
                                  11. STT: WAV → text (~0.17s)
                              ◄── 12. Send user_transcript JSON
                                  13. CBSE keyword filter
                                  14. Add to conversation history
                                  15. Stream LLM (max 150 tokens)
                              ◄── 16. Send llm_start
                              ◄── 17. Send llm_delta (each token)
                                  18. At 30+ chars + punctuation:
                                      strip markdown → TTS
                              ◄── 19. Send tts_start
                              ◄── 20. Send binary WAV audio
                                      (continue LLM streaming...)
21. Decode WAV → AudioBuffer
22. Play through speaker
23. Queue additional chunks
                                  24. LLM done
                              ◄── 25. Send llm_done
                              ◄── 26. Send tts_done
27. Back to step 1 (listening)
```

### Barge-in (Interrupt) Flow:

```
Bot is speaking (step 22)
User starts speaking → onSpeechDetected()
  → stopPlayback() (clear audio queue)
  → interruptedRef = true (discard stale audio)
  → send { type: "interrupt" } ──────► cancel_pipeline()
                                        → cancel LLM stream
                                        → send llm_done (interrupted)
                                        → send tts_done
User's new speech continues recording...
0.8s silence → send new audio ──────► Process as new question
  → interruptedRef = false on llm_start
```

---

## 8. WebSocket Protocol

### Server → Client Messages

| Type | Fields | Description |
|------|--------|-------------|
| `user_transcript` | `{ text }` | STT result of user's speech |
| `llm_start` | `{}` | LLM generation beginning |
| `llm_delta` | `{ text }` | Streaming token (may include `<think>` blocks) |
| `llm_done` | `{ interrupted? }` | LLM complete. `interrupted: true` if barged in |
| `tts_start` | `{}` | TTS audio chunk incoming |
| *binary* | WAV bytes | Audio data (after tts_start) |
| `tts_done` | `{}` | All TTS for this response complete |
| `vad_no_speech` | `{}` | Audio received but no speech detected |
| `error` | `{ text }` | Error description |

### Client → Server Messages

| Type | Fields | Description |
|------|--------|-------------|
| `interrupt` | `{}` | Cancel current LLM + TTS pipeline |
| `text_chat` | `{ text }` | Text-mode chat message |
| *binary* | webm or Float32 bytes | Voice audio data |

### Audio Format Detection (Server)

```python
# Server auto-detects format by checking first 4 bytes:
is_webm = audio_bytes[:4] == b'\x1a\x45\xdf\xa3'  # EBML header
# webm → ffmpeg decode to WAV
# otherwise → treat as raw Float32 PCM
```

---

## 9. Performance Benchmarks

**Hardware:** RunPod L40S (48GB VRAM), CUDA 12.4

| Stage | Time | Notes |
|-------|------|-------|
| **STT (Whisper small, GPU)** | 0.02s warm, 0.17s cold | VAD filter enabled |
| **LLM TTFT** | 0.03-0.19s | First token from Qwen3-8B |
| **LLM throughput** | ~108 tok/s | Q4_K_M, 36 layers GPU |
| **LLM total (voice, ~20 tok)** | 0.4-0.6s | max_tokens=150, temp=0.3 |
| **TTS (Kokoro, GPU)** | 0.14-0.19s | Per sentence, CUDA provider |
| **TTS (Kokoro, CPU)** | 8-15s ❌ | Without LD_LIBRARY_PATH fix |
| **ffmpeg webm→WAV** | ~0.05s | Negligible |
| **Silence detection** | 0.8s | After speech ends |
| **Network (WebSocket)** | 0.1-0.3s | Varies by user location |
| **Total to first audio** | **~0.7-1.0s** | Server-side ~0.6s + network |

**VRAM Usage:**
- LLM (Qwen3-8B Q4_K_M): 6.7 GB
- Whisper small: ~0.5 GB
- Kokoro ONNX: ~0.5 GB
- **Total: ~8 GB** (fits easily on 24GB+ GPU)

---

## 10. Critical Fixes & Lessons Learned

### 10.1 TTS GPU — The Biggest Fix

**Problem:** Kokoro ONNX TTS was 8-15s per sentence (CPU).
**Root Cause:** `onnxruntime-gpu` installs cuDNN 9 but doesn't add it to `LD_LIBRARY_PATH`.
**Fix:**
```bash
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
export ONNX_PROVIDER=CUDAExecutionProvider
```
**Result:** 0.14-0.19s per sentence (50-80x speedup).

### 10.2 Qwen3 `<think>` Blocks

**Problem:** Qwen3 outputs `<think>...</think>` reasoning blocks even when told not to.
**Fixes:**
- Server: Track `in_think` flag, skip TTS for think blocks
- Server: Use separate `VOICE_SYSTEM_PROMPT` saying "Do NOT use `<think>` tags"
- Frontend: Strip `<think>` from displayed text with regex

### 10.3 VAD Library Failures on Mobile

**Problem:** `@ricky0123/vad-web` uses AudioWorklet which requires same-origin scripts. CDN fails.
**Fix:** Replaced with native `MediaRecorder` + `AnalyserNode` (FFT volume detection).
No external VAD library needed. Works on all browsers.

### 10.4 False Interrupt Loop

**Problem:** `onSpeechStart` fired at every recording cycle start, not when user actually spoke.
This interrupted the bot immediately after it started speaking.
**Fix:** Changed to `onSpeechDetected` — only fires when AnalyserNode detects actual voice volume (avg > 10).

### 10.5 Stale TTS Audio After Interrupt

**Problem:** After barge-in interrupt, leftover TTS binary data from cancelled pipeline would still play.
**Fix:** `interruptedRef` flag — set on interrupt, blocks binary audio, cleared on next `llm_start`.

### 10.6 Mobile Audio Decode

**Problem:** `AudioContext.decodeAudioData()` for webm→Float32 was slow/unreliable on mobile.
**Fix:** Send webm blob directly; server decodes with ffmpeg (fast, reliable, works everywhere).

### 10.7 RunPod Port Conflicts

**Problem:** Ports 3001, 7270, 7861, 8001, 8081, 9091 occupied by RunPod nginx.
**Fix:** Use port 8000 (FastAPI) and 8002 (LLM). Never use 8001.

### 10.8 RunPod SSH Instability

**Problem:** Long-running SSH commands hang or disconnect.
**Fix:** Use short atomic commands. For large files use `runpodctl send/receive`. 
Use `nohup ... &` for server processes.

---

## 11. Configuration Reference

### backend/config.py

| Variable | Default | Description |
|----------|---------|-------------|
| `VLLM_BASE_URL` | `http://localhost:8002/v1` | LLM server URL |
| `VLLM_MODEL` | `cbse-science-v2` | Model name for API |
| `VLLM_API_KEY` | `cbse-sk-local` | API key |
| `SYSTEM_PROMPT` | (long) | Text chat system prompt |
| `VOICE_SYSTEM_PROMPT` | (short) | Voice chat: 1-3 sentences, no `<think>` |
| `STT_MODEL_SIZE` | `small` | Whisper model size |
| `STT_DEVICE` | `cuda` | STT device |
| `STT_COMPUTE_TYPE` | `float16` | STT precision |
| `TTS_MODEL_PATH` | `voices/kokoro-v1.0.onnx` | Kokoro model path |
| `TTS_VOICES_PATH` | `voices/voices-v1.0.bin` | Kokoro voices path |
| `TTS_VOICE` | `af_heart` | Voice name |
| `TTS_SPEED` | `1.1` | Playback speed |
| `SERVER_PORT` | `8000` | FastAPI port |
| `CORS_ORIGINS` | `*` | Allowed origins |

### Voice Pipeline Tuning

| Parameter | Value | Location | Effect |
|-----------|-------|----------|--------|
| Voice max_tokens | 150 | server.py | Shorter voice responses |
| Voice temperature | 0.3 | server.py | More deterministic |
| Text max_tokens | 2048 | server.py | Full text responses |
| First TTS trigger | 30 chars | server.py | Earlier first audio |
| Silence timeout | 0.8s | useVoice.js | Faster send |
| Speech threshold | avg > 10 | useVoice.js | Voice detection sensitivity |
| Recorder chunk | 200ms | useVoice.js | MediaRecorder interval |
| Auto-reconnect | 2s | useWebSocket.js | WS reconnect delay |

---

## 12. Rebuilding From Scratch

### Step-by-step to deploy this project fresh:

#### A. RunPod Backend

```bash
# 1. Create RunPod pod (L40S or A40, pytorch template, 50GB volume)

# 2. SSH in
ssh -i ~/.runpod/ssh/RunPod-Key-Go -p <PORT> root@<IP>

# 3. Install system deps
apt-get update -qq && apt-get install -y -qq ffmpeg

# 4. Install Python packages
pip install fastapi uvicorn[standard] websockets python-dotenv openai \
    faster-whisper soundfile kokoro-onnx numpy
pip uninstall -y onnxruntime
pip install onnxruntime-gpu
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python[server] --no-cache-dir

# 5. Set environment (add to ~/.bashrc)
echo 'export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH' >> ~/.bashrc
echo 'export ONNX_PROVIDER=CUDAExecutionProvider' >> ~/.bashrc
source ~/.bashrc

# 6. Upload model (from another RunPod pod or local)
# Option A: runpodctl
runpodctl receive <code>  # receive model.gguf

# Option B: wget from HuggingFace or direct URL
wget <model_url> -O /workspace/model.gguf

# 7. Upload backend code
mkdir -p /workspace/app/voices /workspace/app/stt /workspace/app/tts
# SCP all backend files...
scp -P <PORT> -i <key> backend/* root@<IP>:/workspace/app/
scp -P <PORT> -i <key> backend/stt/* root@<IP>:/workspace/app/stt/
scp -P <PORT> -i <key> backend/tts/* root@<IP>:/workspace/app/tts/

# 8. Download TTS models
cd /workspace/app/voices
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

# 9. Upload and run start.sh
scp -P <PORT> -i <key> start.sh root@<IP>:/workspace/start.sh
ssh ... "chmod +x /workspace/start.sh && bash /workspace/start.sh"

# 10. Verify
curl https://<POD_ID>-8000.proxy.runpod.net/health
# → {"status":"ok","model":"cbse-science-v2"}
```

#### B. Frontend (Vercel)

```bash
# 1. Update .env.production with new RunPod pod URL
echo "VITE_WS_URL=wss://<NEW_POD_ID>-8000.proxy.runpod.net/ws/voice" > frontend/.env.production

# 2. Install and build
cd frontend
npm install
npm run build

# 3. Deploy to Vercel
npx vercel --prod --yes --force

# 4. Test
# Open the Vercel URL on mobile, tap mic, speak
```

#### C. Git Setup

```bash
cd cbse-chatbot
git init
git remote add origin https://github.com/<user>/cbse-science-tutor.git
git add -A
git commit -m "Initial commit"
git push -u origin master
```

---

## 13. Troubleshooting

### TTS is slow (8+ seconds)

```bash
# Check if CUDA provider loaded:
grep "CUDA" /workspace/fastapi_server.log
# If you see "Failed to create CUDAExecutionProvider":
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
export ONNX_PROVIDER=CUDAExecutionProvider
# Restart FastAPI
```

### No audio response on mobile

```bash
# Check server logs:
tail -f /workspace/fastapi_server.log
# Look for:
# 🎤 [Xs] User: <transcript>     ← STT working
# 🔊 TTS [Xs] N chars -> NKB     ← TTS working
# If no logs appear, the WebSocket isn't receiving audio
```

### WebSocket keeps disconnecting

```bash
# Check if FastAPI process is running:
ps aux | grep uvicorn
# Check for crash:
tail -50 /workspace/fastapi_server.log | grep -i error
```

### LLM not loading on GPU

```bash
grep "offloaded" /workspace/llm_server.log
# Should show: "offloaded 36/36 layers to GPU"
# If 0 layers: CUDA llama-cpp-python not installed properly
# Reinstall:
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python[server] --no-cache-dir --force-reinstall
```

### ffmpeg not found (audio decode fails)

```bash
apt-get update -qq && apt-get install -y -qq ffmpeg
# Or add to start.sh (already included)
```

### Pod restarted — services down

```bash
ssh in and run:
bash /workspace/start.sh
# start.sh handles: env vars, ffmpeg check, LLM start, FastAPI start
```

### Voice not working on specific mobile browser

- Ensure HTTPS (required for `getUserMedia`)
- Check browser supports `MediaRecorder` with `audio/webm;codecs=opus`
- Safari may need `audio/mp4` — current code falls back to `audio/webm`
- Check browser console for errors

---

## 14. Credentials & Access

> ⚠️ **Keep these secure. Rotate if compromised.**

| Service | Detail |
|---------|--------|
| **GitHub Repo** | `Naveenasri02/cbse-science-tutor` |
| **RunPod Pod ID** | `9c8il089dx1vq9` (cbse-chatbot, L40S) |
| **RunPod SSH** | Key: `~/.runpod/ssh/RunPod-Key-Go`, IP: `193.183.22.57:1509` |
| **RunPod API Key** | *(stored locally, not in repo — check RunPod dashboard)* |
| **Vercel Project** | `sai-naveena-sris-projects/frontend` |
| **Vercel URL** | `https://frontend-murex-six-x762l521bi.vercel.app` |
| **LLM API Key** | `cbse-sk-local` (local only, no external access) |

### RunPod File Locations

```
/workspace/
├── model.gguf                     # 4.7GB Qwen3-8B Q4_K_M
├── start.sh                       # Startup script
├── llm_server.log                 # LLM server logs
├── fastapi_server.log             # FastAPI server logs
└── app/
    ├── server.py                  # FastAPI server
    ├── config.py                  # Configuration
    ├── stt/whisper_stt.py         # STT engine
    ├── tts/kokoro_tts.py          # TTS engine
    └── voices/
        ├── kokoro-v1.0.onnx       # TTS model
        └── voices-v1.0.bin        # TTS voices
```

---

## Git Commit History

```
4c656cb Fix interrupt flow: stop speaker, discard stale audio, process next Q
8167c68 Realistic voice chat: barge-in only on actual speech
2549a36 Optimize voice pipeline for <1s latency
da01735 Continuous voice mode with auto silence detection
5697b7d Replace VAD with native MediaRecorder for mobile voice
737bf3d Fix voice mode: use VAD npm package with CDN asset paths
35e0a2d Optimize voice pipeline: skip <think> TTS, fix WS disconnect, add timing
07069be Add Silero VAD CDN, fix audio sample rate, update RunPod config
45ccc26 Initial commit: CBSE Science Tutor - React PWA + FastAPI backend
```

---

*This document contains everything needed to rebuild this project from zero.*
