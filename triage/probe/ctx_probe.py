# ctx_probe.py - kiem tra PostToolUseFailure co dua additionalContext vao context cua Claude khong.
import json, sys
sys.stdin.read()
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUseFailure",
                                         "additionalContext": "[Laya triage] marker ZEBRA-4417"}}))
