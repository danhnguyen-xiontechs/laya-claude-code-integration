# router_proxy.py - Buoc C: proxy tuong thich Anthropic Messages API, chon model bang Laya truoc khi chuyen tiep.
# Chay:  <uv tool dir>\laya\Scripts\python.exe router_proxy.py
# Claude Code:  set ANTHROPIC_BASE_URL=http://localhost:8787
#
# Bien moi truong:
#   ROUTER_UPSTREAM      URL dich (vd https://api.anthropic.com). De trong = dry-run: khong goi LLM, tra loi gia.
#   ROUTER_PORT          mac dinh 8787
#   ROUTER_MIN_PROB      nguong xac suat cao nhat; thap hon thi fallback ve sonnet (mac dinh 0.5)
#   ROUTER_MODE          laya | off (off = chuyen tiep nguyen ven, de do baseline)
#   ROUTER_MODEL_HAIKU / ROUTER_MODEL_SONNET / ROUTER_MODEL_OPUS   model id cua tung tang
#   ROUTER_LOG           file log quyet dinh (JSONL), mac dinh decisions.jsonl canh file nay
import asyncio, hashlib, json, os, re, time
from pathlib import Path

os.environ.setdefault("HF_HOME", r"E:\hf-cache")
os.environ.setdefault("LAYA_DEVICE", "cpu")
os.environ.setdefault("LAYA_MODELS", "english")

import httpx, uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask
from laya import Router

UPSTREAM = os.environ.get("ROUTER_UPSTREAM", "").rstrip("/")
PORT = int(os.environ.get("ROUTER_PORT", "8787"))
MIN_PROB = float(os.environ.get("ROUTER_MIN_PROB", "0.5"))
MODE = os.environ.get("ROUTER_MODE", "laya")
MODELS = {
    "haiku": os.environ.get("ROUTER_MODEL_HAIKU", "claude-haiku-4-5-20251001"),
    "sonnet": os.environ.get("ROUTER_MODEL_SONNET", "claude-sonnet-5-5"),
    "opus": os.environ.get("ROUTER_MODEL_OPUS", "claude-opus-5-5"),
}
FALLBACK = "sonnet"
LOG = Path(os.environ.get("ROUTER_LOG", Path(__file__).parent / "decisions.jsonl"))
MAX_REQUEST_CHARS = 2000  # giu compact state nho (muc tieu duoi ~250 token)

QUESTION = {"model": {
    "type": "choice",
    "instructions": "Which model tier should handle this coding request?",
    "criteria": {
        "haiku": "Trivial, mechanical or lookup task: a small edit in one file, formatting, renaming, a short factual question. No design or debugging needed.",
        "sonnet": "Standard development task: implement a well defined feature, fix a localized bug, write tests or refactor within a few files.",
        "opus": "Hard task: architecture or system design, large migration, root cause analysis across many files or services, security or performance investigation.",
    },
}}

FILE_RE = re.compile(r"[\w./\\-]+\.(?:py|js|jsx|ts|tsx|cs|java|go|rs|rb|php|sql|json|ya?ml|md|css|html|sh|ps1|toml|xml)\b", re.I)
TRACE_RE = re.compile(r"Traceback \(most recent call last\)|^\s+at [\w.$<>]+\(|Exception\b.*:|\bError: .+\n\s+at ", re.M)
HOP_HEADERS = {"host", "content-length", "connection", "transfer-encoding", "keep-alive"}

app = FastAPI(title="Laya routing proxy")
router: Router = None
infer_lock = asyncio.Lock()
sessions: dict[str, dict] = {}  # session key -> quyet dinh da chot
client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15))


