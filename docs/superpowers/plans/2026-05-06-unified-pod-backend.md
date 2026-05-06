# Unified RAG + Gemma LLM Pod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a single self-hosted RTX A4000 community pod running Gemma-4-E4B-FP8 (vLLM) + RAG handler, expose via RunPod proxy URL, point matify.tech (Vercel) at it, link Vercel to GitHub for auto-deploys, and verify end-to-end.

**Architecture:** One pod runs `apps/backend/entrypoint.sh` which launches vLLM on `localhost:8002`, then runs `handler.py --rp_serve_api` on `0.0.0.0:8000`. The image's entrypoint is mode-aware via a new `RP_MODE` env var (api vs serverless), so the same image works for both deployment modes. Vercel Edge Function `api/runsync.js` proxies frontend ops to the pod's `/run` and polls `/status`.

**Tech Stack:** RunPod (pod hosting), GitHub Actions (image build), GHCR (image registry), Vercel (frontend hosting), runpodctl + gh + git + vercel CLIs.

**Spec:** `docs/superpowers/specs/2026-05-06-unified-pod-backend-design.md`

**Working state at plan start:**
- Current pod: `3olktdazjc6y7q` (CPU pod, RAG-only, no vLLM, $0.06/hr) — to be deleted
- Vercel env `RUNPOD_API_BASE` currently points at the CPU pod URL
- `apps/backend/handler.py` and `api/runsync.js` are already adapted for `--rp_serve_api` and base-URL proxy mode (done earlier in session, no changes needed)
- Repo is `E:\cbse-chatbots\` on branch `serverless-backend`
- API key in `~/.runpod/config.toml` and `E:\cbse-chatbots\.runpod_key` is the leaked one (`rpa_EC421E91...`); rotation deferred per user
- Vercel project: `prj_fxsmUD4BApMZ4WT4gW3NjbiVKCPw` / `slm-chatbot`, authed as `naveenasri02-4862`

**Files touched:**
- Modify: `apps/backend/entrypoint.sh` (add RP_MODE switch)
- Commit only: `docs/superpowers/specs/2026-05-06-unified-pod-backend-design.md`, `docs/superpowers/plans/2026-05-06-unified-pod-backend.md`
- No app code changes (handler.py and runsync.js already adapted)

---

## Task 1: Modify entrypoint.sh to support pod mode

**Files:**
- Modify: `E:\cbse-chatbots\apps\backend\entrypoint.sh` (last `exec` line)

- [ ] **Step 1: Read current entrypoint.sh to confirm last line**

Run: `grep -n "exec python" apps/backend/entrypoint.sh`
Expected: `53:exec python -u /app/handler.py`

- [ ] **Step 2: Replace the last `exec` line with RP_MODE switch**

Edit `apps/backend/entrypoint.sh`. Replace exactly:

```bash
echo "[entry] handing off to handler.py (VLLM_BASE_URL=${VLLM_BASE_URL})"
exec python -u /app/handler.py
```

with:

```bash
echo "[entry] handing off to handler.py (VLLM_BASE_URL=${VLLM_BASE_URL}, RP_MODE=${RP_MODE:-serverless})"
if [ "${RP_MODE:-serverless}" = "api" ]; then
  exec python -u /app/handler.py --rp_serve_api --rp_api_host 0.0.0.0 --rp_api_port 8000
else
  exec python -u /app/handler.py
fi
```

- [ ] **Step 3: Verify the change**

Run: `grep -A 5 "RP_MODE" apps/backend/entrypoint.sh`
Expected: shows the if-block from step 2.

- [ ] **Step 4: Commit entrypoint change + spec + plan in one commit**

Run from `E:\cbse-chatbots\`:
```bash
git add apps/backend/entrypoint.sh docs/superpowers/specs/2026-05-06-unified-pod-backend-design.md docs/superpowers/plans/2026-05-06-unified-pod-backend.md
git status   # verify only those 3 files staged
git commit -m "feat(backend): add RP_MODE switch for pod-mode HTTP serving

