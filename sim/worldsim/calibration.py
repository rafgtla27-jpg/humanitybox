"""
WORLD_SIM — Calibration honnête (V0.3)

Principe : on choisit les paramètres en regardant UNIQUEMENT les régions d'entraînement, puis on
mesure, sans plus rien toucher, le score sur les régions de test. Si le test s'effondre alors que
l'entraînement est bon, le modèle a appris par cœur au lieu de comprendre.

Paramètres calibrés (scénario Eurasie habitée, climat Beyer) :
  advantage   avantage compétitif de sapiens sur les archaïques (α_sa = 1 − a, α_as = 1 + a).
              Paramètre phénoménologique : la V0.4 doit le remplacer par un avantage culturel émergent.
  cold_gain   vitesse d'innovation de l'adaptation au froid (/an)
  cold_ncrit  population voisine nécessaire pour maintenir ce savoir

Usage :
  python -m worldsim.calibration plan            # matrice JSON des variantes (GitHub Actions)
  python -m worldsim.calibration report outputs  # classement + validation → calibration.json / .md
"""
from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

from .ensemble import load_manifests, score, summarize

GRID = {
    "advantage": [0.0, 0.05, 0.1],
    "cold_gain": [1 / 8000, 1 / 20000, 1 / 50000],
    "cold_ncrit": [500.0, 2000.0],
}
# Entraînement : régions aux dates les mieux établies et directement concernées par les paramètres
TRAIN = ["Levant", "Europe", "Asie du Sud", "Arctique sibérien"]
# Test : jamais regardées pendant le choix des paramètres
TEST = ["Chine du Sud", "Australie", "Japon", "Amérique du Nord (sud des glaces)", "Amérique du Sud"]


def variants() -> list[dict]:
    keys = list(GRID)
    out = []
    for i, values in enumerate(itertools.product(*(GRID[k] for k in keys))):
        params = dict(zip(keys, values))
        out.append({"variant": f"v{i:02d}", "sets": " ".join(f"--set {k}={v:.10g}" for k, v in params.items()), "params": params})
    return out


def report(root: Path) -> dict:
    sums = [s for s in summarize(load_manifests(root)) if s.get("variant")]
    rows = []
    for s in sums:
        p = s["params"]
        rows.append({
            "variant": s["variant"], "n_runs": s["n_runs"],
            "advantage": round(1 - p.get("alpha_sa", 1.0), 4), "cold_gain": p.get("cold_gain"), "cold_ncrit": p.get("cold_ncrit"),
            "train": round(score(s, TRAIN), 3), "test": round(score(s, TEST), 3),
            "regions": {r["region"]: {"p_in_range": r["p_in_range"], "median": r["median"], "p_reached": r["p_reached"]} for r in s["regions"]},
        })
    rows.sort(key=lambda r: (-r["train"], r["variant"]))  # classement sur l'entraînement SEULEMENT
    best = rows[0] if rows else None
    result = {"train_regions": TRAIN, "test_regions": TEST, "grid": GRID, "ranking": rows, "chosen": best}

    lines = ["# Calibration — Experiment #001, scénario Eurasie habitée", "",
             f"Entraînement : {', '.join(TRAIN)}. Test (jamais utilisé pour choisir) : {', '.join(TEST)}.", "",
             "| Variante | avantage | cold_gain | cold_ncrit | score entraînement | score test |",
             "|---|---|---|---|---|---|"]
    for r in rows:
        mark = " ← choisie" if r is best else ""
        lines.append(f"| {r['variant']}{mark} | {r['advantage']:g} | 1/{1 / r['cold_gain']:.0f} | {r['cold_ncrit']:.0f} | "
                     f"{r['train']:.0%} | {r['test']:.0%} |")
    if best:
        lines += ["", f"## Variante choisie : {best['variant']}", "", "| Région | rôle | P(dans la fourchette) | médiane |", "|---|---|---|---|"]
        for name, v in best["regions"].items():
            role = "entraînement" if name in TRAIN else ("test" if name in TEST else "")
            med = "jamais" if v["median"] is None else f"{v['median'] / 1000:.1f}k"
            lines.append(f"| {name} | {role} | {v['p_in_range']:.0%} | {med} |")
    (root / "calibration.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    (root / "calibration.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return result


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if cmd == "plan":
        print(json.dumps({"include": variants()}))
    elif cmd == "report":
        report(Path(sys.argv[2] if len(sys.argv) > 2 else "outputs"))
