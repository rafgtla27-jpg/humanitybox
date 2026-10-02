"""
WORLD_SIM — Hydrologie V0.3

Les rivières ne sont pas des données : elles émergent du relief réel et des pluies.

1. Réseau de drainage (calculé une fois) : « priority-flood » (Barnes et al. 2014) sur le relief
   ETOPO agrégé à 1° (minimum de chaque bloc, pour garder les fonds de vallée), depuis l'océan
   profond (< -150 m, toujours sous la mer sur 120 000 ans). Chaque cellule reçoit un exutoire :
   les dépressions sont comblées, l'eau finit toujours à la mer. Les plateaux continentaux
   exondés en période glaciaire sont donc drainés aussi.
2. Ruissellement (à chaque état climatique) : bilan de Budyko, équation de Fu (ω = 2,6),
   avec une évapotranspiration potentielle fonction de la température.
3. Débit : accumulation du ruissellement le long du réseau (système triangulaire creux).
4. Eau disponible pour des chasseurs-cueilleurs : max(pluie suffisante, accès à une rivière).
   Seuils d'aridité de l'UNEP (indice P/ETP : hyperaride < 0,05, aride 0,05–0,2).

Limites connues : bassins endoréiques (Tchad, Caspienne) comblés et déversés ; pas de lacs,
pas de nappes ; ETP très simplifiée.
"""
from __future__ import annotations

import heapq

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import splu

from .earth import Grid, Topography

DEEP_OCEAN_M = -150.0
SECONDS_PER_YEAR = 3.156e7
FU_OMEGA = 2.6

# Eau disponible (hypothèses documentées dans DECISIONS.md)
AI_HYPERARID = 0.05
AI_ARID = 0.20
Q_MIN = 20.0     # m³/s : en dessous, cours d'eau trop intermittent pour fixer des groupes
Q_FULL = 500.0   # m³/s : grand fleuve pérenne (Nil, Euphrate, Indus…)


def pet_mm(temperature_c: np.ndarray) -> np.ndarray:
    """Évapotranspiration potentielle annuelle (mm/an), approximation linéaire en température."""
    return np.clip(200 + 55 * temperature_c, 100, 2000)


def runoff_mm(p_mm: np.ndarray, temperature_c: np.ndarray) -> np.ndarray:
    """Ruissellement annuel par Budyko-Fu : ET/P = 1 + φ - (1 + φ^ω)^(1/ω), φ = ETP/P."""
    p = np.maximum(p_mm, 0)
    phi = pet_mm(temperature_c) / np.maximum(p, 1e-6)
    et_ratio = 1 + phi - (1 + phi ** FU_OMEGA) ** (1 / FU_OMEGA)
    return np.clip(p * (1 - et_ratio), 0, None)


class Hydrology:
    def __init__(self, grid: Grid, topo: Topography | None = None):
        self.grid = grid
        topo = topo or Topography(grid)
        self.dem = topo.blocks.min(axis=2).astype(np.float64)
        self.receiver, self.order = self._drainage(self.dem)
        n = grid.ny * grid.nx
        src = np.flatnonzero(self.receiver >= 0)
        # Q = R + P·Q  →  (I − P) Q = R, P[receveur, source] = 1
        A = sparse.identity(n, format="csc") - sparse.csc_matrix(
            (np.ones(src.size), (self.receiver[src], src)), shape=(n, n))
        self._lu = splu(A.tocsc())
        self.area_km2 = grid.cell_area_km2.ravel()

    def _drainage(self, dem: np.ndarray):
        ny, nx = dem.shape
        n = ny * nx
        flat = dem.ravel()
        receiver = np.full(n, -1, dtype=np.int64)
        done = np.zeros(n, dtype=bool)
        heap: list[tuple[float, int]] = []
        for i in np.flatnonzero(flat < DEEP_OCEAN_M):
            heap.append((flat[i], int(i)))
            done[i] = True
        heapq.heapify(heap)
        order = []
        nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
        while heap:
            z, c = heapq.heappop(heap)
            order.append(c)
            r, k = divmod(c, nx)
            for dr, dk in nbrs:
                rr = r + dr
                if rr < 0 or rr >= ny:
                    continue
                m = rr * nx + (k + dk) % nx
                if done[m]:
                    continue
                done[m] = True
                receiver[m] = c
                # Comblement : une cellule plus basse que son exutoire prend son niveau (+ε)
                heapq.heappush(heap, (max(flat[m], z + 1e-3), m))
        return receiver, np.array(order)

    def discharge_m3s(self, p_mm: np.ndarray, temperature_c: np.ndarray, land: np.ndarray) -> np.ndarray:
        r = np.where(land, runoff_mm(p_mm, temperature_c), 0.0).ravel()
        vol = r * self.area_km2 * 1e3 / SECONDS_PER_YEAR  # mm·km² → m³/s
        q = self._lu.solve(vol)
        return q.reshape(self.grid.ny, self.grid.nx)

    @staticmethod
    def water_availability(p_mm, temperature_c, q_m3s) -> np.ndarray:
        ai = np.maximum(p_mm, 0) / pet_mm(temperature_c)
        rain = np.clip((ai - AI_HYPERARID) / (AI_ARID - AI_HYPERARID), 0, 1)
        river = np.clip(np.log10(np.maximum(q_m3s, 1e-9) / Q_MIN) / np.log10(Q_FULL / Q_MIN), 0, 1)
        return np.maximum(rain, river)
