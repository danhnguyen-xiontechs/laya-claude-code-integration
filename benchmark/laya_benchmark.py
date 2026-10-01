"""Laya self-hosted performance & resource benchmark.

Starts its own laya-serve on a private port, drives it over HTTP and samples
CPU/RAM of the server process tree with psutil (GPU via nvidia-smi when present).

Run:   uv run --with psutil python laya_benchmark.py [--phases cold,warm,...] [--device cpu]
Out:   results/<device>_*.csv, results/summary.csv, results/environment.json
"""
import argparse, csv, json, os, platform, shutil, statistics, subprocess, sys, threading, time
import urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psutil

HERE = Path(__file__).parent
OUT = HERE / "results"
PORT = 8011
URL = f"http://127.0.0.1:{PORT}"
SERVE = shutil.which("laya-serve") or str(Path.home() / ".local/bin/laya-serve.exe")
NCPU = psutil.cpu_count()

# ---------- workloads ----------
CRIT = {
    "a": "Bug - An existing feature or behavior is not working correctly, produces an error, or has an incorrect result",
    "b": "Feature - A request to add a new capability, function, or user-facing behavior that does not currently exist",
    "c": "Task - A planned implementation, maintenance, refactoring, configuration, documentation, or technical work that is not a bug fix or new feature",
}
Q_WORK = {"type": "choice", "instructions": "What type of work item is this?", "criteria": CRIT}
SMALL = "API returns HTTP 500 when submitting a leave request."
MEDIUM = ("Leave request submission fails with HTTP 500. "
          "Steps: log in as an employee, open Leave > New request, choose annual leave for next Monday to Wednesday, "
          "press Submit. Expected: the request is created and the manager is notified. Actual: the page shows a generic "
          "error and the API responds with 500. The server log shows a NullReferenceException in LeaveBalanceService "
          "when the employee has no balance row for the current year. It started after the last deployment.")
LARGE = MEDIUM + " " + " ".join(
    f"Comment {i}: I reproduced this on the staging environment with a different account; the balance table has no row "
    f"for employees hired this year, and the nightly job that creates them did not run since the release. "
    f"A workaround is to insert the row manually, but we need a proper fix and a regression test."
    for i in range(1, 9))
INPUTS = {"small": SMALL, "medium": MEDIUM, "large": LARGE}
MULTI_Q = [
    ("choice", "What type of work item is this?", CRIT),
    ("score", "How urgent is this?", ["not urgent", "soon", "blocking"]),
    ("noul", "Does this describe a production outage?", None),
    ("choice", "Which team should handle this?", {"backend": "API, services, database", "frontend": "UI, pages, styling", "devops": "deployment, infrastructure, CI"}),
    ("noul", "Is a customer affected?", None),
]


def questions(n):
    qs = {}
    for i in range(n):
        t, ins, crit = MULTI_Q[i % len(MULTI_Q)]
        q = {"type": t, "instructions": ins}
        if crit is not None:
            q["criteria"] = crit
        qs[f"q{i + 1}"] = q
    return qs


