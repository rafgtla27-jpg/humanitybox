"""
Évalue la validation finale PRÉ-ENREGISTRÉE (worldsim/final_validation.py, critères inchangés)
sur un ensemble neuf de mondes (seeds jamais utilisées pour la calibration : 1001 et plus).
À lancer UNE SEULE FOIS, sur la version figée.

    python scripts/validate_final.py outputs
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worldsim import final_validation as fv  # noqa: E402
from worldsim.calibration import TEST, TRAIN  # noqa: E402
from worldsim.ensemble import load_manifests, score, summarize  # noqa: E402

root = Path(sys.argv[1] if len(sys.argv) > 1 else "outputs")
ms = [m for m in load_manifests(root) if m["seed"] >= 1001]
res = fv.evaluate(ms)
sm = summarize(ms)[0]
ok = lambda b: "✅ réussi" if b else "❌ échoué"  # noqa: E731
lines = ["# Validation finale pré-enregistrée — Experiment #001, scénario C", "",
         f"{res['n_runs']} mondes neufs (seeds ≥ 1001), moteur {sm['engine_version']}, climat {sm['climate_provider']}.",
         "Critères fixés le 3 octobre 2026, avant tout résultat (sim/worldsim/final_validation.py).", "",
         "| Critère | Seuil | Résultat | Verdict |", "|---|---|---|---|",
         f"| Population mondiale à 10k (médiane) | 1 à 10 millions | {res['population_10k_median'] / 1e6:.1f} M | {ok(res['population_ok'])} |",
         f"| Ordre d'arrivée (Kendall) | ≥ {fv.TAU_MIN} | {res['kendall_tau']:.2f} | {ok(res['order_ok'])} |",
         f"| Sortie générale avant 90k | ≤ {fv.EARLY_MAX_SHARE:.0%} des mondes | {res['early_exit_share']:.0%} | {ok(res['early_ok'])} |",
         "", f"**Verdict global : {'VALIDÉ' if res['passed'] else 'NON VALIDÉ'}**", "",
         "## Pour information (non pré-enregistré)", "",
         f"Score entraînement {score(sm, TRAIN):.0%}, score test {score(sm, TEST):.0%} sur ces mondes neufs.", "",
         "| Région | P(dans la fourchette) | P(atteinte) | médiane |", "|---|---|---|---|"]
for r in sm["regions"]:
    med = "jamais" if r["median"] is None else f"{r['median'] / 1000:.1f}k"
    lines.append(f"| {r['region']} | {r['p_in_range']:.0%} | {r['p_reached']:.0%} | {med} |")
text = "\n".join(lines) + "\n"
(root / "validation_finale.md").write_text(text, encoding="utf-8")
(root / "validation_finale.json").write_text(json.dumps({"criteria": res, "ensemble": sm}, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)), encoding="utf-8")
(root / "ensemble_C_validation.json").write_text(json.dumps(sm, ensure_ascii=False, indent=1), encoding="utf-8")
print(text)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
        f.write(text)
