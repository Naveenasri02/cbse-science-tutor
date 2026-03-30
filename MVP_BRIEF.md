# CBSE Class 10 Science AI Tutor — MVP Brief

## 🎯 Product Overview

An AI-powered voice & text tutor for CBSE Class 10 Science (Physics, Chemistry, Biology), aligned with the NCERT syllabus. Students can ask questions via text or natural voice conversation and receive accurate, curriculum-aligned answers in real time.

**Live Demo:** https://frontend-murex-six-x762l521bi.vercel.app

---

## ✅ What's Built (MVP Features)

### 1. Dual Interaction Modes
- **Text Chat** — ChatGPT-style UI with markdown, math equations (KaTeX), and streaming responses
- **Voice Chat** — Real-time voice conversation with natural turn-taking, barge-in support, and instant responses

### 2. Custom Domain-Trained AI Model
- Fine-tuned **Qwen3-8B** model trained specifically on CBSE Class 10 Science content
- Answers strictly from NCERT textbook — no hallucination of out-of-syllabus content
- Covers all chapters: Light, Electricity, Chemical Reactions, Life Processes, Heredity, etc.

### 3. Real-Time Voice Pipeline
- **Speech-to-Text:** Whisper (small) — transcribes student speech in ~21ms
- **AI Response:** Custom LLM generates answer in ~310ms
- **Text-to-Speech:** Kokoro — converts answer to natural voice in ~80-190ms
- **Total round-trip: ~500-600ms** (student stops speaking → hears answer)

### 4. Smart Voice Features
- **Voice Activity Detection (VAD):** Automatically detects when student starts/stops speaking
- **Human voice filtering:** Only responds to actual speech, ignores background noise (TV, music)
- **Instant barge-in:** Student can interrupt the tutor mid-answer — audio stops immediately (<16ms)
- **Natural pause handling:** Allows 700ms pauses in speech without cutting off the student

### 5. Conversation Memory
- Maintains context across 20+ exchanges in a session
- Smart context management — older messages are trimmed to keep responses fast

### 6. ChatGPT-Style UI
- Clean, modern interface with suggestion cards for new users
- Auto-resizing text input, animated voice status indicators
- Sidebar with conversation history
- Fully responsive (desktop + mobile)
- PWA-ready (installable on mobile devices)

---

## 🏗️ Technical Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────────┐
│                 │ ◄──────────────────────────►│                      │
│   React PWA     │    wss:// (real-time)       │   FastAPI Backend    │
│   (Vercel)      │                             │   (RunPod GPU)       │
│                 │                             │                      │
│  • ChatGPT UI   │                             │  ┌────────────────┐  │
│  • AudioWorklet │                             │  │ STT (Whisper)  │  │
│  • VAD Engine   │                             │  │ GPU — 21ms     │  │
│  • Gapless Audio│                             │  ├────────────────┤  │
│                 │                             │  │ LLM (Qwen3-8B) │  │
│                 │                             │  │ GPU — 310ms    │  │
│                 │                             │  ├────────────────┤  │
│                 │                             │  │ TTS (Kokoro)   │  │
│                 │                             │  │ GPU — 80-190ms │  │
│                 │                             │  └────────────────┘  │
└─────────────────┘                             └──────────────────────┘
     Vercel CDN                                    NVIDIA L40S (48GB)
```

### Frontend
| Item | Detail |
|------|--------|
| Framework | React 19 + Vite |
| Hosting | Vercel (Global CDN) |
| Audio Capture | AudioWorklet (raw PCM, zero-latency) |
| Rendering | Streaming markdown with KaTeX math support |

### Backend
| Item | Detail |
|------|--------|
| Server | FastAPI with WebSocket |
| GPU | NVIDIA L40S — 48GB VRAM |
| STT | Faster-Whisper (CTranslate2, FP16, CUDA) |
| LLM | Custom Qwen3-8B Q4_K_M GGUF — 105 tok/s |
| TTS | Kokoro ONNX (CUDA) |
| Hosting | RunPod Serverless GPU |

### Performance Optimizations Applied
1. **All 3 AI models on GPU** — zero CPU bottleneck
2. **Think-token elimination** — custom ChatML prompt pre-fill saves 50ms per response
3. **Prompt caching** — LLM skips re-encoding repeated conversation context
4. **Raw PCM audio** — eliminates 116ms of WebM encoding/decoding overhead
5. **Streaming TTS** — audio starts playing while LLM is still generating
6. **Throttled rendering** — UI stays smooth during streaming (no jank)
7. **Flash Attention** — enabled for faster LLM attention computation

---

## 📊 Performance Benchmarks

| Metric | Value |
|--------|-------|
| Speech-to-Text | **21ms** |
| LLM First Token | **16-21ms** |
| LLM Full Response (35 tokens) | **~310ms** |
| LLM Throughput | **105 tokens/sec** |
| Text-to-Speech | **80-190ms** |
| Voice Round-Trip (end-to-end) | **~500-600ms** |
| Barge-in Response | **<16ms** |
| Concurrent Context | **20+ exchanges** |

---

## 🔮 Scaling & Next Steps (Post-MVP)

| Enhancement | Impact |
|-------------|--------|
| Upgrade to A100/H100 GPU | 2-3x faster inference (~200ms round-trip) |
| TensorRT-LLM engine | 3-5x speedup over current setup |
| Streaming STT | Eliminate transcription wait (process while speaking) |
| Multi-language support | Hindi + regional language answers |
| Class 11-12 expansion | Broader syllabus coverage |
| Analytics dashboard | Track student learning patterns |
| Mobile app (PWA → Native) | Better offline + push notification support |

---

## 📦 Deliverables

- ✅ Live web application (text + voice chat)
- ✅ Custom fine-tuned CBSE Science model
- ✅ GPU-optimized backend pipeline
- ✅ Source code (GitHub repository)
- ✅ RunPod deployment configuration

---

*Built with a focus on sub-second response times for a natural, conversational tutoring experience.*