# ---------- resource sampler ----------
class Sampler(threading.Thread):
    """Samples the server process tree every `interval` s; keeps the latest and a history."""

    def __init__(self, pid, interval=0.5):
        super().__init__(daemon=True)
        self.root, self.interval, self.stop_evt = psutil.Process(pid), interval, threading.Event()
        self.latest, self.hist, self.gpu = {}, [], shutil.which("nvidia-smi")
        self._procs = {}

    def _tree(self):
        try:
            ps = [self.root] + self.root.children(recursive=True)
        except psutil.Error:
            return []
        for p in ps:
            if p.pid not in self._procs:
                self._procs[p.pid] = p
                try:
                    p.cpu_percent(None)
                except psutil.Error:
                    pass
        return [self._procs[p.pid] for p in ps]

    def _gpu(self):
        if not self.gpu:
            return {}
        try:
            o = subprocess.run([self.gpu, "--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw",
                                "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3).stdout
            u, m, t, p = [x.strip() for x in o.splitlines()[0].split(",")]
            return {"gpu_util": float(u), "vram_mb": float(m), "gpu_temp": float(t), "gpu_power_w": float(p)}
        except Exception:
            return {}

    def run(self):
        psutil.cpu_percent(None)
        while not self.stop_evt.wait(self.interval):
            cpu = rss = 0.0
            for p in self._tree():
                try:
                    cpu += p.cpu_percent(None)
                    rss += p.memory_info().rss
                except psutil.Error:
                    pass
            fr = psutil.cpu_freq()
            s = {"t": time.time(), "proc_cpu_pct": round(cpu / NCPU, 1),      # % of whole machine
                 "proc_cpu_cores": round(cpu / 100, 2),                      # cores in use
                 "rss_mb": round(rss / 2**20, 1), "sys_cpu_pct": psutil.cpu_percent(None),
                 "sys_ram_used_mb": round(psutil.virtual_memory().used / 2**20),
                 "cpu_mhz": round(fr.current) if fr else None, **self._gpu()}
            self.latest = s
            self.hist.append(s)

    def window(self, t0, t1):
        return [s for s in self.hist if t0 <= s["t"] <= t1]


def agg(samples, key):
    v = [s[key] for s in samples if s.get(key) is not None]
    return (round(statistics.mean(v), 1), round(max(v), 1)) if v else (None, None)


# ---------- server control ----------
class Server:
    def __init__(self, device, extra_env=None):
        env = dict(os.environ, LAYA_PORT=str(PORT), LAYA_HOST="127.0.0.1", LAYA_DEVICE=device,
                   HF_HUB_DISABLE_SYMLINKS_WARNING="1")
        env.setdefault("HF_HOME", r"D:\hf-cache")
        env.update(extra_env or {})
        self.log = open(OUT / "server.log", "ab")
        self.t_spawn = time.perf_counter()
        self.proc = subprocess.Popen([SERVE], env=env, stdout=self.log, stderr=subprocess.STDOUT)
        self.t_ready = None

    def wait_ready(self, timeout=600):
        while time.perf_counter() - self.t_spawn < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError("laya-serve exited, see results/server.log")
            try:
                urllib.request.urlopen(URL + "/health", timeout=2).read()
                self.t_ready = time.perf_counter()
                return self.t_ready - self.t_spawn
            except Exception:
                time.sleep(0.1)
        raise TimeoutError("server not ready")

    def stop(self):
        try:
            for p in psutil.Process(self.proc.pid).children(recursive=True):
                p.kill()
        except psutil.Error:
            pass
        self.proc.kill()
        self.proc.wait()
        self.log.close()
        time.sleep(1)


def call(state, qs, timeout=300):
    body = json.dumps({"state": {"body": state}, "questions": qs}).encode()
    req = urllib.request.Request(URL + "/v1/systemone", data=body, headers={"content-type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
            infer = r.headers.get("X-Inference-Time-Ms")
            status, tok = r.status, data.get("usage", {}).get("input_tokens")
    except urllib.error.HTTPError as e:
        status, infer, tok = e.code, None, None
    except Exception as e:
        status, infer, tok = f"ERR:{type(e).__name__}", None, None
    return {"latency_ms": round((time.perf_counter() - t0) * 1000, 1), "status": status,
            "server_infer_ms": float(infer) if infer else None, "input_tokens": tok}


# ---------- measurement ----------
FIELDS = ["phase", "variant", "n", "timestamp", "latency_ms", "server_infer_ms", "status", "input_tokens",
          "proc_cpu_pct", "proc_cpu_cores", "rss_mb", "sys_cpu_pct", "sys_ram_used_mb", "cpu_mhz",
          "gpu_util", "vram_mb", "gpu_temp", "gpu_power_w"]
SUMMARY = []


def pct(v, p):
    v = sorted(v)
    return round(v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))], 1)


def run_load(sampler, phase, variant, state, qs, total=None, conc=1, duration=None, writer=None, decisions=1):
    rows, lock, t_start = [], threading.Lock(), time.time()
    counter = iter(range(10**9))

    def one(_):
        r = call(state, qs)
        with lock:
            r.update(phase=phase, variant=variant, n=next(counter) + 1, timestamp=round(time.time(), 3),
                     **{k: sampler.latest.get(k) for k in FIELDS[8:]})
            rows.append(r)

    with ThreadPoolExecutor(conc) as ex:
        if duration:
            def worker():
                while time.time() - t_start < duration:
                    one(0)
            fs = [ex.submit(worker) for _ in range(conc)]
            [f.result() for f in fs]
        else:
            list(ex.map(one, range(total)))
    wall = time.time() - t_start
    if writer:
        writer.writerows(rows)
    ok = [r for r in rows if r["status"] == 200]
    lat = [r["latency_ms"] for r in ok] or [0]
    win = sampler.window(t_start, time.time())
    s = {"phase": phase, "variant": variant, "requests": len(rows), "ok": len(ok),
         "error_rate_pct": round(100 * (len(rows) - len(ok)) / max(1, len(rows)), 1),
         "avg_ms": round(statistics.mean(lat), 1), "min_ms": min(lat), "max_ms": max(lat),
         "p50_ms": pct(lat, 50), "p95_ms": pct(lat, 95), "p99_ms": pct(lat, 99),
         "throughput_rps": round(len(ok) / wall, 3), "decisions_per_s": round(len(ok) * decisions / wall, 3),
         "ms_per_decision": round(statistics.mean(lat) / decisions, 1),
         "input_tokens": ok[0]["input_tokens"] if ok else None}
    for k in ("proc_cpu_pct", "proc_cpu_cores", "rss_mb", "sys_cpu_pct", "gpu_util", "vram_mb", "gpu_temp", "gpu_power_w"):
        s[k + "_avg"], s[k + "_peak"] = agg(win, k)
    SUMMARY.append(s)
    print(f"  {phase:12} {variant:14} n={len(rows):4} err={s['error_rate_pct']:5}% p50={s['p50_ms']:8} p95={s['p95_ms']:8} "
          f"rps={s['throughput_rps']:6} cpu={s['proc_cpu_pct_avg']}%/{s['proc_cpu_pct_peak']}% rss={s['rss_mb_avg']}/{s['rss_mb_peak']}MB", flush=True)
    return s, rows


def csv_writer(name):
    f = open(OUT / name, "w", newline="", encoding="utf-8")
    w = csv.DictWriter(f, FIELDS, extrasaction="ignore")
    w.writeheader()
    return f, w


def environment(device):
    import importlib.metadata as md
    tool_py = Path(os.environ.get("APPDATA", "")) / "uv/tools/laya/Scripts/python.exe"
    info = subprocess.run([str(tool_py), "-c",
                           "import torch,sys,importlib.metadata as m,json;print(json.dumps({'python':sys.version.split()[0],"
                           "'laya':m.version('laya'),'torch':torch.__version__,'cuda_available':torch.cuda.is_available(),"
                           "'torch_threads':torch.get_num_threads()}))"], capture_output=True, text=True).stdout
    bat = psutil.sensors_battery()
    env = {"os": platform.platform(), "cpu": platform.processor(), "physical_cores": psutil.cpu_count(False),
           "logical_cores": NCPU, "ram_gb": round(psutil.virtual_memory().total / 2**30, 1), "device": device,
           "on_ac_power": bat.power_plugged if bat else None, **json.loads(info or "{}")}
    try:
        env["cpu"] = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                                    capture_output=True, text=True).stdout.strip() or env["cpu"]
        env["power_plan"] = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, text=True).stdout.strip()
    except Exception:
        pass
    return env


