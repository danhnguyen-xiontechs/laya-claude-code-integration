import json, subprocess, urllib.request, urllib.parse, time
tok = subprocess.run("az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv", shell=True, capture_output=True, text=True).stdout.strip()
B = "https://dev.azure.com/XionTechs/XTP0008_PXP_Production/_apis"
def get(u):
    for k in range(5):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": "Bearer " + tok})))
        except urllib.error.HTTPError as e:
            if e.code in (429, 503): time.sleep(3 * (k + 1)); continue
            if e.code == 404: return None
            raise
items = {}
for f in ["items.json", "items2.json", "items_new.json"]:
    for it in json.load(open("D:/XionTechs/Laya/ado/" + f, encoding="utf-8")): items[it["id"]] = it
repos = {r["id"]: r["name"] for r in get(B + "/git/repositories?api-version=7.1")["value"]}
print("REPOS:", ", ".join(repos.values()))
ids = sorted(items); rows = []
for k in range(0, len(ids), 200):
    for w in get(f"{B}/wit/workitems?ids={','.join(map(str, ids[k:k+200]))}&$expand=relations&api-version=7.1")["value"]:
        f = w["fields"]
        prs = [urllib.parse.unquote(r["url"]) for r in (w.get("relations") or []) if r["rel"] == "ArtifactLink" and "PullRequestId" in urllib.parse.unquote(r["url"])]
        for p in prs:
            _, repo_id, pr_id = p.split("/")[-3:]
            pr = get(f"{B}/git/repositories/{repo_id}/pullrequests/{pr_id}?api-version=7.1") or {"status": "not_found", "title": ""}
            files = None
            if pr["status"] == "completed" and pr.get("lastMergeCommit"):
                ch = get(f"{B}/git/repositories/{repo_id}/commits/{pr['lastMergeCommit']['commitId']}/changes?api-version=7.1")
                files = sum(1 for c in ch.get("changes", []) if c["item"].get("gitObjectType") == "blob")
            rows.append({"wi": w["id"], "type": f["System.WorkItemType"], "state": f["System.State"], "title": f["System.Title"],
                         "repo": repos.get(repo_id, repo_id), "pr": int(pr_id), "pr_status": pr["status"], "pr_title": pr["title"],
                         "merge": (pr.get("lastMergeCommit") or {}).get("commitId"), "target": pr.get("targetRefName"),
                         "closed": (pr.get("closedDate") or "")[:10], "files": files, "has_desc": bool(items[w["id"]].get("desc"))})
json.dump(rows, open("C:/Users/ADMIN/AppData/Local/Temp/claude/D--XionTechs-Laya/3a889ef9-fd46-4eef-a316-eb0858596f2b/scratchpad/wi_prs.json", "w", encoding="utf-8"), indent=1)
print(f"{len(items)} work items, {len({r['wi'] for r in rows})} có PR link, {len(rows)} PR link")
for r in sorted(rows, key=lambda r: (r["pr_status"] != "completed", r["state"])):
    print(f"#{r['wi']} {r['type']}/{r['state']} desc={'Y' if r['has_desc'] else 'N'} | {r['repo']} PR{r['pr']} {r['pr_status']} {r['closed']} files={r['files']} | {r['title'][:60]}")