entrypoint.sh now respects \$RP_MODE env var:
- RP_MODE=serverless (default): handler.py consumes RunPod job queue (existing behavior)
- RP_MODE=api: handler.py runs as FastAPI server on 0.0.0.0:8000 via --rp_serve_api

Same image works for both pod and serverless deployments.
Spec and plan committed alongside the code change."
```

Expected: 3 files changed, ~20 insertions, 1 deletion.

- [ ] **Step 5: Push to serverless-backend (triggers CI build)**

Run: `git push origin serverless-backend`
Expected: push succeeds; CI workflow `Build & Push Backend Image` triggers automatically (it watches `apps/backend/**`).

---

## Task 2: Watch and verify CI image build

**Files:** none

- [ ] **Step 1: List recent workflow runs**

Run: `gh run list --workflow build-backend.yml --limit 3`
Expected: top entry shows `in_progress` or `queued` for the just-pushed commit.

- [ ] **Step 2: Watch the running build to completion**

Run: `gh run watch` (interactive — picks up the running workflow)
Expected: workflow completes ✓ in ~5–10 min. Both matrix jobs (`cbse-unified` and `cbse-rag`) succeed.

If build fails: examine logs with `gh run view --log-failed`. Common causes: pip dep conflict (revert and retry), GHCR rate limit (retry: `gh run rerun`).

- [ ] **Step 3: Confirm new image was pushed to GHCR**

Run:
```bash
gh api "/users/naveenasri02/packages/container/cbse-unified/versions" --jq '.[0:2] | .[] | {name, updated_at, tags: .metadata.container.tags}'
```
Expected: top entry has tags including `latest` and a sha matching the just-pushed commit, with `updated_at` from the last few minutes.

---

## Task 3: Clean up old RunPod resources

**Files:** none

- [ ] **Step 1: List current pods**

Run: `runpodctl pod list -o json | python -c "import json,sys; [print(p['id'],'|',p.get('name'),'|',p.get('costPerHr')) for p in json.load(sys.stdin)]"`
Expected: shows `3olktdazjc6y7q | cbse-rag-pod | 0.06`. If any other pods, note them.

- [ ] **Step 2: Delete the CPU RAG pod**

Run: `runpodctl pod delete 3olktdazjc6y7q`
Expected: `{"deleted": true, "id": "3olktdazjc6y7q"}`

- [ ] **Step 3: Verify pod is gone**

Run: `runpodctl pod list`
Expected: `[]`

- [ ] **Step 4: List templates and identify stale ones**

Run: `runpodctl template list -o json | python -c "import json,sys; [print(t['id'],'|',t.get('name')) for t in json.load(sys.stdin) if 'cbse' in (t.get('name') or '').lower()]"`
Expected: shows `6kk80jul5k | cbse-rag-pod-tpl` (and possibly `dcjbezorlg | cbse-rag-tpl`, `8vimu54p6n | cbse-llm-template` from earlier serverless attempts).

- [ ] **Step 5: Delete each stale cbse template**

For each id from step 4, run: `runpodctl template delete <id>`
Expected: each returns `{"deleted": true, "id": "..."}`. If a template can't be deleted (still referenced), note it and continue — naming the new template `cbse-unified-pod-tpl` avoids any conflict.

---

## Task 4: Create unified-pod template

**Files:** Create: `C:\Users\saina\.tmp\unified-pod-start-cmd.txt`

- [ ] **Step 1: Write the docker-start-cmd to a file (avoids shell escaping pain)**

Create `C:\Users\saina\.tmp\unified-pod-start-cmd.txt` with content (single line, no trailing newline):
```
bash,-c,/app/entrypoint.sh
```

The image's entrypoint.sh now handles RP_MODE branching. We just need to invoke it.

- [ ] **Step 2: Create the template via runpodctl**

Run from any directory:
```bash
START_CMD=$(cat "C:/Users/saina/.tmp/unified-pod-start-cmd.txt")
MSYS_NO_PATHCONV=1 runpodctl template create \
  --name cbse-unified-pod-tpl \
  --image ghcr.io/naveenasri02/cbse-unified:latest \
  --container-disk-in-gb 30 \
  --volume-in-gb 30 \
  --volume-mount-path /workspace \
  --ports "8000/http" \
  --env '{"RP_MODE":"api","MODEL_NAME":"prithivMLmods/gemma-4-E4B-it-FP8","TRUST_REMOTE_CODE":"1","MAX_MODEL_LEN":"16384","QUANTIZATION":"compressed-tensors","HF_HOME":"/workspace/.hf","HF_HUB_CACHE":"/workspace/.hf/hub","CHROMA_PERSIST_PATH":"/workspace/chroma","VOICE_ENABLED":"false","PYTHONUNBUFFERED":"1"}' \
  --docker-start-cmd "$START_CMD"
```

Expected: JSON response with `"id": "<10-char-id>"`, `"volumeMountPath": "/workspace"` (NOT `C:/Program Files/...`), env contains `"RP_MODE": "api"`.

If `volumeMountPath` shows mangled path: re-check `MSYS_NO_PATHCONV=1` is set. Delete the bad template and recreate.

- [ ] **Step 3: Capture template ID**

From step 2's response, copy the `id` field (e.g., `wl2ubjo1l6`). Save it for the next task.

---

## Task 5: Create A4000 community pod from template

**Files:** none

- [ ] **Step 1: Try A4000 community first (cheapest with reliable stock)**

Run (substitute `<TEMPLATE_ID>` from Task 4):
```bash
MSYS_NO_PATHCONV=1 runpodctl pod create \
  --name cbse-pod \
  --template-id <TEMPLATE_ID> \
  --gpu-id "NVIDIA RTX A4000" \
  --cloud-type COMMUNITY \
  --container-disk-in-gb 30 \
  --volume-in-gb 30 \
  --ports "8000/http"
```

Expected: JSON with `"id": "<14-char-id>"`, `"costPerHr": 0.17`, `"gpuCount": 1`, `"desiredStatus": "RUNNING"`.

- [ ] **Step 2: If A4000 community unavailable, fallback ladder**

If step 1 errors with "no longer any instances available", try in order:
```bash
# Try A5000 community (paradoxically cheaper, more VRAM)
runpodctl pod create --name cbse-pod --template-id <TEMPLATE_ID> --gpu-id "NVIDIA RTX A5000" --cloud-type COMMUNITY --container-disk-in-gb 30 --volume-in-gb 30 --ports "8000/http"

# Then A4500 community
runpodctl pod create --name cbse-pod --template-id <TEMPLATE_ID> --gpu-id "NVIDIA RTX A4500" --cloud-type COMMUNITY --container-disk-in-gb 30 --volume-in-gb 30 --ports "8000/http"

# Last resort: 4090 community (more expensive, $0.34/hr)
runpodctl pod create --name cbse-pod --template-id <TEMPLATE_ID> --gpu-id "NVIDIA GeForce RTX 4090" --cloud-type COMMUNITY --container-disk-in-gb 30 --volume-in-gb 30 --ports "8000/http"
```

Note the `costPerHr` from whichever succeeds. If all fail: switch `--cloud-type SECURE` (more expensive but reliable).

- [ ] **Step 3: Capture pod ID and proxy URL**

From the success response, capture `id` (e.g., `4q848dpd5rp86a`). The proxy URL will be:
`https://<POD_ID>-8000.proxy.runpod.net`

Note this URL — Tasks 6, 7, 8 use it.

---

## Task 6: Wait for pod boot

**Files:** none

- [ ] **Step 1: Initial check (pod just created, container starting)**

Run (substitute `<POD_ID>`):
```bash
KEY=$(grep "^apikey" ~/.runpod/config.toml | sed "s/.*= '//" | sed "s/'$//")
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"query":"query Pod($id:String!){pod(input:{podId:$id}){desiredStatus runtime{uptimeInSeconds ports{privatePort publicPort}}}}","variables":{"id":"<POD_ID>"}}' \
  https://api.runpod.io/graphql | python -m json.tool
```

Expected if still booting: `runtime.uptimeInSeconds` negative or null, `ports` null.
Expected if ready: `runtime.uptimeInSeconds` positive, `ports` includes `privatePort: 8000, publicPort: <some-port>`.

- [ ] **Step 2: Poll every 30s until pod runtime shows ports bound (max ~10 min)**

Manually re-run step 1's command every 30s, OR use this one-liner check:
```bash
for i in $(seq 1 20); do
  PORTS=$(curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"query":"query{pod(input:{podId:\"<POD_ID>\"}){runtime{uptimeInSeconds ports{privatePort}}}}"}' \
    https://api.runpod.io/graphql | python -c "import json,sys; r=json.load(sys.stdin)['data']['pod']['runtime']; print(r.get('uptimeInSeconds','?'),'|',r.get('ports'))")
  echo "[+$((i*30))s] $PORTS"
  if echo "$PORTS" | grep -q "privatePort"; then echo "READY"; break; fi
  sleep 30
done
```

Expected: within 5–10 min, output shows `privatePort: 8000`.

If pod never binds port 8000 after 10 min: image pull failed or container is crash-looping. Check via SSH (Task 6 step 4) or RunPod console logs.

- [ ] **Step 3: Test the proxy URL is reachable**

Run: `curl -s --max-time 10 "https://<POD_ID>-8000.proxy.runpod.net/" -w "\n[HTTP %{http_code}]"`
Expected: `{"detail":"Not Found"}` with HTTP 404 (FastAPI's default 404 — confirms server is running, just no `/` route).

- [ ] **Step 4 (only if pod stuck): SSH in to debug**

Run: `runpodctl ssh info <POD_ID>`
If response shows `"status": "RUNNING"` with SSH details: SSH using the printed command, then check `/tmp/vllm.log` and run `ps aux | grep -E "vllm|python"` to see what's running.

If `"error": "pod not ready"`: container hasn't started; wait more or delete & recreate.

---

## Task 7: Test pod directly (no Vercel)

**Files:** none

- [ ] **Step 1: Test list_documents (no LLM needed — fastest cold-init signal)**

Run:
```bash
curl -s --max-time 60 -X POST "https://<POD_ID>-8000.proxy.runpod.net/runsync" \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"list_documents","session_id":"plan-test"}}' \
  -w "\n[HTTP %{http_code} | %{time_total}s]"
```

Expected: `{"id":"...","status":"COMPLETED","output":[{"type":"documents","documents":[]}]}` with HTTP 200. Time: 20–60s on first call (RAG init), <2s after.

- [ ] **Step 2: Test chat (triggers vLLM cold-start: ~60–120s first time)**

Run:
```bash
curl -s --max-time 180 -X POST "https://<POD_ID>-8000.proxy.runpod.net/runsync" \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"chat","assistant":"general","session_id":"plan-test","history":[],"message":"Reply with exactly: WORKS"}}' \
  -w "\n[HTTP %{http_code} | %{time_total}s]"
```

Expected: `status: "COMPLETED"`, `output` is an array of events including `{type:"llm_start"}`, `{type:"llm_delta", text:"..."}` (containing "WORKS"), `{type:"llm_done"}`. Time: 60–150s first call, <10s subsequent.

If response includes `error` mentioning "VLLM_BASE_URL" or "connection refused": vLLM didn't start inside the pod. SSH in and check `/tmp/vllm.log`.

- [ ] **Step 3: Test chat again to confirm warm worker is fast**

Repeat step 2's exact command. Expected: same response, but time <10s.

If both step 2 and 3 succeed → pod is fully operational. Proceed to Task 8.

---

## Task 8: Update Vercel RUNPOD_API_BASE to new pod

**Files:** none

- [ ] **Step 1: Show current env vars (sanity check)**

Run from `E:\cbse-chatbots\`:
```bash
vercel env ls production
```

Expected: shows `RUNPOD_API_BASE`, `RUNPOD_LLM_ID`, `RUNPOD_MODEL`, `RUNPOD_API_KEY`. Note that `RUNPOD_API_BASE` currently points at the deleted CPU pod URL.

- [ ] **Step 2: Remove old RUNPOD_API_BASE**

Run: `vercel env rm RUNPOD_API_BASE production --yes`
Expected: `Removed Environment Variable`

- [ ] **Step 3: Add new RUNPOD_API_BASE pointing at the unified pod**

Run (substitute `<POD_ID>` from Task 5):
```bash
echo "https://<POD_ID>-8000.proxy.runpod.net" | vercel env add RUNPOD_API_BASE production
```

Expected: `Added Environment Variable RUNPOD_API_BASE to Project slm-chatbot`

- [ ] **Step 4: Verify**

Run: `vercel env ls production | grep RUNPOD_API_BASE`
Expected: shows entry with timestamp from a few seconds ago.

---

## Task 9: Link Vercel project to GitHub for auto-deploys

**Files:** none

- [ ] **Step 1: Check current Vercel ↔ Git link state**

Run from `E:\cbse-chatbots\`:
```bash
vercel git ls 2>&1
```

Expected: either shows the linked GitHub repo, OR says "no Git repository connected".

- [ ] **Step 2: If not linked, connect to GitHub**

If step 1 said no repo connected:
```bash
vercel git connect
```

This will prompt to confirm the GitHub repo (should auto-detect from `git remote -v`). Confirm with `y`.

Expected: `Connected GitHub repository <owner>/<repo> to project slm-chatbot`.

- [ ] **Step 3: Verify production branch setting**

Run: `vercel project inspect slm-chatbot 2>&1 | head -20`
Look for "Production Branch". Should be `main` or `master` (whichever you push to). If it's wrong: change in Vercel dashboard → Settings → Git, or via `vercel git connect --branch main`.

- [ ] **Step 4: (Optional) note that future pushes to production branch will auto-deploy**

No action — informational. From now on, `git push origin main` triggers Vercel deploy automatically.

---

## Task 10: Deploy frontend (one-time manual deploy to apply new RUNPOD_API_BASE)

**Files:** none

- [ ] **Step 1: Trigger production deploy via CLI (since we just changed env)**

Run from `E:\cbse-chatbots\`:
```bash
vercel --prod --yes
```

Expected: deploy completes in 30–60s. Output includes `Production: https://slm-chatbot-<hash>-...vercel.app` and `Aliased: https://matify.tech`.

- [ ] **Step 2: Note the new preview URL**

From step 1's output, capture the `slm-chatbot-<hash>-sai-naveena-sris-projects.vercel.app` URL. We'll use it in Task 11.

---

## Task 11: End-to-end test through Vercel

**Files:** none

- [ ] **Step 1: Test via matify.tech (preferred — no auth wall)**

Run:
```bash
curl -s --max-time 30 -X POST "https://matify.tech/api/runsync" \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"list_documents","session_id":"e2e"}}' \
  -w "\n[HTTP %{http_code} | %{time_total}s]"
```

Expected: `{"output":[{"type":"documents","documents":[]}]}` with HTTP 200.

If `HTTP 000` (DNS doesn't resolve): matify.tech registrar DNS isn't pointing at Vercel. Skip to step 2 and use the preview URL via vercel curl.

- [ ] **Step 2: Test via Vercel preview URL with bypass token (fallback)**

Run (substitute `<PREVIEW_URL>` from Task 10 step 2):
```bash
cd "E:/cbse-chatbots" && vercel curl /api/runsync \
  --deployment <PREVIEW_URL> \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"list_documents","session_id":"e2e"}}'
```

If `vercel curl` syntax fails: use a one-time bypass token from Vercel dashboard → project Settings → Deployment Protection → Protection Bypass for Automation → generate token, then:
```bash
curl -s -X POST "https://<PREVIEW_URL>/api/runsync?x-vercel-protection-bypass=<TOKEN>&x-vercel-set-bypass-cookie=true" \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"list_documents","session_id":"e2e"}}'
```

Expected: same JSON as step 1.

- [ ] **Step 3: Test chat through Vercel**

Run via whichever URL worked in step 1 or 2:
```bash
curl -s --max-time 35 -X POST "<URL>/api/runsync" \
  -H "Content-Type: application/json" \
  -d '{"input":{"op":"chat","assistant":"general","session_id":"e2e","history":[],"message":"Reply with WORKS"}}' \
  -w "\n[HTTP %{http_code}]"
```

Expected on warm pod (vLLM already loaded): events array with `llm_delta` containing "WORKS", HTTP 200.
Expected on cold pod (>22s): the function's "warming up" fallback message — retry within 2 min and it should succeed.

- [ ] **Step 4: Test in browser (manual)**

Open https://matify.tech (or the preview URL) in a browser. Test:
1. Upload a small PDF or text file
2. Refresh document list — uploaded doc should appear
3. Ask a question about the document — should get a streamed response

If browser test passes → Task 11 is complete.

---

## Task 12: Final hardening (post-success)

**Files:** none

- [ ] **Step 1: Set RunPod account spend limit to $5/day**

Open https://www.runpod.io/console/user/billing → Spend Limit → set to `$5/day`.

This is a console action (no CLI). Manual but critical — caps any future misconfiguration at $150/month worst case.

- [ ] **Step 2: Verify pod's persistent state survives restart**

Run:
```bash
runpodctl pod stop <POD_ID>
# wait 30s
runpodctl pod start <POD_ID>
```

Wait for pod to be ready again (Task 6's polling loop). Then re-run Task 7 step 1 (list_documents). Expected: any documents uploaded during testing should still appear (Chroma persisted to /workspace).

- [ ] **Step 3: Update memory with deployment outcome**

Update `C:\Users\saina\.claude\projects\C--Users-saina\memory\project_cbse_chatbots_status.md` with:
- New pod ID and proxy URL
- Cost per hour and per month actuals
- That the GHCR-driven CI build pipeline is operational

(One-liner update only — keep description fresh.)

---

## Self-review

**Spec coverage check:**
- ✅ Single A4000 community pod — Task 5
- ✅ entrypoint.sh RP_MODE switch — Task 1
- ✅ GitHub-driven image build — Tasks 1, 2
- ✅ runpodctl-driven pod deployment — Tasks 4, 5
- ✅ Vercel env update — Task 8
- ✅ Vercel ↔ GitHub link — Task 9
- ✅ End-to-end test via matify.tech — Task 11
- ✅ Cost cap & spend limit — Task 12 step 1
- ✅ Persistence verification — Task 12 step 2

**Placeholder scan:** No TBDs. All commands are concrete, all expected outputs specified. Fallback ladders specified for: GPU stock, vercel curl syntax, DNS resolution.

**Type/name consistency:**
- `RP_MODE` env name consistent (Task 1 sets it in entrypoint.sh, Task 4 sets it in template)
- Pod ID placeholder `<POD_ID>` used consistently across Tasks 5–8, 11
- Template ID placeholder `<TEMPLATE_ID>` used consistently in Tasks 4–5
- Image tag `ghcr.io/naveenasri02/cbse-unified:latest` consistent

**Risks captured:** Each task includes a fallback path. Task 5 has GPU fallback ladder; Task 6 has SSH debug option; Task 11 has DNS+auth fallbacks.