def system_baseline(seconds=15):
    psutil.cpu_percent(None)
    cpu, ram = [], []
    for _ in range(seconds):
        cpu.append(psutil.cpu_percent(1))
        ram.append(psutil.virtual_memory().used / 2**20)
    return {"sys_cpu_pct_avg": round(statistics.mean(cpu), 1), "sys_cpu_pct_peak": max(cpu),
            "sys_ram_used_mb": round(statistics.mean(ram))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--phases", default="cold,idle,warm,input,multi,conc,threads,sustained")
    ap.add_argument("--requests", type=int, default=100)
    ap.add_argument("--sustained-min", type=float, default=10)
    ap.add_argument("--sustained-conc", type=int, default=4)
    a = ap.parse_args()
    phases, dev = set(a.phases.split(",")), a.device
    OUT.mkdir(exist_ok=True)
    extra = {"env": environment(dev)}
    print("environment:", json.dumps(extra["env"], indent=1))
    print("system baseline (15 s, no Laya)...")
    extra["system_baseline"] = system_baseline()
    print(" ", extra["system_baseline"])

    # ---- cold start ----
    if "cold" in phases:
        print("cold start")
        cold = []
        for label, env in [("preload", {}), ("preload", {}), ("lazy", {"LAYA_PRELOAD": "0"})]:
            srv = Server(dev, env)
            ready = srv.wait_ready()
            first = call(SMALL, {"q": Q_WORK})
            second = call(SMALL, {"q": Q_WORK})
            rss = sum(p.memory_info().rss for p in [psutil.Process(srv.proc.pid)] + psutil.Process(srv.proc.pid).children(True)) / 2**20
            cold.append({"mode": label, "spawn_to_ready_s": round(ready, 2), "first_request_ms": first["latency_ms"],
                         "second_request_ms": second["latency_ms"], "rss_after_mb": round(rss)})
            print("  ", cold[-1], flush=True)
            srv.stop()
        extra["cold_start"] = cold

    srv = Server(dev)
    srv.wait_ready()
    sampler = Sampler(srv.proc.pid)
    sampler.start()
    try:
        if "idle" in phases:
            print("idle (model loaded, 20 s, no requests)")
            t0 = time.time()
            time.sleep(20)
            w = sampler.window(t0, time.time())
            extra["idle_loaded"] = {k: agg(w, k) for k in ("proc_cpu_pct", "rss_mb", "sys_cpu_pct", "vram_mb")}
            print("  ", extra["idle_loaded"])
        for _ in range(5):  # warm-up, discarded
            call(SMALL, {"q": Q_WORK})

        if "warm" in phases:
            print("warm baseline")
            f, w = csv_writer(f"{dev}_baseline.csv")
            run_load(sampler, "warm", "1q_small", SMALL, {"q": Q_WORK}, total=a.requests, writer=w)
            f.close()
        if "input" in phases or "multi" in phases:
            f, w = csv_writer(f"{dev}_batching.csv")
            if "input" in phases:
                print("input size")
                for name, text in INPUTS.items():
                    run_load(sampler, "input_size", name, text, {"q": Q_WORK}, total=30, writer=w)
            if "multi" in phases:
                print("questions per request")
                for n in (1, 5, 10, 20):
                    run_load(sampler, "multi_q", f"{n}q", MEDIUM, questions(n), total=20, writer=w, decisions=n)
            f.close()
        if "conc" in phases:
            print("concurrency")
            f, w = csv_writer(f"concurrency_{dev}.csv")
            for c in (1, 2, 4, 8, 16):
                run_load(sampler, "concurrency", f"c{c}", SMALL, {"q": Q_WORK}, total=a.requests, conc=c, writer=w)
            f.close()
        if "sustained" in phases:
            print(f"sustained load: {a.sustained_min} min at concurrency {a.sustained_conc}")
            f, w = csv_writer("sustained_load.csv")
            t0 = time.time()
            s, rows = run_load(sampler, "sustained", f"c{a.sustained_conc}_{a.sustained_min:g}min", SMALL, {"q": Q_WORK},
                               conc=a.sustained_conc, duration=a.sustained_min * 60, writer=w)
            f.close()
            # per-minute trend: latency and memory drift
            trend = []
            for m in range(int(a.sustained_min)):
                lo, hi = t0 + 60 * m, t0 + 60 * (m + 1)
                lat = [r["latency_ms"] for r in rows if lo <= r["timestamp"] < hi and r["status"] == 200]
                win = sampler.window(lo, hi)
                if lat and win:
                    trend.append({"minute": m + 1, "requests": len(lat), "p50_ms": pct(lat, 50), "p95_ms": pct(lat, 95),
                                  "rss_mb": agg(win, "rss_mb")[0], "proc_cpu_pct": agg(win, "proc_cpu_pct")[0],
                                  "cpu_mhz": agg(win, "cpu_mhz")[0]})
            extra["sustained_trend"] = trend
    finally:
        sampler.stop_evt.set()
        srv.stop()

    # ---- torch thread sweep (separate server per setting) ----
    if "threads" in phases:
        print("LAYA_THREADS sweep")
        f, w = csv_writer(f"{dev}_threads.csv")
        for label, env in [("threads=2", {"LAYA_THREADS": "2"}), ("threads=4", {"LAYA_THREADS": "4"}),
                           ("threads=8", {"LAYA_THREADS": "8"}), ("threads=16", {"LAYA_THREADS": "16"}),
                           ("english_only", {"LAYA_MODELS": "english"})]:
            s2 = Server(dev, env)
            s2.wait_ready()
            sm = Sampler(s2.proc.pid)
            sm.start()
            for _ in range(3):
                call(SMALL, {"q": Q_WORK})
            run_load(sm, "threads", label, SMALL, {"q": Q_WORK}, total=20, writer=w)
            sm.stop_evt.set()
            s2.stop()
        f.close()

    keys = list(SUMMARY[0].keys()) if SUMMARY else []
    with open(OUT / "summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, keys)
        w.writeheader()
        w.writerows(SUMMARY)
    json.dump(extra, open(OUT / "environment.json", "w"), indent=1)
    print("done ->", OUT)


if __name__ == "__main__":
    main()
