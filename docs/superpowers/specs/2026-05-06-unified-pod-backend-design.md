# Unified RAG + Gemma LLM Pod, GitHub-driven Vercel — Design

**Date:** 2026-05-06
**Status:** Approved by user; proceeding to implementation
**Context:** Replaces failed RunPod serverless deployment ($197 incident on 2026-05-02→05) and the failed unified-pod attempt (cbse-test pod crash-looped). Frontend at matify.tech requires a backend that exposes the `chat | upload | list_documents | delete_document` ops via a single HTTP endpoint.

## Goal

A self-hosted, low-cost (~$120/mo), always-on chatbot backend running both RAG (embedding + retrieval + Chroma) and Gemma LLM in a single RunPod pod, with frontend auto-deployed from GitHub via Vercel — all managed via CLI tools (`runpodctl`, `gh`, `git`, `vercel`).

## Non-goals

- Voice (STT/TTS) — `VOICE_ENABLED=false`
- Multi-user auth — single-tenant demo
- Auto-scaling — fixed single pod, no HPA
- Hosted LLM API (OpenAI/Gemini/Groq) — privacy requirement rules these out

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  matify.tech                                        │
│  Vercel Edge Function: api/runsync.js               │
│  Reads RUNPOD_API_BASE env, POSTs to pod /run       │
│  Polls /status/{job_id} within 22s budget           │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS via RunPod proxy
                         │ https://<pod-id>-8000.proxy.runpod.net
                         ▼
