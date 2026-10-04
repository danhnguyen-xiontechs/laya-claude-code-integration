# laya_common.py - phan dung chung cho proxy (proxy/router_proxy.py) va hook chon model theo buoc.
# Chi dung thu vien chuan: hook phai khoi dong nhanh, khong duoc import laya/fastapi.
import re

TIERS = ("haiku", "sonnet", "opus")
TIER_RANK = {t: i for i, t in enumerate(TIERS)}

# Cau hoi va criteria khong doi so voi cac bai test truoc (routing/run_routing.py, ado/), de so sanh duoc.
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
MAX_REQUEST_CHARS = 2000  # giu compact state nho (muc tieu duoi ~250 token)


def compact_state(request_text: str, turns: int = 1, step: str | None = None) -> dict:
    """State gui cho Laya: cau yeu cau (hoac brief cua subagent) + vai tin hieu dem duoc. Khong goi LLM."""
    s = {"request": request_text[:MAX_REQUEST_CHARS],
         "files_mentioned": str(len(set(FILE_RE.findall(request_text)))),
         "has_stack_trace": "yes" if TRACE_RE.search(request_text) else "no",
         "conversation_turns": str(turns)}
    if step:
        s["step"] = step
    return s
