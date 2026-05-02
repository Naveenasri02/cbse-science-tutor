"""Deploy Gemma 4 26B AWQ to RunPod Serverless via the vLLM template.

Reads the RunPod API key from `E:\\cbse-chatbots\\.runpod_key` (single line, just the key).
Creates a serverless endpoint named `cbse-llm` with the locked-in settings:
  - GPU: RTX 4090 24 GB
  - Image: vllm/vllm-openai:dev322 (avoids Gemma 4 MoE regression in 0.19.1)
  - Model: cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit
  - Workers: min=0, max=3
  - FlashBoot: ON
  - Idle timeout: 5s
  - Container disk: 30 GB
  - Env: MODEL_NAME, TRUST_REMOTE_CODE, MAX_MODEL_LEN, DTYPE
  - DOES NOT pass --quantization (model uses compressed-tensors, vLLM auto-detects)

Run: python tools/deploy_runpod_llm.py
"""
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

KEY_FILE = Path(__file__).resolve().parent.parent / ".runpod_key"
GRAPHQL_URL = "https://api.runpod.io/graphql"

ENDPOINT_NAME = "cbse-llm-v2"
DOCKER_IMAGE = "runpod/worker-v1-vllm:v2.14.0"
# Gemma 4 E4B FP8 = pre-quantized E4B in compressed-tensors format.
# ~5 GB on disk vs ~9 GB unquantized. Cold start ~30-60s on RTX 4090.
# Quantization handled by vLLM's compressed-tensors loader (no runtime quant).
MODEL_ID = "prithivMLmods/gemma-4-E4B-it-FP8"

ENV_VARS = {
    "MODEL_NAME": MODEL_ID,
    "TRUST_REMOTE_CODE": "1",
    "MAX_MODEL_LEN": "16384",
    "DTYPE": "auto",
    "QUANTIZATION": "compressed-tensors",
}

# RunPod GPU pool ID. ADA_24 = Ada Lovelace 24GB pool (RTX 4090, L4, etc.)
# Other pools: AMPERE_24 (RTX 3090 / A5000), ADA_48_PRO (RTX 6000 Ada), AMPERE_80 (A100), HOPPER_141 (H200)
GPU_POOL_ID = "ADA_24"