┌─────────────────────────────────────────────────────┐
│  Single RTX A4000 community pod (~$0.17/hr)         │
│  Image: ghcr.io/naveenasri02/cbse-unified:latest    │
│                                                       │
│  ┌──────────────┐   ┌─────────────────────────────┐ │
│  │ vLLM :8002  │◄──│ handler.py :8000            │ │
│  │ Gemma-4-E4B │   │ runpod --rp_serve_api       │ │
│  │ FP8 (~5GB)  │   │ - chat (calls vLLM)         │ │
│  │ localhost   │   │ - upload (Chroma)           │ │
│  │ only        │   │ - list_documents            │ │
│  └──────────────┘   │ - delete_document           │ │
│                     └─────────────────────────────┘ │
│                                                       │
│  Persistent disk /workspace (30 GB)                 │
│  - /workspace/.hf       (HF model cache)            │
│  - /workspace/chroma    (vector store)              │
└─────────────────────────────────────────────────────┘
```

One pod, one image, one process tree. vLLM bound to localhost only; only handler.py is externally exposed.

## Components

| Piece | Source | Runtime location |
|---|---|---|
| Frontend (React/Vite) | `apps/web/` | Vercel CDN |
| Vercel proxy | `api/runsync.js` | Vercel Edge Function |
| Backend orchestrator | `apps/backend/handler.py` | Pod, port 8000 (public via proxy) |
| LLM inference | vLLM 0.7.0 | Pod, port 8002 (localhost only) |
| RAG pipeline | `apps/backend/rag/*.py` | Pod, in-process with handler |
| Chroma vector store | persisted at `/workspace/chroma` | Pod's persistent disk |
| Image build | `apps/backend/Dockerfile.unified` | GitHub Actions on push to `serverless-backend` branch |

## Data flow

1. User opens matify.tech (Vercel CDN serves the SPA)
2. User submits a chat / upload action; frontend POSTs to `/api/runsync` with `{input: {op, ...args}}`
3. Vercel Edge Function reads `RUNPOD_API_BASE`, POSTs to `<pod-url>/run`, gets `{id: <job-id>}`, polls `/status/<job-id>` within 22s
4. Pod's handler.py routes the op:
   - **chat**: retrieves Chroma chunks → calls vLLM at `localhost:8002` → streams events back
   - **upload**: extracts text → embeds via sentence-transformers → writes to Chroma at `/workspace/chroma`
   - **list_documents** / **delete_document**: queries Chroma metadata
5. Aggregated event stream returned synchronously to Vercel, then to frontend

## Key design decision: pod mode vs serverless

Earlier the unified image was deployed via custom inline bash CMD that ran vLLM + handler.py with `--rp_serve_api`. That crash-looped (uptime went negative repeatedly). Root cause: the image's existing `entrypoint.sh` was bypassed and the inline bash didn't handle vLLM startup timing correctly.

**Fix:** add a single env-var switch to `apps/backend/entrypoint.sh` that selects pod vs serverless mode. Image becomes mode-agnostic and backwards compatible.

```bash
# At the end of apps/backend/entrypoint.sh, replace:
exec python -u /app/handler.py

# With:
if [ "${RP_MODE:-serverless}" = "api" ]; then
  exec python -u /app/handler.py --rp_serve_api --rp_api_host 0.0.0.0 --rp_api_port 8000
else
  exec python -u /app/handler.py
fi
```

Pod template sets `RP_MODE=api`. Existing serverless deployments (if any) continue working with `RP_MODE=serverless` (the default).

## GPU & model choice

| Choice | Spec | Rationale |
|---|---|---|
| GPU | RTX A4000 16 GB community | $0.17/hr cheapest with reliable stock; 16 GB fits Gemma 5 GB + KV cache + RAG model comfortably |
| Model | `prithivMLmods/gemma-4-E4B-it-FP8` | 5 GB FP8 quantized, vLLM-compatible (compressed-tensors), strong on Q&A tasks, already in env vars |
| Cloud type | COMMUNITY | 30-50% cheaper than SECURE; reclaim risk is low and pod auto-restarts if reclaimed |

Fallback GPU order if A4000 community out of stock at deploy time:
1. NVIDIA RTX A5000 24 GB community ($0.16/hr — paradoxically cheaper, more VRAM)
2. NVIDIA RTX A4500 20 GB community ($0.19/hr)
3. NVIDIA GeForce RTX 4090 24 GB community ($0.34/hr — only if cheaper unavailable)

## Frontend ↔ backend integration

**Existing `api/runsync.js` already updated (in this session):**
- Reads `RUNPOD_API_BASE` env var (e.g., `https://<pod-id>-8000.proxy.runpod.net`)
- Falls back to legacy `RUNPOD_LLM_ID` env if `RUNPOD_API_BASE` absent
- Constructs `<base>/run` and `<base>/status/<job-id>` for submit/poll
- Accepts the same `op | input` shape the frontend already sends — no frontend code changes

**Vercel ↔ GitHub auto-deploy:**
- Use `vercel git connect` to link the Vercel project (`prj_fxsmUD4BApMZ4WT4gW3NjbiVKCPw` / `slm-chatbot`) to the GitHub repo
- Production branch = `main` (or whichever branch the user designates)
- After linking, every `git push origin main` triggers an automatic Vercel production deploy

## Deployment flow (CLI-only)

| # | Step | Tool | Cmd / file |
|---|---|---|---|
| 1 | Modify entrypoint.sh with RP_MODE switch | local edit | `apps/backend/entrypoint.sh` |
| 2 | Stage, commit, push to `serverless-backend` | `git` | `git push origin serverless-backend` |
| 3 | Wait for CI build & GHCR push | `gh` | `gh run watch` |
| 4 | Delete current CPU RAG pod | `runpodctl` | `runpodctl pod delete 3olktdazjc6y7q` |
| 5 | Delete unused old templates | `runpodctl` | `runpodctl template delete <id>` |
| 6 | Create unified-pod template (with `RP_MODE=api`) | `runpodctl` | `runpodctl template create --name cbse-unified-pod-tpl ...` |
| 7 | Create A4000 community pod from template | `runpodctl` | `runpodctl pod create --gpu-id "NVIDIA RTX A4000" --cloud-type COMMUNITY ...` |
| 8 | Wait for pod boot (image pull + vLLM start ~5-10 min) | `runpodctl` / `curl` | `runpodctl pod get`, `curl /runsync` |
| 9 | Test pod directly: list_documents, upload, chat | `curl` | `curl POST {pod-url}/runsync ...` |
| 10 | Update Vercel `RUNPOD_API_BASE` env to new pod URL | `vercel` | `vercel env rm RUNPOD_API_BASE && echo {url} | vercel env add ...` |
| 11 | Link Vercel project to GitHub for auto-deploys | `vercel` | `vercel git connect` |
| 12 | Trigger Vercel deploy (push or manual) | `git` / `vercel` | `git push origin main` or `vercel --prod` |
| 13 | Verify Vercel deploy + final e2e test | `curl` | `curl POST matify.tech/api/runsync ...` |

## Cost & spend controls

| Item | Cost |
|---|---|
| RTX A4000 community pod 24/7 | ~$122/mo |
| 30 GB persistent volume | ~$2/mo |
| Vercel Hobby tier | $0 |
| GHCR (public package storage) | $0 |
| GitHub Actions build minutes | $0 (public repo) |
| **Total** | **~$124/mo** |

**Spend safety:** account-level spend limit hard-capped at $5/day in RunPod console (user action). Catches misconfiguration before $150/month damage.

## Testing & verification

1. **Pod direct (no Vercel):**
   - `POST {pod}/runsync {op:list_documents}` → expect `{"documents":[]}` in <30s (cold init)
   - `POST {pod}/runsync {op:upload, document_id, content_b64, filename}` → expect upload events
   - `POST {pod}/runsync {op:chat, message:"hello"}` → expect `llm_start`, `llm_delta`*, `llm_done` events. First call cold-starts vLLM (~60–90s); subsequent <5s.

2. **Vercel proxy:**
   - `POST matify.tech/api/runsync {op:chat, message:"hi"}` → same response shape
   - First call may return "warming up" message if cold start exceeds 22s (expected; retry within 5 min hits warm worker)

3. **Frontend (browser):**
   - Open matify.tech, upload a PDF, list documents (sees uploaded), ask a question, see streamed response

4. **Persistence:**
   - Restart pod: `runpodctl pod stop && runpodctl pod start`
   - Re-run list_documents: previous uploads still present (Chroma persisted on volume)
   - First chat after restart: vLLM cold-start; HF cache reused (no re-download)

## Risks & fallbacks

| Risk | Mitigation |
|---|---|
| A4000 community out of stock at deploy time | Try A5000 → A4500 → 4090 community; if all out, secure cloud equivalent; budget allows up to ~$0.34/hr without exceeding $250/mo |
| CI build fails | Fix locally, re-push. Worst case: build image locally with Docker and `docker push ghcr.io/...` (requires `gh auth login` for GHCR token) |
| Pod proxy 502/timeout under load | Single pod = no HA. Acceptable for demo. For prod: scale to 2+ pods behind RunPod's serverless-style queueing |
| matify.tech DNS not pointing at Vercel | Use Vercel preview URL with deployment-protection bypass token until DNS is fixed at registrar (out of scope) |
| Vercel 22s budget too tight on cold start | runsync.js already returns "still warming up" message; user retries; warm worker responds in <5s |
| Network volume not used | Pod has its own 30 GB persistent disk; no need for separate network volume. Survives pod stop/start, lost only on pod delete |

## Out of scope (later)

- API key rotation (user deferred)
- matify.tech DNS configuration at registrar
- Spot/interruptible pricing (~$0.09/hr A4000) — would require REST API since runpodctl doesn't expose spot flag
- Dual-pod architecture for redundancy
- CI/CD for the backend image's tests
- Monitoring / alerting (RunPod's built-in spend alerts are sufficient for now)

## Approval

User approved the design verbally on 2026-05-06 in the brainstorming session. Proceeding to implementation plan.
