"""
Calibration v2 sur UNE machine (ton ordinateur), en parallèle sur ses cœurs.
Même méthode que le workflow GitHub `calibrate` : exploration en hypercube latin, puis
confirmation des meilleurs sur plus de mondes, classement sur l'ENTRAÎNEMENT seulement.

    python scripts/calibrate_local.py                    # calibration complète (climat Beyer)
    python scripts/calibrate_local.py --workers 6        # nombre de simulations simultanées
    python scripts/calibrate_local.py --smoke            # test éclair (quelques minutes)
"""
import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from worldsim import calibration2 as c2  # noqa: E402


def one_run(job, args, out):
    variant, sets, seed = job
    cmd = [sys.executable, str(ROOT / "run_experiment_001.py"), "--scenario", c2.SCENARIO, "--climate", args.climate,
           "--no-frames", "--seeds", str(seed), "--variant", variant, "--end", str(args.end), "--out", str(out)] + sets.split()
    t = time.time()
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        return f"ÉCHEC {variant} seed {seed} :\n{res.stderr[-1500:]}"
    return f"{variant} seed {seed} : {time.time() - t:.0f} s"


def run_all(jobs, args, out):
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(one_run, j, args, out) for j in jobs]
        for f in as_completed(futures):
            done += 1
            print(f"[{done}/{len(jobs)}] {f.result()}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--climate", default="beyer", choices=["beyer", "parametric"])
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--out", default=str(ROOT / "outputs" / "calibration_locale"))
    ap.add_argument("--smoke", action="store_true", help="test éclair : 3 points, 1 monde, 4 000 ans")
    args = ap.parse_args()

    n_explore, seeds1, top, seeds2, args.end = c2.N_EXPLORE, range(1, 6), 5, range(6, 21), -10_000
    if args.smoke:
        n_explore, seeds1, top, seeds2, args.end = 3, range(1, 2), 1, range(2, 3), -116_000
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"{os.cpu_count()} cœurs détectés, {args.workers} simulations en parallèle. Résultats : {out}", flush=True)

    plan = [e for e in c2.plan()["include"]][:n_explore]
    t0 = time.time()
    print(f"\n=== Étage 1 : {len(plan)} points × {len(seeds1)} mondes ===", flush=True)
    run_all([(e["variant"], e["sets"], s) for e in plan for s in seeds1], args, out)
    sel = c2.select(out, top)["include"]
    print(f"\n=== Étage 2 : {[e['variant'] for e in sel]} × {len(seeds2)} mondes ===", flush=True)
    run_all([(e["variant"], e["sets"], s) for e in sel for s in seeds2], args, out)
    print(f"\nDurée totale : {(time.time() - t0) / 60:.0f} min\n", flush=True)
    c2.report(out)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write((out / "calibration.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
