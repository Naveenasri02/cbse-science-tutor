# CBSE Chatbot — Full Deployment Plan (v3)
> Last updated: Session end — pod created, not yet connected

---

## 🏗️ Architecture
```
[React PWA — Vercel]
       |  WebSocket (wss)
       v
[FastAPI Orchestrator — port 8000]  ← RunPod GPU pod
   |            |            |
   v            v            v
 [STT]        [LLM]       [TTS]
 Whisper      Qwen3-8B    Voxtral 4B
 large-v3     via vLLM    via vllm-omni
 (in-proc)    (port 8002) (port 8003)
```

## 🖥️ GPU Server: RunPod L40S (48GB VRAM)
| Service         | Model               | VRAM   | Disk    |
|-----------------|---------------------|--------|---------|
| LLM (vLLM)     | Qwen3-8B BF16       | ~20GB  | ~16GB   |
| TTS (vllm-omni)| Voxtral 4B BF16     | ~10GB  | ~8GB    |
| STT (in-proc)  | Whisper large-v3     | ~3GB   | ~3GB    |
| **Total**       |                     | **~33GB/48GB** | **~27GB** |

## 🔑 Critical Credentials & Access
- **RunPod API Key**: `<REDACTED — set in environment>`
- **RunPod GraphQL**: `https://api.runpod.io/graphql?api_key=<KEY>`
- **New Pod ID**: `xs0lkulpxanwr7` (name: "cbse-chatbot")
- **Pod Image**: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- **Pod GPU**: L40S, Volume: 50GB, Container disk: 20GB
- **Exposed ports**: 8000/http (FastAPI), 8003/http (Voxtral TTS)
- **SSH Key**: `C:\Users\saina\.ssh\id_ed25519` (no passphrase)
- **SSH Command**: `C:\Windows\System32\OpenSSH\ssh.exe -i C:\Users\saina\.ssh\id_ed25519 root@<IP> -p <PORT>`
- **SCP Command**: `C:\Windows\System32\OpenSSH\scp.exe -i C:\Users\saina\.ssh\id_ed25519 -P <PORT>`
- ⚠️ **SSH port changes on EVERY restart** — always query API first to get current IP/port
- ⚠️ **RunPod SSH proxy (ssh.runpod.io) does NOT work** — use direct IP only
- **GitHub Repo**: `https://github.com/Naveenasri02/cbse-science-tutor`
- **Vercel Live URL**: `https://frontend-murex-six-x762l521bi.vercel.app`

## 📁 Local Project: `E:\cbse-chatbot`

### Files Already Updated (ready to deploy):
| File | What Changed |
|------|-------------|
| `backend/config.py` | All CBSE subjects (not just Science), Whisper large-v3, Qwen3-8B model name, Voxtral settings, `is_cbse_related()` always True |
| `backend/server.py` | TTS loads as HTTP client, updated docstring |
| `backend/tts/voxtral_tts.py` | **NEW** — HTTP client calling vllm-omni at localhost:8003 |
| `backend/requirements.txt` | Removed kokoro-onnx/torch, added httpx, documented vLLM as infra |
| `start.sh` | Complete rewrite: starts vLLM(:8002), vllm-omni(:8003), waits, starts FastAPI(:8000) |

### Files Still Need Updating:
| File | What's Needed |
|------|-------------|
| `frontend/.env.production` | Change pod URL to `wss://xs0lkulpxanwr7-8000.proxy.runpod.net/ws/voice` |

---

## ⚠️ CRITICAL: CUDA Version Mismatch Warning
The pod image has **CUDA driver 12.4** (driver 550.x). Default `pip install vllm` installs PyTorch with **cu128** which requires driver 565+. This **WILL BREAK CUDA**.

### Solution Options (try in order):
1. **Option A (Recommended)**: Install PyTorch cu124 first, then vLLM with --no-deps:
   ```bash
   pip install torch==2.4.0+cu124 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
   pip install vllm --no-build-isolation
   ```
2. **Option B**: Find a RunPod image with CUDA 12.8+ driver (the tag `2.8.0-py3.11-cuda12.8.1-devel-ubuntu22.04` does NOT exist — need to search Docker Hub for valid tags)
3. **Option C**: Use older vLLM version compatible with PyTorch 2.4+cu124

### Previous Pod Failures:
- Pod `w1qhn570jyadk0` died due to CUDA device mapping issue after image change attempt
- `/dev/nvidia4` instead of `/dev/nvidia0` — container couldn't access GPU
- That pod was TERMINATED; new pod `xs0lkulpxanwr7` was created fresh

---

