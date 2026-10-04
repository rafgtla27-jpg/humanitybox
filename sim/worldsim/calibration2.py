"""
WORLD_SIM — Calibration v2 (V0.3 de la roadmap : « calibration/validation séparées »)

Pourquoi une v2 : les grilles 3×3×2 à 6 mondes ont montré leurs limites — l'optimum tombait au bord
de la grille, les effets de seuil sont abrupts et 6 mondes laissent beaucoup de hasard.

Méthode en deux étages, entièrement automatique dans GitHub Actions :
  1. Exploration : 30 points tirés en hypercube latin dans un espace à 5 paramètres, 5 mondes chacun.
  2. Robustesse : les 5 meilleurs points (classés sur l'ENTRAÎNEMENT seulement) sont rejoués sur
     15 mondes de plus. Le choix final se fait sur 20 mondes, toujours sur l'entraînement.
Le score de test est affiché mais n'intervient jamais dans un choix.

Usage :
  python -m worldsim.calibration2 plan               # matrice de l'étage 1
  python -m worldsim.calibration2 select outputs 5   # matrice de l'étage 2 (5 meilleurs)
  python -m worldsim.calibration2 report outputs     # rapport final calibration.md / .json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from .calibration import SCENARIO, TEST, TRAIN
from .ensemble import load_manifests, score, summarize

# Espace exploré : (min, max, échelle).
# Cycle V0.4 (scénario C) : tour 1 → s25, tour 2 → s23 (figé, validation finale NON VALIDÉE).
# Cycle V0.5 (scénario D, navigation régionale) : boat_C ne sert plus ; le savoir maritime naît des
# archipels (sea_ref) et autorise les traversées au-delà de boat_s. Les paramètres de s23 sont
# ré-explorés autour de leurs valeurs, car la navigation change toute la dynamique (essai local
# seed 1 : Australie jamais, Asie du Sud 38,5k, Europe 75,5k — Bab-el-Mandeb devient difficile).
SPACE = {
    "adv_max": (0.2, 0.4, "lin"),
    "cx_n0": (600.0, 1600.0, "log"),
    "neanderthal_C": (0.15, 0.3, "lin"),
    "marine": (0.03, 0.1, "log"),
    "boat_s": (0.1, 0.5, "lin"),
    "sea_ref": (0.08, 0.35, "log"),
}
N_EXPLORE = 30
SEEDS_EXPLORE = 5
SEEDS_CONFIRM = 15


def lhs(n: int, seed: int = 2028) -> list[dict]:
    """Hypercube latin : chaque paramètre couvre ses n tranches exactement une fois."""
    rng = np.random.default_rng(seed)
    cols = {}
    for k, (lo, hi, scale) in SPACE.items():
        u = (rng.permutation(n) + rng.random(n)) / n
        if scale == "log":
            cols[k] = np.exp(np.log(lo) + u * (np.log(hi) - np.log(lo)))
        else:
            cols[k] = lo + u * (hi - lo)
    return [{k: float(f"{cols[k][i]:.4g}") for k in SPACE} for i in range(n)]


def _entry(variant: str, params: dict) -> dict:
    return {"variant": variant, "sets": " ".join(f"--set {k}={v:.6g}" for k, v in params.items()), "params": params}


def plan() -> dict:
    return {"include": [_entry(f"s{i:02d}", p) for i, p in enumerate(lhs(N_EXPLORE))]}


def _rows(root: Path) -> list[dict]:
    rows = []
    for s in summarize(load_manifests(root)):
        if not s.get("variant"):
            continue
        p = s["params"]
        rows.append({"variant": s["variant"], "n_runs": s["n_runs"], "params": {k: p.get(k) for k in SPACE},
                     "train": round(score(s, TRAIN), 3), "test": round(score(s, TEST), 3),
                     "regions": {r["region"]: {"p_in_range": r["p_in_range"], "median": r["median"],
                                               "p_reached": r["p_reached"]} for r in s["regions"]}})
    rows.sort(key=lambda r: (-r["train"], r["variant"]))
    return rows


def select(root: Path, k: int) -> dict:
    top = [r for r in _rows(root) if r["train"] > 0][:k]
    return {"include": [_entry(r["variant"], r["params"]) for r in top]}


def report(root: Path) -> dict:
    rows = _rows(root)
    confirmed = [r for r in rows if r["n_runs"] > SEEDS_EXPLORE]
    pool = confirmed or rows
    best = pool[0] if pool and pool[0]["train"] > 0 else None
    keys = list(SPACE)
    fmt = lambda v: "—" if v is None else f"{v:.3g}"  # noqa: E731
    lines = [f"# Calibration v2 — Experiment #001, scénario {SCENARIO}", "",
             f"Entraînement : {', '.join(TRAIN)}. Test (jamais utilisé pour choisir) : {', '.join(TEST)}.",
             f"Étage 1 : {N_EXPLORE} points (hypercube latin) × {SEEDS_EXPLORE} mondes. "
             f"Étage 2 : 5 meilleurs × {SEEDS_CONFIRM} mondes de plus.", "",
             "## Étage 2 — confirmation sur 20 mondes", "",
             "| Variante | " + " | ".join(keys) + " | mondes | entraînement | test |",
             "|---|" + "---|" * len(keys) + "---|---|---|"]
    for r in confirmed:
        mark = " ← choisie" if r is best else ""
        lines.append(f"| {r['variant']}{mark} | " + " | ".join(fmt(r["params"][k]) for k in keys) +
                     f" | {r['n_runs']} | {r['train']:.0%} | {r['test']:.0%} |")
    lines += ["", "## Étage 1 — exploration (10 meilleurs)", "",
              "| Variante | " + " | ".join(keys) + " | entraînement | test |", "|---|" + "---|" * len(keys) + "---|---|"]
    for r in [r for r in rows if r["n_runs"] <= SEEDS_EXPLORE][:10]:
        lines.append(f"| {r['variant']} | " + " | ".join(fmt(r["params"][k]) for k in keys) + f" | {r['train']:.0%} | {r['test']:.0%} |")
    if best is None:
        lines += ["", "**Aucune variante ne réussit une région d'entraînement : rien n'est choisi.**"]
    else:
        lines += ["", f"## Variante choisie : {best['variant']} ({best['n_runs']} mondes)", "",
                  "| Région | rôle | P(dans la fourchette) | P(atteinte) | médiane |", "|---|---|---|---|---|"]
        for name, v in best["regions"].items():
            role = "entraînement" if name in TRAIN else ("test" if name in TEST else "")
            med = "jamais" if v["median"] is None else f"{v['median'] / 1000:.1f}k"
            lines.append(f"| {name} | {role} | {v['p_in_range']:.0%} | {v['p_reached']:.0%} | {med} |")
    result = {"space": SPACE, "train_regions": TRAIN, "test_regions": TEST, "ranking": rows, "chosen": best}
    (root / "calibration.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    (root / "calibration.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return result


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if cmd == "plan":
        print(json.dumps(plan()))
    elif cmd == "select":
        print(json.dumps(select(Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 5)))
    elif cmd == "report":
        report(Path(sys.argv[2] if len(sys.argv) > 2 else "outputs"))
    elif cmd == "scenario":
        print(SCENARIO)
