"""Kiem tra hanh vi (thay cho test an khoa cau chu cua PR). Chay trong thu muc repo pxp-ai bang venv cua no.

C1 (co che sua bug): router card cua assignment_results_agent co khoi loai tru ma buoc 2 cua
    prompts/intent_classifier.system.v1.md nhan ra ("NOT for:", "MUST NOT", "Non-examples") va khoi do nhac "rubric".
    Goc: chi co "Do not route here for rubrics..." -> classifier bo qua -> ca hai agent la ung vien -> ambiguous.
C2 (khong tu loai): card cua assignment_rubric_agent khong co khoi loai tru nao chua "rubric".
Card duoc render bang chinh MasterAgent._format_agent_description (lay nguyen van tu file). In JSON ra stdout.
"""
import ast, json, re, textwrap



def class_doc(path, name):
    """Docstring tho cua lop, doc tu ma nguon (khong import: import flow keo theo Azure Key Vault)."""
    for node in ast.walk(ast.parse(open(path, encoding="utf-8").read())):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return ast.get_docstring(node, clean=False) or ""
    return ""


def _load_formatter():
    src = open("ai_agents/core/master_agent.py", encoding="utf-8").read()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.FunctionDef) and node.name == "_format_agent_description":
            ns = {}
            exec(textwrap.dedent(ast.get_source_segment(src, node)), ns)
            return ns["_format_agent_description"]
    raise RuntimeError("formatter not found")


FORMAT = _load_formatter()
MARK = re.compile(r"(^NOT for:|MUST NOT|^Non-example)", re.I)
NAMES = re.compile(r"Assignment(Rubric|Results)\w*|assignment_(rubric|results)_agent")


def exclusion_blocks(text):
    blocks, cur = [], None
    for l in (x.strip() for x in text.splitlines()):
        if MARK.search(l):
            cur = [l]
            blocks.append(cur)
        elif cur is not None and l.startswith(("-", "*")):
            cur.append(l)
        else:
            cur = None
    return [NAMES.sub("", "\n".join(b)) for b in blocks]  # ten lop khong tinh la noi dung


res_blocks = exclusion_blocks(FORMAT(None, "assignment_results_agent", class_doc("ai_agents/flows/assignment_results.py", "AssignmentResultsFlow")))
rub_blocks = exclusion_blocks(FORMAT(None, "assignment_rubric_agent", class_doc("ai_agents/flows/assignment_rubric.py", "AssignmentRubricFlow")))
out = {"C1_results_excludes_rubric": any("rubric" in b.lower() for b in res_blocks),
       "C2_rubric_not_self_excluded": not any("rubric" in b.lower() for b in rub_blocks),
       "results_exclusion_blocks": res_blocks}
out["pass"] = out["C1_results_excludes_rubric"] and out["C2_rubric_not_self_excluded"]
print(json.dumps(out))
