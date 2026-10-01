"""Latency / RAM of the english checkpoint at larger max_len. Run: uv run --with psutil python maxlen_test.py"""
import json, statistics, time, urllib.request, csv
import laya_benchmark as b

TEXT = b.MEDIUM + " " + " ".join(
    f"Comment {i}: I reproduced this on the staging environment with a different account; the balance table has no row "
    f"for employees hired this year, and the nightly job that creates them did not run since the release. "
    f"A workaround is to insert the row manually, but we need a proper fix and a regression test."
    for i in range(1, 121))


def call(max_len):
    body = {"state": {"body": TEXT}, "questions": {"q": b.Q_WORK}}
    if max_len:
        body["max_len"] = max_len
    req = urllib.request.Request(b.URL + "/v1/systemone", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            d = json.load(r)
        a = d["answers"]["q"]
        return (time.perf_counter() - t0) * 1000, d["usage"]["input_tokens"], a["choice"], a["probabilities"], a["confidence"]
    except urllib.error.HTTPError as e:
        return (time.perf_counter() - t0) * 1000, None, f"HTTP {e.code}: {e.read()[:200]!r}", None, None


b.OUT.mkdir(exist_ok=True)
srv = b.Server("cpu")
srv.wait_ready()
smp = b.Sampler(srv.proc.pid)
smp.start()
rows = []
try:
    for _ in range(3):
        call(None)
    for ml in (None, 1024, 2048, 4096, 8192):
        t0 = time.time()
        res = [call(ml) for _ in range(8)]
        win = smp.window(t0, time.time())
        lat = [r[0] for r in res]
        row = {"max_len": ml or "default(512)", "input_tokens": res[0][1], "p50_ms": round(statistics.median(lat)),
               "min_ms": round(min(lat)), "max_ms": round(max(lat)), "rss_peak_mb": b.agg(win, "rss_mb")[1],
               "cpu_cores_avg": b.agg(win, "proc_cpu_cores")[0], "choice": res[0][2],
               "probabilities": res[0][3], "confidence": res[0][4]}
        rows.append(row)
        print(row, flush=True)
    time.sleep(3)
    print("rss after all:", smp.latest.get("rss_mb"))
finally:
    smp.stop_evt.set()
    srv.stop()
with open(b.OUT / "cpu_maxlen.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, rows[0].keys())
    w.writeheader()
    w.writerows(rows)
