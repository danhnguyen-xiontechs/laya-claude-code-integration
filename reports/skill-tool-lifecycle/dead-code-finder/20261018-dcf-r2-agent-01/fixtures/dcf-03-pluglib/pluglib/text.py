import re
import unicodedata

WS = re.compile(r"\s+")
MAX_LEN = 10_000


def normalize(text):
    return WS.sub(" ", text).strip()


def strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))


def truncate(text, n=80):
    return text[:n]
