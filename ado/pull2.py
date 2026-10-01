import json, subprocess, urllib.request, urllib.parse, re, html
tok = subprocess.run("az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv", shell=True, capture_output=True, text=True).stdout.strip()
def call(url, body=None):
    r = urllib.request.Request(url, json.dumps(body).encode() if body else None, {"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))
proj = "XT-Smart-Platform"; base = f"https://dev.azure.com/XionTechs/{proj}/_apis/wit"
q = call(base + "/wiql?api-version=7.1&$top=30", {"query": "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('Task','Bug','User Story','Product Backlog Item','Feature','Issue') AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC"})
ids = ",".join(str(w["id"]) for w in q["workItems"])
items = call(base + f"/workitems?ids={ids}&fields=System.Id,System.WorkItemType,System.Title,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.Scheduling.OriginalEstimate,Microsoft.VSTS.Scheduling.StoryPoints,System.State&api-version=7.1")["value"]
strip = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()
out = [{"id": i["id"], "type": i["fields"].get("System.WorkItemType"), "title": i["fields"].get("System.Title", ""),
        "desc": strip(i["fields"].get("System.Description")), "ac": strip(i["fields"].get("Microsoft.VSTS.Common.AcceptanceCriteria")),
        "est": i["fields"].get("Microsoft.VSTS.Scheduling.OriginalEstimate"), "sp": i["fields"].get("Microsoft.VSTS.Scheduling.StoryPoints")} for i in items]
json.dump(out, open("items2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print(len(out), Counter(o["type"] for o in out), "with desc:", sum(bool(o["desc"]) for o in out), "median desc chars:", sorted(len(o["desc"]) for o in out)[len(out)//2])
for o in out: print(o["id"], o["type"], "|", o["title"][:80], "|", len(o["desc"]), "chars | est", o["est"], "sp", o["sp"])
