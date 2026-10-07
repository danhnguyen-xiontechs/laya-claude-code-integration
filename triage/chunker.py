# chunker.py - lam sach log loi va cat thanh cac doan de Laya chon doan chua nguyen nhan goc. Regex thuan, < 1 ms.
import re

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
EXIT_RE = re.compile(r"^Exit code -?\d+\s*$")
# Dong mo dau mot khoi loi: noi nen bat dau doan moi
START_RE = re.compile(r"^(Traceback \(most recent call last\)|\S*(Error|Exception)\b|FAIL|✖|not ok\b|error\b|npm (ERR|error)|"
                      r"=+ (FAILURES|ERRORS|short test summary)|[A-Za-z]:?[\\/].*\(\d+,\d+\): error|fatal:)", re.I)

TAIL_LINES = 60      # chi xet phan cuoi log: loi gan nhu luon o cuoi
MAX_CHUNKS = 5
MAX_CHUNK_LINES = 14
MAX_LINE_CHARS = 240


def clean(error_text: str) -> list[str]:
    lines = []
    for ln in ANSI_RE.sub("", error_text).replace("\r", "").split("\n"):
        ln = ln.rstrip()
        if not lines and EXIT_RE.match(ln):
            continue
        if ln and lines and ln == lines[-1]:  # dong lap lien tiep
            continue
        lines.append(ln[:MAX_LINE_CHARS])
    while lines and not lines[-1]:
        lines.pop()
    return lines


def chunk(lines: list[str]) -> list[dict]:
    """Cat TAIL_LINES dong cuoi thanh toi da MAX_CHUNKS doan, uu tien cat o dong mo dau khoi loi / dong trong."""
    base = max(0, len(lines) - TAIL_LINES)
    tail = lines[base:]
    blocks, cur = [], []
    for i, ln in enumerate(tail):
        boundary = cur and (START_RE.match(ln) or not ln.strip() or len(cur) >= MAX_CHUNK_LINES)
        if boundary and any(x.strip() for _, x in cur):
            blocks.append(cur)
            cur = []
        if ln.strip() or cur:
            cur.append((base + i, ln))
    if cur:
        blocks.append(cur)
    # Gop cac khoi nho nhat voi khoi ke tiep cho toi khi con <= MAX_CHUNKS
    while len(blocks) > MAX_CHUNKS:
        j = min(range(len(blocks) - 1), key=lambda k: len(blocks[k]) + len(blocks[k + 1]))
        blocks[j:j + 2] = [blocks[j] + blocks[j + 1]]
    return [{"start": b[0][0] + 1, "end": b[-1][0] + 1, "text": "\n".join(x for _, x in b)} for b in blocks]
