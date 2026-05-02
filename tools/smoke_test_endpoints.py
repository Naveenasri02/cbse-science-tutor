"""Direct smoke-test for split serverless endpoints (no Edge fn, no frontend).

Usage:
  python tools/smoke_test_endpoints.py llm <endpoint_id>
  python tools/smoke_test_endpoints.py rag <endpoint_id>
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

KEY = (Path(__file__).resolve().parent.parent / ".runpod_key").read_text().strip()


def post(url, body):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def submit_and_poll(endpoint_id, payload, max_wait_s=600):
    job = post(f"https://api.runpod.ai/v2/{endpoint_id}/run", payload)
    job_id = job.get("id")
    print(f"  submitted job {job_id} (status={job.get('status')})")
    deadline = time.time() + max_wait_s
    elapsed = 0
    while time.time() < deadline:
        time.sleep(10)
        elapsed += 10
        s = get(f"https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}")
        st = s.get("status")
        print(f"  [+{elapsed}s] {st}")
        if st in ("COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"):
            return s
    return {"status": "TIMEOUT", "id": job_id}


def smoke_llm(endpoint_id):
    """LLM endpoint speaks OpenAI chat-completions via /run wrapper."""
    payload = {
        "input": {
            "openai_route": "/v1/chat/completions",
            "openai_input": {
                "model": "prithivMLmods/gemma-4-E4B-it-FP8",
                "messages": [{"role": "user", "content": "Reply with exactly: WORKS"}],
                "max_tokens": 8,
                "temperature": 0,
            },
        }
    }
    print(f"Smoking LLM endpoint {endpoint_id}...")
    result = submit_and_poll(endpoint_id, payload, max_wait_s=600)
    print("Result:", json.dumps(result, indent=2)[:800])
    if result.get("status") != "COMPLETED":
        sys.exit(f"FAILED: {result.get('status')}")
    out = result.get("output")
    text = ""
    if isinstance(out, list) and out:
        text = out[0].get("choices", [{}])[0].get("message", {}).get("content", "")
    elif isinstance(out, dict):
        text = out.get("choices", [{}])[0].get("message", {}).get("content", "")
    print(f"\nLLM response text: {text!r}")
    if "WORKS" not in text.upper():
        sys.exit("FAILED: response did not contain WORKS")
    print("LLM SMOKE: PASS")


def smoke_rag(endpoint_id):
    """RAG endpoint speaks our op-based handler protocol.

    Test 1: chat with no documents -> expects upload-gate response.
    """
    print(f"Smoking RAG endpoint {endpoint_id} (chat without docs)...")
    result = submit_and_poll(endpoint_id, {
        "input": {
            "op": "chat",
            "assistant": "general",
            "session_id": "smoke",
            "history": [],
            "message": "hello",
        }
    }, max_wait_s=600)
    print("Result:", json.dumps(result, indent=2)[:800])
    if result.get("status") != "COMPLETED":
        sys.exit(f"FAILED: {result.get('status')}")
    events = result.get("output") or []
    text = "".join(e.get("text", "") for e in events if e.get("type") == "llm_delta")
    print(f"\nRAG chat-without-docs response: {text[:200]!r}")
    if "upload" not in text.lower() and "document" not in text.lower():
        sys.exit("FAILED: expected upload-gate response, got something else")
    print("RAG SMOKE: PASS")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    target, endpoint_id = sys.argv[1], sys.argv[2]
    if target == "llm":
        smoke_llm(endpoint_id)
    elif target == "rag":
        smoke_rag(endpoint_id)
    else:
        sys.exit("first arg must be 'llm' or 'rag'")