def user_texts(body: dict) -> list[str]:
    """Van ban nguoi dung go o tung turn; bo tool_result va system-reminder."""
    out = []
    for m in body.get("messages", []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        blocks = [c] if isinstance(c, str) else [b.get("text", "") for b in c or [] if b.get("type") == "text"]
        text = "\n".join(t for t in blocks if t and not t.lstrip().startswith("<system-reminder>")).strip()
        if text:
            out.append(text)
    return out


def session_key(request: Request, body: dict, texts: list[str]) -> str:
    sid = request.headers.get("x-claude-code-session-id")
    if sid:
        return sid
    # Khong co session id: cau dau tien cua hoi thoai khong doi qua cac turn, dung lam khoa.
    uid = str((body.get("metadata") or {}).get("user_id", ""))
    return hashlib.sha1((uid + "\n" + (texts[0] if texts else "")).encode()).hexdigest()[:16]


def compact_state(texts: list[str]) -> dict:
    req = texts[-1] if texts else ""
    return {"request": req[:MAX_REQUEST_CHARS], "files_mentioned": str(len(set(FILE_RE.findall(req)))),
            "has_stack_trace": "yes" if TRACE_RE.search(req) else "no", "conversation_turns": str(len(texts))}


async def decide(state: dict) -> dict:
    async with infer_lock:
        t = time.perf_counter()
        res = await asyncio.to_thread(router.predict, state, QUESTION, max_len=1024)
        ms = round((time.perf_counter() - t) * 1000)
    probs = res["answers"]["model"]["probabilities"]
    laya_tier = max(probs, key=probs.get)
    gated = probs[laya_tier] < MIN_PROB
    return {"tier": FALLBACK if gated else laya_tier, "laya_tier": laya_tier, "top_prob": probs[laya_tier],
            "fallback": gated, "probabilities": probs, "laya_ms": ms}


def log(entry: dict):
    entry["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


async def route(request: Request, body: dict) -> dict:
    """Tra ve quyet dinh cho request nay; chon mot lan moi session roi giu nguyen."""
    requested = body.get("model", "")
    texts = user_texts(body)
    key = session_key(request, body, texts)
    base = {"session": key, "requested_model": requested, "turns": len(texts)}
    if MODE != "laya":
        d = {**base, "action": "passthrough_mode_off", "model": requested}
    elif "haiku" in requested or not texts:
        # Call nen cua Claude Code (dat tieu de, tom tat...) da dung haiku: khong dung toi.
        d = {**base, "action": "passthrough_background", "model": requested}
    elif key in sessions:
        d = {**base, "action": "sticky", "model": sessions[key]["model"], "tier": sessions[key]["tier"]}
    else:
        state = compact_state(texts)
        dec = await decide(state)
        sessions[key] = {"tier": dec["tier"], "model": MODELS[dec["tier"]]}
        d = {**base, "action": "routed", "model": MODELS[dec["tier"]], **dec,
             "state": {**state, "request": state["request"][:200]}}
    log(dict(d))
    return d


def dry_run_response(model: str, stream: bool, d: dict):
    text = f"[dry-run] routed to {model} ({d['action']})"
    msg = {"id": "msg_dryrun", "type": "message", "role": "assistant", "model": model,
           "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
           "usage": {"input_tokens": 0, "output_tokens": 0}}
    if not stream:
        return JSONResponse(msg)
    events = [
        ("message_start", {"type": "message_start", "message": {**msg, "content": [], "stop_reason": None}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 0}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    sse = "".join(f"event: {e}\ndata: {json.dumps(p)}\n\n" for e, p in events)
    return Response(sse, media_type="text/event-stream")


async def forward(request: Request, path: str, content: bytes):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    req = client.build_request(request.method, f"{UPSTREAM}/{path}", params=request.query_params,
                               headers=headers, content=content)
    up = await client.send(req, stream=True)
    out_headers = {k: v for k, v in up.headers.items() if k.lower() not in HOP_HEADERS}
    return StreamingResponse(up.aiter_raw(), status_code=up.status_code, headers=out_headers,
                             background=BackgroundTask(up.aclose))


@app.post("/v1/messages")
async def messages(request: Request):
    raw = await request.body()
    body = json.loads(raw)
    d = await route(request, body)
    if d["model"] != body.get("model"):
        body["model"] = d["model"]  # chi thay truong model, phan con lai giu nguyen
        raw = json.dumps(body).encode()
    if not UPSTREAM:
        return dry_run_response(d["model"], bool(body.get("stream")), d)
    resp = await forward(request, "v1/messages", raw)
    resp.headers["x-router-model"] = d["model"]
    resp.headers["x-router-action"] = d["action"]
    return resp


@app.get("/router/status")
async def status():
    return {"mode": MODE, "upstream": UPSTREAM or "dry-run", "min_prob": MIN_PROB, "models": MODELS,
            "sessions": sessions, "log": str(LOG)}


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def passthrough(request: Request, path: str):
    if not UPSTREAM:
        return JSONResponse({"type": "error", "error": {"type": "not_found_error", "message": "dry-run: no upstream"}}, 404)
    return await forward(request, path, await request.body())


if __name__ == "__main__":
    print(f"Nap model Laya... (upstream: {UPSTREAM or 'dry-run'}, mode: {MODE}, min_prob: {MIN_PROB})")
    router = Router()
    router.predict({"request": "warm up"}, QUESTION)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
