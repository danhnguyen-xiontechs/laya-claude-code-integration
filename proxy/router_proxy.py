# router_proxy.py - Buoc C: proxy tuong thich Anthropic Messages API, chon model bang Laya truoc khi chuyen tiep.
# Chay:  <uv tool dir>\laya\Scripts\python.exe router_proxy.py
# Claude Code:  set ANTHROPIC_BASE_URL=http://localhost:8787
#
# Bien moi truong:
#   ROUTER_UPSTREAM      URL dich (vd https://api.anthropic.com). De trong = dry-run: khong goi LLM, tra loi gia.
#   ROUTER_PORT          mac dinh 8787
#   ROUTER_MIN_PROB      nguong xac suat cao nhat; thap hon thi fallback ve sonnet (mac dinh 0.5)
#   ROUTER_MODE          laya | llm | off  (llm = Haiku lam router, baseline B; off = chuyen tiep nguyen ven, baseline A)
#   ROUTER_REEVAL        1 (mac dinh): moi cau moi cua nguoi dung duoc Laya danh gia lai, chi nang tang khong ha; 0 = chon 1 lan
#   ROUTER_ALLOW_API_KEY 1 de cho request mang x-api-key di qua (mac dinh tu choi: tranh tinh tien theo token)
#   ROUTER_MODEL_HAIKU / ROUTER_MODEL_SONNET / ROUTER_MODEL_OPUS   model id cua tung tang
#   ROUTER_LOG           file log quyet dinh (JSONL), mac dinh decisions.jsonl canh file nay
import asyncio, hashlib, json, os, re, time
from pathlib import Path

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
    "opus": os.environ.get("ROUTER_MODEL_OPUS", "claude-opus-5"),  # ID Claude Code dang gui (ban 1m), da chay that
}
FALLBACK = "sonnet"
TIER_RANK = {"haiku": 0, "sonnet": 1, "opus": 2}
LAYA_CHECKPOINT = os.environ.get("ROUTER_LAYA_CHECKPOINT", "english")  # "auto" = de Laya tu chon theo ngon ngu
if LAYA_CHECKPOINT == "auto":
    LAYA_CHECKPOINT = None
MAX_OUTPUT = {"haiku": 64000}  # gioi han output token cua model dich (quan sat tu loi 400)
REEVAL = os.environ.get("ROUTER_REEVAL", "1") == "1"  # danh gia lai o moi cau moi cua nguoi dung, chi nang tang
ALLOW_API_KEY = os.environ.get("ROUTER_ALLOW_API_KEY") == "1"
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


async def decide_llm(state: dict, headers: dict) -> dict:
    """Baseline B: Haiku lam router, cung cau hoi va criteria nhu Laya, di qua cung OAuth cua goi thue bao."""
    crit = "\n".join(f"- {k}: {v}" for k, v in QUESTION["model"]["criteria"].items())
    body = {"model": MODELS["haiku"], "max_tokens": 5, "temperature": 0,
            "system": "You route coding requests to a model tier. Reply with exactly one word: haiku, sonnet or opus.\n" + crit,
            "messages": [{"role": "user", "content": "Request:\n" + state["request"]
                          + "\n\nWhich model tier should handle this coding request?"}]}
    h = {k: v for k, v in headers.items() if k in ("authorization", "anthropic-version", "user-agent", "x-app")}
    h.update({"anthropic-beta": "oauth-2025-04-20", "content-type": "application/json", "accept-encoding": "identity"})
    t = time.perf_counter()
    r = await client.post(f"{UPSTREAM}/v1/messages", json=body, headers=h)
    ms = round((time.perf_counter() - t) * 1000)
    if r.status_code != 200:
        return {"tier": FALLBACK, "fallback": True, "top_prob": None, "router_ms": ms, "router_error": r.text[:200]}
    data = r.json()
    text = (data.get("content") or [{}])[0].get("text", "").strip().lower()
    tier = next((t for t in ("haiku", "sonnet", "opus") if t in text), None)
    u = data.get("usage", {})
    return {"tier": tier or FALLBACK, "fallback": tier is None, "top_prob": None, "router_ms": ms, "router_raw": text[:30],
            "router_tokens": {"in": u.get("input_tokens"), "cache_read": u.get("cache_read_input_tokens"),
                              "cache_new": u.get("cache_creation_input_tokens"), "out": u.get("output_tokens")}}