## ✅ Completed Steps
- [x] Explored entire codebase
- [x] Set up SSH access (ed25519 key, added to RunPod)
- [x] Planned full architecture upgrade
- [x] Updated all backend code locally (config, server, TTS wrapper, requirements, start.sh)
- [x] Removed Science-only topic filter — now covers ALL CBSE Class 10 subjects
- [x] Terminated broken pod `w1qhn570jyadk0`
- [x] Created new pod `xs0lkulpxanwr7` (L40S, 50GB vol, 20GB container)

## 🔲 Remaining Steps (Resume Here Tomorrow)

### Step 1: Connect to New Pod
```
# Query API for SSH info (port changes every restart!)
# GraphQL query:
query { pod(input: { podId: "xs0lkulpxanwr7" }) {
  id desiredStatus
  runtime { uptimeInSeconds ports { ip publicPort privatePort isIpPublic } }
}}
```
Then SSH in and verify CUDA works:
```bash
nvidia-smi
python3 -c "import torch; print(torch.cuda.is_available())"
```

### Step 2: Install Dependencies on Pod
**⚠️ Handle CUDA mismatch first!** (see warning above)
```bash
# Install PyTorch compatible with CUDA 12.4 FIRST
pip install torch==2.4.0+cu124 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# Then install vLLM (may need --no-build-isolation or version pinning)
pip install vllm

# Install vllm-omni for Voxtral TTS
pip install vllm-omni

# Install remaining deps
pip install faster-whisper pydantic-settings sse-starlette httpx python-dotenv openai uvicorn[standard] fastapi websockets
apt-get update && apt-get install -y ffmpeg
```

### Step 3: Sync Code to Pod
```powershell
# From Windows (use current SSH port from API query):
C:\Windows\System32\OpenSSH\scp.exe -i C:\Users\saina\.ssh\id_ed25519 -P <PORT> -r E:\cbse-chatbot\backend\* root@<IP>:/workspace/cbse-chatbot/backend/
C:\Windows\System32\OpenSSH\scp.exe -i C:\Users\saina\.ssh\id_ed25519 -P <PORT> E:\cbse-chatbot\start.sh root@<IP>:/workspace/cbse-chatbot/
```

### Step 4: Start Services
```bash
# On pod:
cd /workspace/cbse-chatbot
chmod +x start.sh
./start.sh
```
This starts:
1. vLLM serving Qwen3-8B on port 8002 (auto-downloads ~16GB model)
2. vllm-omni serving Voxtral 4B on port 8003 (auto-downloads ~8GB model)
3. FastAPI on port 8000 (Whisper large-v3 auto-downloads ~3GB)

### Step 5: Test End-to-End
```bash
# Test LLM
curl http://localhost:8002/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen3-8B","messages":[{"role":"user","content":"Hello"}]}'

# Test TTS
curl http://localhost:8003/v1/audio/speech -H "Content-Type: application/json" \
  -d '{"input":"Hello","model":"mistralai/Voxtral-4B-TTS-2603","response_format":"wav"}' -o test.wav
```

### Step 6: Update Frontend & Deploy
```powershell
# Update frontend/.env.production:
VITE_WS_URL=wss://xs0lkulpxanwr7-8000.proxy.runpod.net/ws/voice

# Push to GitHub
cd E:\cbse-chatbot
git add -A && git commit -m "Upgrade to vLLM + Voxtral + Whisper large-v3" && git push

# Deploy to Vercel (via Vercel CLI or auto-deploy from GitHub)
```

---

## 📝 Key Decisions Made
1. **All CBSE subjects** — not restricted to Science anymore
2. **Whisper large-v3** over Cohere Transcribe (no Hindi in Cohere, only 14 langs)
3. **Voxtral 4B** over Kokoro (better quality, Hindi support, 9 languages)
4. **vLLM** over llama-cpp-python (2-3x throughput, better accuracy with BF16)
5. **L40S GPU** (48GB VRAM) — fits all 3 models with ~15GB headroom

## 🔗 Useful API Queries

### Get pod SSH info:
```
POST https://api.runpod.io/graphql?api_key=<YOUR_API_KEY>
{"query": "query { pod(input: { podId: \"xs0lkulpxanwr7\" }) { id desiredStatus runtime { uptimeInSeconds ports { ip publicPort privatePort isIpPublic } } } }"}
```

### Stop pod (to save money overnight):
```
{"query": "mutation { podStop(input: { podId: \"xs0lkulpxanwr7\" }) { id desiredStatus } }"}
```

### Resume pod:
```
{"query": "mutation { podResume(input: { podId: \"xs0lkulpxanwr7\", gpuCount: 1 }) { id desiredStatus } }"}
```
