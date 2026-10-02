"""
WORLD_SIM — Calibration honnête (V0.3)

Principe : on choisit les paramètres en regardant UNIQUEMENT les régions d'entraînement, puis on
mesure, sans plus rien toucher, le score sur les régions de test. Si le test s'effondre alors que
l'entraînement est bon, le modèle a appris par cœur au lieu de comprendre.

Historique : la calibration v0.3.4 (scénario B, avantage fixe) a montré qu'AUCUN avantage
constant ne fait tenir l'Europe et l'Arctique (0 % sur les 18 variantes) : problème de structure,
pas de réglage. Depuis la V0.4, l'avantage émerge de la complexité culturelle (scénario C).

Paramètres calibrés (scénario C, climat Beyer) :
  adv_max     avantage compétitif pour un écart de complexité culturelle de 1
  cx_n0       taille de réseau social sous laquelle le répertoire culturel s'érode
  archaic_C   complexité culturelle des archaïques (Néandertaliens, Dénisoviens)

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

SCENARIO = "C"
GRID = {
    "adv_max": [0.2, 0.4],
    "cx_n0": [5000.0, 20000.0, 80000.0],
    "archaic_C": [0.15, 0.35, 0.55],
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
        values = {k: (round(1 - p.get("alpha_sa", 1.0), 4) if k == "advantage" else p.get(k)) for k in GRID}
        rows.append({
            "variant": s["variant"], "n_runs": s["n_runs"], "params": values,
            "train": round(score(s, TRAIN), 3), "test": round(score(s, TEST), 3),
            "regions": {r["region"]: {"p_in_range": r["p_in_range"], "median": r["median"], "p_reached": r["p_reached"]} for r in s["regions"]},
        })
    rows.sort(key=lambda r: (-r["train"], r["variant"]))  # classement sur l'entraînement SEULEMENT
    # Garde-fou : si tout échoue, il n'y a rien à choisir (grille hors domaine ou défaut de structure)
    best = rows[0] if rows and rows[0]["train"] > 0 else None
    result = {"train_regions": TRAIN, "test_regions": TEST, "grid": GRID, "ranking": rows, "chosen": best}

    keys = list(GRID)
    lines = [f"# Calibration — Experiment #001, scénario {SCENARIO}", "",
             f"Entraînement : {', '.join(TRAIN)}. Test (jamais utilisé pour choisir) : {', '.join(TEST)}.", "",
             "| Variante | " + " | ".join(keys) + " | score entraînement | score test |",
             "|---|" + "---|" * len(keys) + "---|---|"]
    for r in rows:
        mark = " ← choisie" if r is best else ""
        vals = " | ".join("—" if r["params"][k] is None else f"{r['params'][k]:g}" for k in keys)
        lines.append(f"| {r['variant']}{mark} | {vals} | {r['train']:.0%} | {r['test']:.0%} |")
    if rows and best is None:
        lines += ["", "**Aucune variante ne réussit une seule région d'entraînement : rien n'est choisi.**",
                  "Soit la grille est hors du domaine utile, soit le modèle a un défaut de structure.",
                  "Lire `part max sapiens` dans les logs des runs pour savoir où ça bloque."]
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
    elif cmd == "scenario":
        print(SCENARIO)
    elif cmd == "report":
        report(Path(sys.argv[2] if len(sys.argv) > 2 else "outputs"))
