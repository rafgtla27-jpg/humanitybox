"""
WORLD_SIM — Critères de validation finale, PRÉ-ENREGISTRÉS (fixés le 3 octobre 2026, avant tout
résultat les concernant). Ils ne servent à aucun choix de paramètres et ne doivent être évalués
qu'une fois, sur la version finale de la V0.3–V0.4, par un ensemble neuf d'au moins 50 mondes.
Toute modification de ce fichier après évaluation invalide la validation.

1. Population mondiale de sapiens à 10 000 ans : entre 1 et 10 millions (ordres de grandeur
   des estimations démographiques pour la fin du Pléistocène).
2. Ordre d'arrivée : corrélation de Kendall ≥ 0,6 entre les arrivées médianes simulées et l'ordre
   de référence ci-dessous (régions jamais atteintes = arrivée la plus tardive).
3. Pas de sortie générale précoce : aucune région autre que le Levant atteinte avant 90 000 ans
   dans plus de 20 % des mondes.
"""
from __future__ import annotations

import numpy as np

POP_10K = (1e6, 1e7)
REFERENCE_ORDER = {  # arrivées de référence, années avant le présent (valeurs centrales)
    "Asie du Sud": 60_000, "Chine du Sud": 50_000, "Australie": 50_000, "Europe": 45_000,
    "Japon": 35_000, "Arctique sibérien": 32_000, "Amérique du Nord (sud des glaces)": 18_000,
    "Amérique du Sud": 14_500,
}
TAU_MIN = 0.6
EARLY_LIMIT_BP = 90_000
EARLY_MAX_SHARE = 0.2


def kendall_tau(a, b) -> float:
    n, s, t = len(a), 0, 0
    for i in range(n):
        for j in range(i + 1, n):
            x = np.sign(a[i] - a[j]) * np.sign(b[i] - b[j])
            s += x
            t += 1
    return s / t if t else 0.0


def evaluate(manifests: list[dict]) -> dict:
    finals = [m["series"]["total"][-1] for m in manifests]
    pop_ok = POP_10K[0] <= float(np.median(finals)) <= POP_10K[1]
    names = list(REFERENCE_ORDER)
    med = []
    for name in names:
        arr = [next(r["model_bp"] for r in m["regions"] if r["region"] == name) for m in manifests]
        arr = [0 if a is None else a for a in arr]
        med.append(float(np.median(arr)))
    tau = kendall_tau(med, [REFERENCE_ORDER[n] for n in names])
    early = []
    for m in manifests:
        early.append(any((r["model_bp"] or 0) > EARLY_LIMIT_BP for r in m["regions"] if r["region"] != "Levant"))
    early_share = float(np.mean(early))
    return {"population_10k_median": float(np.median(finals)), "population_ok": pop_ok,
            "kendall_tau": round(tau, 3), "order_ok": tau >= TAU_MIN,
            "early_exit_share": round(early_share, 3), "early_ok": early_share <= EARLY_MAX_SHARE,
            "passed": bool(pop_ok and tau >= TAU_MIN and early_share <= EARLY_MAX_SHARE), "n_runs": len(manifests)}
