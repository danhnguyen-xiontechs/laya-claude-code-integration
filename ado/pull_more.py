import json, subprocess, urllib.request, urllib.parse, re, html
from collections import Counter
tok = subprocess.run("az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv", shell=True, capture_output=True, text=True).stdout.strip()
def call(url, body=None):
    r = urllib.request.Request(url, json.dumps(body).encode() if body else None, {"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))
strip = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()
have = {o["id"] for f in ("items.json", "items2.json") for o in json.load(open(f, encoding="utf-8"))}
out = []
for proj, k in (("XTP0008_PXP_Production", 65), ("XT-Smart-Platform", 65)):
    base = f"https://dev.azure.com/XionTechs/{urllib.parse.quote(proj)}/_apis/wit"
    q = call(base + "/wiql?api-version=7.1&$top=2000", {"query": "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Removed' AND [System.WorkItemType] IN ('Task','Bug','User Story','Product Backlog Item','Feature','Issue') ORDER BY [System.ChangedDate] DESC"})
    ids = [w["id"] for w in q["workItems"] if w["id"] not in have]
    step = max(1, len(ids) / k); pick = [ids[int(i * step)] for i in range(min(k, len(ids)))]
    for j in range(0, len(pick), 100):
        for i in call(base + f"/workitems?ids={','.join(map(str, pick[j:j+100]))}&fields=System.Id,System.WorkItemType,System.Title,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.Scheduling.OriginalEstimate,System.Tags&api-version=7.1")["value"]:
            f = i["fields"]
            out.append({"id": i["id"], "project": "PXP" if proj.startswith("XTP") else "SmartPlatform", "type": f.get("System.WorkItemType"), "title": f.get("System.Title", ""),
                        "desc": strip(f.get("System.Description")), "ac": strip(f.get("Microsoft.VSTS.Common.AcceptanceCriteria")), "est": f.get("Microsoft.VSTS.Scheduling.OriginalEstimate")})
json.dump(out, open("items_new.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(out), Counter((o["project"], o["type"]) for o in out), "no desc:", sum(not o["desc"] for o in out))
