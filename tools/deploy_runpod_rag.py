"""Create the CPU-only RAG serverless endpoint via RunPod REST API.

Reads .runpod_key and .llm_endpoint_id from project root. Idempotent: if
cbse-rag exists, prints its id and exits without creating duplicates.
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY = (ROOT / ".runpod_key").read_text().strip()
LLM_ENDPOINT_ID = (ROOT / ".llm_endpoint_id").read_text().strip()

ENDPOINT_NAME = "cbse-rag"
TEMPLATE_NAME = "cbse-rag-template"
IMAGE = "ghcr.io/naveenasri02/cbse-rag:latest"

ENV_VARS = {
    "VLLM_BASE_URL": f"https://api.runpod.ai/v2/{LLM_ENDPOINT_ID}/openai/v1",
    "VLLM_API_KEY": KEY,
    "VLLM_MODEL": "prithivMLmods/gemma-4-E4B-it-FP8",
    "VOICE_ENABLED": "false",
    "PYTHONUNBUFFERED": "1",
}


def http(method, path, body=None):
    url = f"https://rest.runpod.io/v1{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"REST {method} {path} -> {e.code}: {body_txt[:500]}")


def find_endpoint(name):
    eps = http("GET", "/endpoints")
    for ep in eps if isinstance(eps, list) else []:
        if ep.get("name") == name:
            return ep
    return None


def find_template(name):
    tpls = http("GET", "/templates")
    for t in tpls if isinstance(tpls, list) else []:
        if t.get("name") == name:
            return t
    return None


def main():
    print(f"-> LLM endpoint id: {LLM_ENDPOINT_ID}")
    print(f"-> Checking for existing endpoint '{ENDPOINT_NAME}'...")
    existing = find_endpoint(ENDPOINT_NAME)
    if existing:
        print(f"  Endpoint already exists: id={existing['id']}")
        (ROOT / ".rag_endpoint_id").write_text(existing["id"])
        return

    print(f"-> Checking for existing template '{TEMPLATE_NAME}'...")
    tpl = find_template(TEMPLATE_NAME)
    if not tpl:
        print(f"-> Creating template '{TEMPLATE_NAME}'...")
        tpl = http("POST", "/templates", {
            "name": TEMPLATE_NAME,
            "imageName": IMAGE,
            "containerDiskInGb": 10,
            "env": ENV_VARS,
            "isServerless": True,
            "ports": [],
            "volumeMountPath": "/runpod-volume",
        })
        print(f"  Created template id={tpl['id']}")
    else:
        print(f"  Template exists id={tpl['id']}")

    print(f"-> Creating endpoint '{ENDPOINT_NAME}' (CPU serverless)...")
    ep = http("POST", "/endpoints", {
        "name": ENDPOINT_NAME,
        "templateId": tpl["id"],
        "computeType": "CPU",
        "workersMin": 0,
        "workersMax": 5,
        "idleTimeout": 5,
        "scalerType": "QUEUE_DELAY",
        "scalerValue": 4,
        "executionTimeoutMs": 600000,
        "flashboot": True,
    })
    print(f"  Created endpoint id={ep['id']}")
    (ROOT / ".rag_endpoint_id").write_text(ep["id"])

    print()
    print("[OK] RAG endpoint created.")
    print(f"  id:    {ep['id']}")
    print(f"  name:  {ep['name']}")
    print(f"  url:   https://api.runpod.ai/v2/{ep['id']}/run")
    print(f"  Vercel env update needed: RUNPOD_LLM_ID={ep['id']}")


if __name__ == "__main__":
    main()
