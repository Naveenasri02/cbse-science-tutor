# CBSE Voice Chatbot — Complete Technical Setup Guide

> Full-stack voice chatbot: React frontend (Vercel) ↔ WebSocket ↔ FastAPI backend (RunPod GPU)
> Pipeline: **Silero VAD → STT (Whisper) → LLM (Qwen3-8B) → TTS (Voxtral 4B) → Audio Playback**

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Hardware Requirements](#3-hardware-requirements)
4. [Backend Setup (RunPod GPU Server)](#4-backend-setup-runpod-gpu-server)
5. [Frontend Setup (Vercel)](#5-frontend-setup-vercel)
6. [Voice Pipeline — Deep Dive](#6-voice-pipeline--deep-dive)
7. [Text Chat Pipeline](#7-text-chat-pipeline)
8. [Audio Processing & Normalization](#8-audio-processing--normalization)
9. [Configuration Reference](#9-configuration-reference)
10. [WebSocket Protocol](#10-websocket-protocol)
11. [Performance Optimizations](#11-performance-optimizations)
12. [Deployment Guide](#12-deployment-guide)
13. [Troubleshooting](#13-troubleshooting)
14. [File Structure](#14-file-structure)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    FRONTEND (Vercel)                          │
│                                                              │
│  React App → Silero VAD v5 (browser) → WebSocket Client     │
│  Audio Playback (AudioContext, GainNode, sequential queue)   │
└──────────────────┬───────────────────────────────────────────┘
                   │ WebSocket (wss://)
                   │ - JSON messages (control)
                   │ - Binary messages (audio)
┌──────────────────▼───────────────────────────────────────────┐
│               BACKEND (RunPod A100 80GB GPU)                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ FastAPI Server (port 8000)                           │    │
│  │  - WebSocket endpoint: /ws/voice                     │    │
│  │  - STT: faster-whisper large-v3 (in-process, GPU)    │    │
│  │  - Conversation history management                   │    │
│  │  - TTS chunking & audio normalization                │    │
│  └───────┬──────────────────────┬──────────────────────┘    │
│          │                      │                            │
│  ┌───────▼──────────┐  ┌───────▼──────────────────────┐    │
│  │ vLLM (port 8002)  │  │ vllm-omni (port 8003)       │    │
│  │ Qwen3-8B-AWQ      │  │ Voxtral-4B-TTS-2603         │    │
│  │ awq_marlin kernel  │  │ 20 voice presets             │    │
│  │ 177 tok/s          │  │ 24kHz WAV output             │    │
│  └───────────────────┘  └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow — Voice Chat

```
User speaks → Silero VAD (browser) detects speech end
  → Audio (Float32 PCM) sent via WebSocket binary
  → Server: ffmpeg converts webm→WAV (if needed)
  → STT: faster-whisper transcribes (language=en, beam_size=1)
  → LLM: Qwen3-8B streams response tokens
  → Text chunked at sentence boundaries (.!?)
  → TTS: Voxtral generates WAV per sentence (sequential queue)
  → WAV normalized to 85% peak level
  → Binary WAV sent to browser
  → AudioContext plays chunks sequentially (onended → next)
```

---

## 2. Technology Stack

### Backend
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| API Server | FastAPI + Uvicorn | ≥0.115 | WebSocket server, routing |
| STT | faster-whisper | ≥1.0 | Speech-to-text (GPU, large-v3) |
| LLM | vLLM | ≥0.18 | Qwen3-8B-AWQ inference server |
| TTS | vllm-omni | ≥0.18 | Voxtral-4B-TTS server |
| HTTP Client | httpx | ≥0.27 | Async HTTP to LLM/TTS servers |
| Audio | ffmpeg | system | WebM→WAV conversion |

### Frontend
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | React | 19.x | UI framework |
| Build | Vite | 8.x | Build tool |
| CSS | Tailwind CSS | 4.x | Styling |
| VAD | @ricky0123/vad-web | 0.0.30 | Voice Activity Detection (Silero v5) |
| Math | KaTeX | 0.16.x | LaTeX rendering |
| Markdown | marked | 17.x | Markdown rendering |
| Icons | react-icons | 5.x | HeroIcons |
| Hosting | Vercel | - | CDN + static hosting |

---

## 3. Hardware Requirements

### GPU Server (RunPod)
- **GPU**: NVIDIA A100-SXM4-80GB (minimum 48GB VRAM recommended)
- **VRAM allocation**:
  - Voxtral 4B TTS: ~46GB (loaded first, takes most VRAM)
  - Qwen3-8B-AWQ LLM: ~6GB (with gpu_memory_utilization=0.38)
  - faster-whisper large-v3: ~3GB
  - Total: ~55-60GB VRAM
- **System RAM**: 16GB+
- **Storage**: 50GB+ (model weights cached in /workspace/.cache/huggingface)

### RunPod Template
- Image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- GPU: A100 80GB SXM
- Volume: `/workspace` (persistent)

---

## 4. Backend Setup (RunPod GPU Server)

### 4.1 Initial Server Setup

```bash
# SSH into RunPod
ssh -i ~/.ssh/id_ed25519 -p PORT root@HOST

# Install system dependencies
apt-get update -qq && apt-get install -y -qq ffmpeg

# Set HuggingFace cache to persistent storage
export HF_HOME=/workspace/.cache/huggingface
mkdir -p $HF_HOME
ln -sf $HF_HOME /root/.cache/huggingface
```

### 4.2 Install Python Dependencies

```bash
cd /workspace
git clone https://github.com/YOUR_USER/cbse-science-tutor.git cbse-chatbot
cd cbse-chatbot/backend
pip install -r requirements.txt
```

**requirements.txt:**
```
# Core
fastapi>=0.115
uvicorn[standard]>=0.34
websockets>=13.0
python-dotenv>=1.0
httpx>=0.27

# LLM client (OpenAI-compatible, talks to vLLM)
openai>=1.50

# STT (runs in-process on GPU)
faster-whisper>=1.0
soundfile>=0.12

# Infra (installed separately on GPU server)
# vllm>=0.18        — serves Qwen3-8B LLM on port 8002
# vllm-omni>=0.18   — serves Voxtral 4B TTS on port 8003

numpy>=1.26
```

### 4.3 Install vLLM and vllm-omni

```bash
# Install vLLM for LLM serving
pip install vllm>=0.18

# Install vllm-omni for TTS serving
pip install vllm-omni>=0.18
```

### 4.4 Start TTS Server (Voxtral 4B) — START FIRST

> ⚠️ TTS must start first — it uses ~46GB VRAM and needs to allocate before LLM

```bash
# Patch TTS stage config to reduce VRAM from 0.8 to 0.5
TTS_YAML=$(python3 -c "import vllm_omni; import os; print(os.path.join(os.path.dirname(vllm_omni.__file__), 'model_executor/stage_configs/voxtral_tts.yaml'))")
sed -i 's/gpu_memory_utilization: 0.8/gpu_memory_utilization: 0.5/' "$TTS_YAML"

# Start TTS server
nohup vllm serve mistralai/Voxtral-4B-TTS-2603 --omni \
  --host 0.0.0.0 \
  --port 8003 \
  --dtype bfloat16 \
  > /workspace/tts_server.log 2>&1 &
echo "TTS PID=$!"

# Wait for TTS to be healthy (takes 2-5 minutes for first download)
while ! curl -s http://localhost:8003/health > /dev/null 2>&1; do sleep 5; done
echo "TTS ready"
```

### 4.5 Start LLM Server (Qwen3-8B-AWQ) — START SECOND

```bash
nohup vllm serve Qwen/Qwen3-8B-AWQ \
  --host 0.0.0.0 \
  --port 8002 \
  --gpu-memory-utilization 0.38 \
  --max-model-len 2048 \
  --api-key cbse-sk-local \
  --dtype auto \
  --quantization awq_marlin \
  > /workspace/llm_server.log 2>&1 &
echo "LLM PID=$!"

# Wait for LLM to be healthy
while ! curl -s http://localhost:8002/health > /dev/null 2>&1; do sleep 5; done
echo "LLM ready"
```

**Critical LLM Parameters:**
| Parameter | Value | Reason |
|-----------|-------|--------|
| `--quantization awq_marlin` | **awq_marlin** | 8.8x faster than plain `awq` (177 tok/s vs 20 tok/s on A100) |
| `--gpu-memory-utilization 0.38` | 0.38 | Max safe value with Voxtral using ~46GB. Higher causes OOM |
| `--max-model-len 2048` | 2048 | Context window. Must match `max_ctx` in server.py |
| `--api-key` | cbse-sk-local | Matches `VLLM_API_KEY` in config.py |

### 4.6 Start FastAPI Server — START LAST

```bash
cd /workspace/cbse-chatbot/backend
nohup python3 server.py > /tmp/fastapi.log 2>&1 &

# Verify all 3 services
curl -s http://localhost:8000/health   # FastAPI
curl -s http://localhost:8002/health   # LLM
curl -s http://localhost:8003/health   # TTS
```

### 4.7 Automated Startup Script (start.sh)

The `start.sh` script in the repo root handles all 3 services in order:
```bash
chmod +x start.sh
./start.sh
```

---

## 5. Frontend Setup (Vercel)

### 5.1 Local Development

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
# Vite proxies /ws/* to localhost:8000 (see vite.config.js)
```

### 5.2 Environment Variables

**`.env.production`** (committed — points to RunPod):
```env
VITE_WS_URL=wss://YOUR_POD_ID-8000.proxy.runpod.net/ws/voice
```

**`.env`** (local dev — not committed):
```env
VITE_WS_URL=ws://localhost:8000/ws/voice
```

### 5.3 Required Public Files

These files must exist in `frontend/public/`:
```
silero_vad_v5.onnx    — Silero VAD v5 model (ONNX)
vad.worklet.bundle.min.js — VAD audio worklet
```

Download from: https://github.com/ricky0123/vad/tree/master/packages/vad-web/dist

### 5.4 Build & Deploy to Vercel

```bash
cd frontend
npm run build            # Build to dist/
npx vercel --prod --yes  # Deploy to Vercel
```

### 5.5 Vercel Configuration

- **Framework**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**: Set `VITE_WS_URL` in Vercel dashboard

---

## 6. Voice Pipeline — Deep Dive

### 6.1 Client-Side: Voice Activity Detection (Silero VAD v5)

**File: `frontend/src/hooks/useVoice.js`**

```
User clicks mic → VAD initializes (first time only, then reuses)
  → Microphone stream → Silero VAD v5 processes audio frames
  → onSpeechStart: UI shows "Recording..."
  → onSpeechEnd: Float32 PCM audio → WebSocket binary message
```

**VAD Parameters:**
| Parameter | Value | Purpose |
|-----------|-------|---------|
| `positiveSpeechThreshold` | 0.6 | Confidence to start detecting speech |
| `negativeSpeechThreshold` | 0.3 | Confidence to stop detecting speech |
| `minSpeechMs` | 250 | Minimum speech duration (ms) |
| `preSpeechPadMs` | 250 | Audio captured before speech starts |
| `redemptionMs` | 900 | Silence tolerance before ending speech |

**Key optimization: VAD pre-initialization**
- First click: loads ONNX model + WASM runtime + mic permission (~1-2s)
- Subsequent clicks: instant (uses `vad.start()` / `vad.pause()`)
- VAD instance stored in ref, destroyed only on component unmount

### 6.2 Server-Side: STT (faster-whisper)

**File: `backend/stt/whisper_stt.py`**

```python
WhisperModel("large-v3", device="cuda", compute_type="float16")
model.transcribe(audio, language="en", beam_size=1, vad_filter=True)
```

**Optimizations applied:**
| Setting | Value | Impact |
|---------|-------|--------|
| `language="en"` | Fixed | Skips language detection (~50-100ms saved) |
| `beam_size=1` | Greedy | Faster than beam search, good enough for clear mic audio |
| `vad_filter=True` | Enabled | Filters silence/noise |
| `min_silence_duration_ms=400` | 400ms | Splits on pauses |

**Hallucination filter:** Common Whisper hallucinations (e.g., "thanks for watching", "subscribe") are detected and filtered out.

### 6.3 Server-Side: LLM (Qwen3-8B-AWQ via vLLM)

**File: `backend/server.py` → `run_voice_pipeline()`**

The LLM uses **raw `/v1/completions` endpoint** (not `/v1/chat/completions`) with ChatML format for:
1. **Think-skip prefill**: `<think>\n\n</think>\n\n` — forces model to skip reasoning, respond directly
2. **Prompt caching**: `cache_prompt: true` — reuses KV cache across turns

```python
prompt = _build_chatml_prompt(messages, prefill="<think>\n\n</think>\n\n", max_ctx=1700)
```

**Context management (`_build_chatml_prompt`):**
- Keeps system prompt + most recent messages that fit within `max_ctx` tokens
- Text chat: `max_ctx=1400` (leaves room for 512 response tokens within 2048 model limit)
- Voice chat: `max_ctx=1700` (only needs 150 response tokens)
- If prompt exceeds `max-model-len (2048)`, oldest messages are trimmed

**Voice LLM settings:**
| Parameter | Value | Reason |
|-----------|-------|--------|
| `max_tokens` | 150 | Short voice responses (2-4 sentences) |
| `temperature` | 0.0 | Deterministic, consistent answers |
| `stop` | `["<\|im_end\|>"]` | ChatML stop token |
| `stream` | true | Token-by-token for progressive TTS |

### 6.4 Server-Side: TTS Chunking Strategy

**Critical for consistent audio quality.**

LLM tokens stream in one-by-one. Text is buffered and split into TTS chunks:

```python
# All chunks split at sentence boundaries only
for sc in ".!?":
    idx = tts_buffer.rfind(sc)
    if idx >= 0:
        candidate = tts_buffer[:idx + 1].strip()
        if len(candidate) >= 5:
            send_text = candidate
            tts_buffer = tts_buffer[idx + 1:]
            break
```

**Why sentence-level splitting?**
- Short fragments (commas, 3-4 words) → Voxtral speaks them **slowly**
- Full sentences → Voxtral speaks at **natural pace**
- Consistent chunk sizes = consistent audio speed

**Sequential TTS Queue:**
```python
tts_queue = asyncio.Queue()

async def tts_worker():
    while True:
        text = await tts_queue.get()
        if text is None: break
        await _send_tts(ws, text)
```
- Guarantees audio chunks arrive at frontend **in order**
- Previous approach (concurrent `asyncio.create_task`) caused out-of-order audio

### 6.5 Server-Side: TTS Generation (Voxtral 4B)

**File: `backend/tts/voxtral_tts.py`**

```python
response = httpx.post(
    "http://localhost:8003/v1/audio/speech",
    json={
        "input": text,
        "model": "mistralai/Voxtral-4B-TTS-2603",
        "response_format": "wav",
        "voice": "neutral_female",
    }
)
```

**Available voices (20 total):**
| Voice | Language | Gender | Notes |
|-------|----------|--------|-------|
| `neutral_female` ⭐ | English | Female | **Recommended** — consistent, natural |
| `neutral_male` | English | Male | UK-neutral feel |
| `casual_female` | English | Female | Warmer, conversational |
| `casual_male` | English | Male | Relaxed tone |
| `cheerful_female` | English | Female | Upbeat (slower generation) |
| `hi_female` | Hindi | Female | Fastest speaking pace |
| `hi_male` | Hindi | Male | Hindi accent |
| Others | Various | Various | ar, de, es, fr, it, nl, pt variants |

**Voice selection rationale:**
- `neutral_female` chosen for consistent pitch and natural tone
- `speed` parameter was tested but **removed** — it alters vocal characteristics (makes female sound male)
- No `playbackRate` on client — it distorts pitch

### 6.6 Server-Side: Audio Normalization

**File: `backend/server.py` → `_normalize_wav()`**

Every TTS chunk is peak-normalized to 85% before sending:

```python
def _normalize_wav(wav_bytes, target_peak=0.85):
    # Read WAV → int16 samples
    # Find peak amplitude
    # Scale all samples so peak = 85% of max
    # Write back to WAV
```

**Why normalization?**
- Voxtral generates chunks at different volumes
- Without normalization: random volume spikes/drops between sentences
- 85% target prevents clipping while maintaining loudness

### 6.7 Client-Side: Audio Playback

**File: `frontend/src/hooks/useAudioPlayer.js`**

```
AudioContext (24kHz) → GainNode (1.0) → destination (speakers)
```

**Strict sequential playback:**
1. Binary WAV arrives → pushed to queue with `pipelineId`
2. `playNext()` shifts from queue, decodes WAV to AudioBuffer
3. Force-stops any still-playing source (prevents overlap)
4. `src.start(0)` — play immediately
5. `src.onended` → `playNext()` — next chunk only after current finishes

**Key design decisions:**
| Decision | Why |
|----------|-----|
| No `playbackRate` | Alters pitch — makes female voice sound male |
| No gapless pre-scheduling | Caused 2 chunks to overlap |
| `GainNode.gain = 1.0` | Neutral — server normalization handles volume |
| `pipelineId` matching | Discards audio from cancelled/stale pipelines |

### 6.8 Barge-in (Interrupt)

When user starts speaking while bot is talking:
1. **Client**: Silero VAD detects speech (`isSpeech > 0.85` for 2+ frames)
2. **Client**: Sends `{"type": "interrupt"}` JSON + stops audio playback
3. **Client**: Sets `interruptedRef = true` (discards incoming stale audio)
4. **Server**: Cancels running pipeline task (`pipeline_task.cancel()`)
5. **Server**: Sends `llm_done` + `tts_done` to clean up state
6. **Server**: Waits for new audio from user

---

## 7. Text Chat Pipeline

Simpler path — no STT/TTS involved:

```
User types message → JSON: {"type": "text_chat", "text": "..."}
  → Server: conversation_history.append(user message)
  → LLM: streaming /v1/completions (max_tokens=512, temperature=0.3)
  → Each token → JSON: {"type": "llm_delta", "text": "..."}
  → Client: progressive markdown rendering
  → Server: JSON: {"type": "llm_done"}
```

**Differences from voice pipeline:**
| | Text Chat | Voice Chat |
|---|-----------|------------|
| max_tokens | 512 | 150 |
| temperature | 0.3 | 0.0 |
| max_ctx | 1400 | 1700 |
| System prompt | SYSTEM_PROMPT | VOICE_SYSTEM_PROMPT |
| TTS | No | Yes (sequential queue) |

---

## 8. Audio Processing & Normalization

### Browser → Server (STT input)

```
Silero VAD captures Float32 PCM audio (16kHz, mono)
  → Sent as binary WebSocket message
  → Server checks format:
     - WebM (0x1A45DFA3 header) → ffmpeg decodes to WAV
     - Raw Float32 → converted to int16 WAV
  → WAV passed to faster-whisper
```

### Server → Browser (TTS output)

```
Voxtral generates 24kHz WAV (int16, mono)
  → Peak normalized to 85% amplitude
  → Sent as binary WebSocket message
  → Browser: AudioContext.decodeAudioData()
  → BufferSource → GainNode (1.0) → speakers
```

---

## 9. Configuration Reference

### `backend/config.py`

```python
# LLM
VLLM_BASE_URL = "http://localhost:8002/v1"
VLLM_MODEL = "Qwen/Qwen3-8B-AWQ"
VLLM_API_KEY = "cbse-sk-local"

# STT
STT_MODEL_SIZE = "large-v3"        # Options: tiny, base, small, medium, large-v3
STT_DEVICE = "cuda"                # cuda or cpu
STT_COMPUTE_TYPE = "float16"       # float16, int8, int8_float16

# TTS
TTS_VOICE = "neutral_female"       # See voice table above
TTS_SPEED = 1.0                    # Keep at 1.0 (speed param distorts voice)

# Server
SERVER_PORT = 8000
CORS_ORIGINS = "*"
```

### System Prompts

**Text chat (SYSTEM_PROMPT):**
- Adapts response length to question style ("what is" → short, "explain in detail" → long)
- Covers all CBSE Class 10 subjects

**Voice chat (VOICE_SYSTEM_PROMPT):**
- Natural conversational tone (contractions, casual connectors)
- 2-4 sentence answers
- No markdown, no lists, no special characters
- `/no_think` suffix tells Qwen3 to skip reasoning

---

## 10. WebSocket Protocol

### Endpoint: `/ws/voice`

### Client → Server Messages

| Type | Format | Purpose |
|------|--------|---------|
| Text chat | `{"type": "text_chat", "text": "..."}` | Text message from user |
| Interrupt | `{"type": "interrupt"}` | Barge-in — cancel current pipeline |
| Audio | Binary (Float32 PCM or WebM) | Voice audio from VAD |

### Server → Client Messages

| Type | Format | Purpose |
|------|--------|---------|
| `user_transcript` | `{"type": "user_transcript", "text": "..."}` | STT result |
| `llm_start` | `{"type": "llm_start"}` | LLM generation started |
| `llm_delta` | `{"type": "llm_delta", "text": "..."}` | Streaming LLM token |
| `llm_done` | `{"type": "llm_done", "interrupted": bool}` | LLM generation complete |
| `tts_start` | `{"type": "tts_start"}` | Audio chunk incoming |
| (binary) | Raw WAV bytes | TTS audio chunk |
| `tts_done` | `{"type": "tts_done"}` | All audio sent |
| `vad_no_speech` | `{"type": "vad_no_speech"}` | STT detected no speech |
| `ping` | `{"type": "ping"}` | Keep-alive (every 20s) |
| `error` | `{"type": "error", "text": "..."}` | Error message |

---

## 11. Performance Optimizations

### LLM: awq_marlin quantization
- `--quantization awq_marlin` instead of `awq`
- **Result**: 177 tok/s vs 20 tok/s (8.8x speedup) on A100
- vLLM automatically detects compatible hardware

### STT: Skip language detection
- `language="en"` + `beam_size=1`
- Saves ~50-100ms per transcription
- Greedy decoding is sufficient for clear microphone audio

### TTS: Sequential queue with sentence chunking
- Ensures correct audio order (vs concurrent tasks)
- Sentence-level splits produce consistent speech pace
- Peak normalization eliminates volume fluctuation

### VAD: Pre-initialization
- ONNX model loaded once, reused across voice toggles
- `vad.pause()` / `vad.start()` instead of `destroy()` / `new()`

### WebSocket: Keep-alive pings
- Server sends `{"type": "ping"}` every 20 seconds
- Prevents RunPod proxy from dropping idle connections

### Context: Smart trimming
- `_build_chatml_prompt()` trims oldest messages to fit `max_ctx`
- Prevents prompt overflow (silent LLM failure after 4-5 exchanges)
- System prompt always preserved

### Think-skip prefill
- `prefill="<think>\n\n</think>\n\n"` pre-fills the assistant response
- Model skips internal reasoning → faster first token
- VOICE_SYSTEM_PROMPT includes `/no_think` for double safety

---

## 12. Deployment Guide

### 12.1 Deploy Backend to RunPod

```bash
# From local machine
SCP_CMD="scp -i ~/.ssh/id_ed25519 -P PORT"
SSH_HOST="root@HOST"

# Upload backend files
$SCP_CMD backend/server.py $SSH_HOST:/workspace/cbse-chatbot/backend/
$SCP_CMD backend/config.py $SSH_HOST:/workspace/cbse-chatbot/backend/
$SCP_CMD backend/tts/voxtral_tts.py $SSH_HOST:/workspace/cbse-chatbot/backend/tts/
$SCP_CMD backend/stt/whisper_stt.py $SSH_HOST:/workspace/cbse-chatbot/backend/stt/

# SSH in and restart FastAPI
ssh -i ~/.ssh/id_ed25519 -p PORT $SSH_HOST
kill $(pgrep -f 'python3 server.py') 2>/dev/null
cd /workspace/cbse-chatbot/backend
nohup python3 server.py > /tmp/fastapi.log 2>&1 &
curl -s http://localhost:8000/health
```

### 12.2 Deploy Frontend to Vercel

```bash
cd frontend

# Update WebSocket URL if pod ID changed
echo "VITE_WS_URL=wss://YOUR_POD_ID-8000.proxy.runpod.net/ws/voice" > .env.production

# Build and deploy
npm run build
npx vercel --prod --yes
```

### 12.3 GitHub CI/CD

Push to `master` → Vercel auto-deploys frontend (linked via GitHub integration).
Backend must be deployed manually via SCP.

---

## 13. Troubleshooting

### Chatbot stops replying after 4-5 messages
- **Cause**: Prompt exceeds `--max-model-len 2048`
- **Fix**: Ensure `max_ctx` in `_build_chatml_prompt()` < `max-model-len - max_tokens - overhead`
- Text: `max_ctx=1400` (2048 - 512 - overhead)
- Voice: `max_ctx=1700` (2048 - 150 - overhead)

### TTS audio chunks play out of order
- **Cause**: Concurrent TTS tasks finish in random order
- **Fix**: Sequential `asyncio.Queue` worker (current implementation)

### Audio pitch varies / female sounds male
- **Cause**: `speed` parameter or `playbackRate` alters vocal characteristics
- **Fix**: Remove both. Use natural speed (1.0) only.

### Audio overlapping (2 voices at once)
- **Cause**: Gapless pre-scheduling with timing drift
- **Fix**: Strict sequential playback — `onended` triggers next chunk

### Volume fluctuates between chunks
- **Cause**: Voxtral generates chunks at different amplitudes
- **Fix**: Server-side peak normalization to 85% (`_normalize_wav()`)

### Voice icon click has delay
- **Cause**: VAD re-initializes (loads ONNX, requests mic) every click
- **Fix**: Pre-initialize VAD once, use `pause()`/`start()` for toggles

### WebSocket disconnects randomly
- **Cause**: RunPod proxy drops idle connections
- **Fix**: Keep-alive pings every 20 seconds

### LLM very slow (20 tok/s)
- **Cause**: Using `--quantization awq` instead of `awq_marlin`
- **Fix**: Restart vLLM with `--quantization awq_marlin` (177 tok/s)

### OOM (Out of Memory) on GPU
- **Cause**: LLM `--gpu-memory-utilization` too high
- **Fix**: Keep ≤0.38 when Voxtral is running (~46GB)

---

## 14. File Structure

```
cbse-chatbot/
├── backend/
│   ├── config.py              # All configuration (LLM, STT, TTS, server)
│   ├── server.py              # FastAPI WebSocket server (main logic)
│   ├── requirements.txt       # Python dependencies
│   ├── stt/
│   │   └── whisper_stt.py     # faster-whisper STT wrapper
│   └── tts/
│       └── voxtral_tts.py     # Voxtral TTS HTTP client
│
├── frontend/
│   ├── package.json           # npm dependencies
│   ├── vite.config.js         # Vite config (proxy, tailwind)
│   ├── .env.production        # Production WebSocket URL
│   ├── public/
│   │   ├── silero_vad_v5.onnx # Silero VAD model
│   │   └── vad.worklet.bundle.min.js
│   └── src/
│       ├── main.jsx           # React entry point
│       ├── App.jsx            # Main app (WS handler, state management)
│       ├── index.css          # Global styles (Tailwind + animations)
│       ├── hooks/
│       │   ├── useWebSocket.js    # WebSocket with auto-reconnect
│       │   ├── useVoice.js        # Silero VAD (pre-init, pause/resume)
│       │   └── useAudioPlayer.js  # Audio playback (sequential, normalized)
│       └── components/
│           ├── ChatArea.jsx   # Message list with auto-scroll
│           ├── InputBar.jsx   # Text input + mic button + voice status
│           ├── Message.jsx    # Single message (markdown + LaTeX)
│           └── Sidebar.jsx    # Chat history sidebar
│
├── start.sh                   # Startup script (TTS → LLM → FastAPI)
├── Dockerfile                 # Container build
└── .gitignore                 # Ignores models, node_modules, .env
```

---

## Quick Reference: Restart Commands

```bash
# Restart FastAPI only
kill $(pgrep -f 'python3 server.py'); cd /workspace/cbse-chatbot/backend && nohup python3 server.py > /tmp/fastapi.log 2>&1 &

# Restart LLM only
kill $(pgrep -f 'vllm serve Qwen'); nohup vllm serve Qwen/Qwen3-8B-AWQ --host 0.0.0.0 --port 8002 --gpu-memory-utilization 0.38 --max-model-len 2048 --api-key cbse-sk-local --dtype auto --quantization awq_marlin > /workspace/llm_server.log 2>&1 &

# Check all services
curl -s http://localhost:8000/health && curl -s http://localhost:8002/health && curl -s http://localhost:8003/health

# View logs
tail -f /tmp/fastapi.log           # FastAPI
tail -f /workspace/llm_server.log  # LLM
tail -f /workspace/tts_server.log  # TTS

# Deploy from local (Windows)
scp -i C:\Users\USER\.ssh\id_ed25519 -P PORT backend/server.py root@HOST:/workspace/cbse-chatbot/backend/
cd frontend && npm run build && npx vercel --prod --yes
```