def gql(api_key: str, query: str, variables: dict | None = None) -> dict:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = Request(
        GRAPHQL_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cbse-deploy-script/1.0",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"GraphQL HTTP {e.code}: {body}")


def find_existing_endpoint(api_key: str, name: str) -> str | None:
    q = """
    query MyEndpoints {
      myself {
        endpoints {
          id
          name
        }
      }
    }
    """
    data = gql(api_key, q)
    if "errors" in data:
        raise SystemExit(f"Failed to list endpoints: {data['errors']}")
    for ep in data.get("data", {}).get("myself", {}).get("endpoints", []) or []:
        if ep.get("name") == name:
            return ep["id"]
    return None


def list_gpu_types(api_key: str) -> list[dict]:
    q = """
    query GpuTypes {
      gpuTypes {
        id
        displayName
        memoryInGb
        secureCloud
        communityCloud
      }
    }
    """
    data = gql(api_key, q)
    return data.get("data", {}).get("gpuTypes", []) or []


def pick_gpu_id(api_key: str, preferred_display_name: str) -> str:
    types = list_gpu_types(api_key)
    for t in types:
        if t.get("displayName") == preferred_display_name:
            return t["id"]
    # Fall back to fuzzy match
    for t in types:
        dn = (t.get("displayName") or "").upper()
        if "4090" in dn:
            print(f"  ! exact match for '{preferred_display_name}' not found; using '{t['displayName']}' (id={t['id']})")
            return t["id"]
    raise SystemExit(
        "Could not find an RTX 4090 GPU type in your account. "
        "Available: " + ", ".join(t.get("displayName", "?") for t in types[:20])
    )


def env_to_input(env: dict) -> list[dict]:
    return [{"key": k, "value": v} for k, v in env.items()]


def create_endpoint(api_key: str, gpu_id: str) -> dict:
    # The saveEndpoint mutation is the standard path for creating serverless endpoints.
    # Schema fields that matter: name, gpuIds (CSV), workersMin, workersMax, idleTimeout,
    # scalerType, scalerValue, executionTimeoutMs, env, dockerImage, containerDiskInGb,
    # flashboot (sometimes called "fastBoot" in newer schemas).
    q = """
    mutation SaveEndpoint($input: EndpointInput!) {
      saveEndpoint(input: $input) {
        id
        name
        workersMin
        workersMax
      }
    }
    """
    inp = {
        "name": ENDPOINT_NAME,
        "gpuIds": gpu_id,
        "workersMin": 0,
        "workersMax": 3,
        "idleTimeout": 5,
        "scalerType": "QUEUE_DELAY",
        "scalerValue": 4,
        "executionTimeoutMs": 600000,
        "template": {
            "name": f"{ENDPOINT_NAME}-template",
            "imageName": DOCKER_IMAGE,
            "containerDiskInGb": 30,
            "env": env_to_input(ENV_VARS),
            "dockerArgs": "",
        },
    }
    data = gql(api_key, q, {"input": inp})
    if "errors" in data:
        raise SystemExit(f"Failed to create endpoint: {json.dumps(data['errors'], indent=2)}")
    return data["data"]["saveEndpoint"]


def main():
    if not KEY_FILE.exists():
        raise SystemExit(
            f"API key file not found at {KEY_FILE}.\n"
            "Create it with your RunPod API key (single line, no other text)."
        )
    api_key = KEY_FILE.read_text().strip()
    if not api_key or len(api_key) < 20:
        raise SystemExit("API key in .runpod_key looks invalid (too short or empty).")

    print(f"-> Checking for existing endpoint named '{ENDPOINT_NAME}'...")
    existing = find_existing_endpoint(api_key, ENDPOINT_NAME)
    if existing:
        print(f"  Endpoint already exists: id={existing}")
        print(f"  URL: https://api.runpod.ai/v2/{existing}")
        print(f"  Visit https://www.runpod.io/console/serverless/user/endpoint/{existing} to inspect or delete.")
        print(f"  Refusing to overwrite. If you want a fresh deploy, delete it in the console first.")
        return

    print(f"-> Creating serverless endpoint '{ENDPOINT_NAME}'...")
    print(f"  Image:  {DOCKER_IMAGE}")
    print(f"  Model:  {MODEL_ID}")
    print(f"  GPU:    {GPU_POOL_ID} (RTX 4090 24 GB Ada pool)")
    print(f"  Scale:  min=0, max=3, idleTimeout=5s")
    ep = create_endpoint(api_key, GPU_POOL_ID)

    print()
    print("[OK] Endpoint created.")
    print(f"  id:   {ep['id']}")
    print(f"  name: {ep['name']}")
    print()
    print("Set these in your backend pod's environment:")
    print(f"  VLLM_BASE_URL=https://api.runpod.ai/v2/{ep['id']}/openai/v1")
    print(f"  VLLM_API_KEY=<the-same-runpod-api-key-from-.runpod_key>")
    print(f"  VLLM_MODEL={MODEL_ID}")
    print(f"  VOICE_ENABLED=false")
    print()
    print("Smoke test (will trigger first cold start, ~5–8 min initial build):")
    print(f"""  curl -X POST "https://api.runpod.ai/v2/{ep['id']}/openai/v1/chat/completions" \\
    -H "Authorization: Bearer <your-runpod-api-key>" \\
    -H "Content-Type: application/json" \\
    -d '{{"model":"{MODEL_ID}","messages":[{{"role":"user","content":"Say works"}}],"max_tokens":8}}'""")


if __name__ == "__main__":
    main()
