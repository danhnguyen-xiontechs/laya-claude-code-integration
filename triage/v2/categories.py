# categories.py (v2) - bo nhom theo plan laya_error_triager_mcp_detailed_plan.md muc 7.
# Nhom theo HUONG DEBUG (nen nhin vao dau), khong theo ten loi. Co dinh, khong cho Claude doi.
# Laya cat moi mo ta o 48 token -> giu ngan.
CATEGORIES = {
    "CODE_BUG": "A bug in the project's own code: wrong logic, exception from app code, type or syntax error, failing test due to wrong behaviour.",
    "DEPENDENCY_MISSING": "A required package, library, module or tool is not installed, not restored, or cannot be resolved by the package manager.",
    "ENVIRONMENT": "The machine or runtime environment is not ready: service not running, port in use, connection refused, permission denied, disk or memory.",
    "CONFIGURATION": "Wrong or missing configuration: env variable, settings file, connection string, credentials, project or script setup.",
    "FLAKY_TEST": "A test that fails intermittently due to timing, race conditions, retries or timeouts rather than a clear code defect.",
    "EXPECTED_FAILURE": "The command failed as intended or harmlessly: a check found no matches, nothing to commit, a lint or gate correctly reporting.",
    "BUILD_TOOLCHAIN": "The compiler, bundler, SDK, CLI or build tool itself failed or has a version mismatch, not the project's code.",
    "UNKNOWN": "The output does not show enough information to tell what kind of failure it is.",
}

QUESTION_TEXT = "Classify this build/test/command failure. Which kind of failure is it?"


def question() -> dict:
    return {"type": "choice", "instructions": QUESTION_TEXT, "criteria": CATEGORIES}
