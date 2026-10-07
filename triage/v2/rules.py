# rules.py (v2) - baseline luat don gian theo plan muc 16 ("intentionally simple").
# Viet va commit TRUOC khi xem bat ky log nao trong dataset v2; KHONG duoc sua sau khi thay du lieu.
# Thu tu quan trong: luat dau tien khop thang. Khong khop -> UNKNOWN.
import re

RULES = [
    ("DEPENDENCY_MISSING", r"module not found|no module named|cannot find module|package not found|could not resolve|not installed|command not found|is not recognized"),
    ("ENVIRONMENT", r"connection refused|econnrefused|address already in use|eaddrinuse|permission denied|access is denied|eacces|out of memory"),
    ("CONFIGURATION", r"authentication failed|unauthorized|environment variable|config|connection string|missing script"),
    ("FLAKY_TEST", r"flaky|retrying|timed? ?out|timeout"),
    ("BUILD_TOOLCHAIN", r"sdk|toolchain|compiler crashed|webpack|vite|msbuild"),
    ("CODE_BUG", r"exception|error|assert|failed|traceback"),
]


def classify(text: str) -> str:
    for cat, pat in RULES:
        if re.search(pat, text, re.I):
            return cat
    return "UNKNOWN"