async def decide(state: dict, headers: dict | None = None) -> dict:
    if MODE == "llm":
        return await decide_llm(state, headers or {})
    async with infer_lock:
        t = time.perf_counter()
        # Ep checkpoint english ke ca voi tieng Viet: checkpoint multilingual xep gan nhu moi cau tieng Viet vao
        # haiku (3/8 dung, tat ca deu "haiku" trong thu nghiem 2026-10-01), english cho 5/8 va sai theo huong nang tang.
        res = await asyncio.to_thread(router.predict, state, QUESTION, model=LAYA_CHECKPOINT, max_len=1024)
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
    if MODE not in ("laya", "llm"):
        d = {**base, "action": "passthrough_mode_off", "model": requested}
    elif not body.get("tools") or not texts:
        # Khong co tool = call phu cua Claude Code (dat tieu de, tom tat, preflight...), khong phai vong lap agent.
        # Khong dung toi. (Khong dung "model la haiku" lam dau hieu: khi --resume, Claude Code tu gui lai
        # model ma proxy da chon o luot truoc, nen request chinh cung co the mang haiku.)
        d = {**base, "action": "passthrough_aux", "model": requested}
    elif key in sessions:
        s = sessions[key]
        if REEVAL and len(texts) > s["turns"]:
            # Cau moi cua nguoi dung (khong phai vong tool): danh gia lai. Chi nang tang, khong ha:
            # cau dau thuong la "hi" / cau hoi nho, task that den sau; ha tang giua chung thi mat cache ma
            # khong duoc gi. Nang tang chap nhan mat cache vi route thap hon can la rui ro chat luong.
            s["turns"] = len(texts)
            state = compact_state(texts)
            dec = await decide(state, dict(request.headers))
            if TIER_RANK[dec["tier"]] > TIER_RANK[s["tier"]]:
                s.update(tier=dec["tier"], model=MODELS[dec["tier"]])
                d = {**base, "action": "upgraded", "model": s["model"], **dec,
                     "state": {**state, "request": state["request"][:200]}}
            else:
                d = {**base, "action": "sticky_reeval", "model": s["model"], "tier": s["tier"],
                     "reeval_tier": dec["tier"], "reeval_prob": dec["top_prob"]}
        else:
            d = {**base, "action": "sticky", "model": s["model"], "tier": s["tier"]}
    else:
        state = compact_state(texts)
        dec = await decide(state, dict(request.headers))
        sessions[key] = {"tier": dec["tier"], "model": MODELS[dec["tier"]], "turns": len(texts)}
        d = {**base, "action": "routed", "model": MODELS[dec["tier"]], **dec,
             "state": {**state, "request": state["request"][:200]}}
    # Hinh dang request, de hieu cac call phu cua Claude Code va vi sao mot so bi 400 sau khi doi model.
    d["shape"] = {"stream": bool(body.get("stream")), "max_tokens": body.get("max_tokens"),
                  "thinking": (body.get("thinking") or {}).get("type"), "tools": len(body.get("tools") or []),
                  "system_chars": len(json.dumps(body.get("system", ""))), "msgs": len(body.get("messages") or []),
                  "extra_keys": sorted(set(body) - {"model", "messages", "system", "max_tokens", "stream", "tools",
                                                    "thinking", "metadata", "temperature", "stop_sequences", "tool_choice"}),
                  "beta": request.headers.get("anthropic-beta", "")}
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


def tier_of(model: str) -> str | None:
    m = (model or "").lower()
    return next((t for t in ("haiku", "sonnet", "opus") if t in m), None)


def adapt_for_model(headers: dict, body: dict, tier: str) -> list[str]:
    """Khi doi model, bo nhung gi model dich khong nhan (neu khong, Claude Code tu thu lai 3 lan, moi lan 1 loi 400).
    Quan sat 2026-10-01: Sonnet nhan moi thu Claude Code gui cho Opus; Haiku 4.5 tu choi 4 thu duoi day."""
    changes = []
    if tier != "haiku":
        return changes
    drop_betas = ("context-1m", "effort-", "mid-conversation-system")
    beta = [t.strip() for t in headers.get("anthropic-beta", "").split(",") if t.strip()]
    kept = [t for t in beta if not t.startswith(drop_betas)]
    if len(kept) != len(beta):
        changes.append("drop beta " + ",".join(t for t in beta if t not in kept))
        if kept:
            headers["anthropic-beta"] = ",".join(kept)
        else:
            headers.pop("anthropic-beta", None)
    oc = body.get("output_config")
    if isinstance(oc, dict) and "effort" in oc:
        oc.pop("effort")
        if not oc:
            body.pop("output_config")
        changes.append("drop output_config.effort")
    # Claude Code tuong tac gui max_tokens cua Opus (128k); Haiku 4.5 toi da 64k.
    if isinstance(body.get("max_tokens"), int) and body["max_tokens"] > MAX_OUTPUT["haiku"]:
        changes.append(f"max_tokens {body['max_tokens']}->{MAX_OUTPUT['haiku']}")
        body["max_tokens"] = MAX_OUTPUT["haiku"]
    if (body.get("thinking") or {}).get("type") == "adaptive":
        # Khong tat han: context_management cua Claude Code (clear_thinking) doi hoi thinking enabled/adaptive.
        budget = max(1024, min(4096, int(body.get("max_tokens") or 8192) - 1))
        body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        changes.append(f"thinking adaptive->enabled({budget})")
    n = 0
    for m in body.get("messages", []):
        if m.get("role") == "system":
            m["role"] = "user"  # API gop cac user message lien tiep; noi dung khong mat
            m.pop("output_config", None)  # chi duoc phep o role system
            n += 1
    if n:
        changes.append(f"{n} system-role message(s) -> user")
    return changes


class UsageTap:
    """Doc model that va usage tu response (SSE hoac JSON) trong luc chuyen tiep nguyen ven cho client."""

    def __init__(self, session: str, status: int, stream: bool):
        self.session, self.status, self.stream = session, status, stream
        self.buf, self.info, self.t0, self.encoding = b"", {}, time.perf_counter(), None

    def _take(self, msg: dict):
        if msg.get("model"):
            self.info["model_actual"] = msg["model"]
        u = msg.get("usage") or {}
        for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"):
            if u.get(k) is not None:
                self.info[k] = u[k]

    def feed(self, chunk: bytes):
        self.buf += chunk
        if not self.stream:
            return
        while b"\n\n" in self.buf:
            event, self.buf = self.buf.split(b"\n\n", 1)
            for line in event.splitlines():
                if line.startswith(b"data:"):
                    try:
                        p = json.loads(line[5:])
                    except ValueError:
                        continue
                    if p.get("type") == "message_start":
                        self._take(p.get("message", {}))
                    elif p.get("type") == "message_delta":
                        self._take(p)
                    elif p.get("type") == "error":
                        self.info["error"] = p.get("error", {}).get("message", "")[:200]

    def finish(self):
        if not self.stream or not self.info:  # loi tra ve JSON ke ca khi stream=true
            try:
                p = json.loads(self.buf)
                self._take(p)
                if p.get("type") == "error":
                    self.info["error"] = p.get("error", {}).get("message", "")[:200]
            except ValueError:
                pass
        if not self.info:  # khong doc duoc gi: ghi dau body de debug
            self.info["raw_head"] = self.buf[:300].decode("utf-8", "replace")
        log({"session": self.session, "action": "usage", "status": self.status, "encoding": self.encoding,
             "duration_ms": round((time.perf_counter() - self.t0) * 1000), **self.info})


async def forward(request: Request, path: str, content: bytes, headers: dict | None = None,
                  tap: UsageTap | None = None):
    # Chot chan chi phi: API key = tinh tien theo token. Chi cho di qua dang nhap goi thue bao (OAuth).
    if request.headers.get("x-api-key") and not ALLOW_API_KEY:
        return JSONResponse({"type": "error", "error": {"type": "permission_error", "message":
                            "router: request carries an API key (pay-per-token); refused. Set ROUTER_ALLOW_API_KEY=1 to allow."}}, 403)
    if headers is None:
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    if tap is not None:
        headers["accept-encoding"] = "identity"  # can doc duoc body de ghi usage (httpx tu them gzip neu bo trong)
    req = client.build_request(request.method, f"{UPSTREAM}/{path}", params=request.query_params,
                               headers=headers, content=content)
    up = await client.send(req, stream=True)
    out_headers = {k: v for k, v in up.headers.items() if k.lower() not in HOP_HEADERS}

    async def body():
        try:
            async for chunk in up.aiter_raw():
                if tap is not None:
                    tap.feed(chunk)
                yield chunk
        finally:
            if tap is not None:
                tap.status = up.status_code
                tap.encoding = up.headers.get("content-encoding")
                tap.finish()

    return StreamingResponse(body(), status_code=up.status_code, headers=out_headers,
                             background=BackgroundTask(up.aclose))


@app.post("/v1/messages")
async def messages(request: Request):
    raw = await request.body()
    body = json.loads(raw)
    d = await route(request, body)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    if d.get("tier") and d["tier"] == tier_of(body.get("model")):
        d["model"] = body["model"]  # cung tang voi model dang yeu cau: giu nguyen request
        d["action"] += "_same_tier"
    if d["model"] != body.get("model"):
        body["model"] = d["model"]  # chi thay truong model, phan con lai giu nguyen
        changes = adapt_for_model(headers, body, d.get("tier") or tier_of(d["model"]))
        if changes:
            log({"session": d["session"], "action": "adapted", "model": d["model"], "changes": changes})
        raw = json.dumps(body).encode()
    if not UPSTREAM:
        return dry_run_response(d["model"], bool(body.get("stream")), d)
    tap = UsageTap(d["session"], 0, bool(body.get("stream")))
    resp = await forward(request, "v1/messages", raw, headers, tap)
    resp.headers["x-router-model"] = d["model"]
    resp.headers["x-router-action"] = d["action"]
    return resp


@app.post("/router/config")
async def config(request: Request):
    global MODE, MIN_PROB, REEVAL
    body = await request.json()
    if "mode" in body:
        MODE = body["mode"]
    if "min_prob" in body:
        MIN_PROB = float(body["min_prob"])
    if "reeval" in body:
        REEVAL = bool(body["reeval"])
    if body.get("clear_sessions"):
        sessions.clear()
    return {"mode": MODE, "min_prob": MIN_PROB, "reeval": REEVAL, "sessions": len(sessions)}


@app.get("/router/status")
async def status():
    return {"mode": MODE, "upstream": UPSTREAM or "dry-run", "min_prob": MIN_PROB, "reeval": REEVAL, "models": MODELS,
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
