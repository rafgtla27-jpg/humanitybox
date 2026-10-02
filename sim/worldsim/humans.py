"""
WORLD_SIM — Chasseurs-cueilleurs en cohortes (V0.1)

Une cellule = une cohorte statistique. Aucune technologie explicite.
Chaîne simulée :
    climat → productivité → capacité de charge → pression → migration

Tous les paramètres libres sont dans HumanParams. Ils devront être
calibrés sur UN jeu d'observations et validés sur un AUTRE (ex. calibrer
sur l'Eurasie, valider sur Sahul et les Amériques), jamais sur le même.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .earth import EarthProvider, Grid
from .kernel import Simulation


@dataclass
class HumanParams:
    r: float = 0.005            # croissance intrinsèque /an à faible densité
    d_max: float = 0.2          # hab/km² terrestre à NPP de référence (ordre de grandeur Binford)
    npp_ref: float = 1500.0     # g/m²/an
    marine: float = 0.06        # hab/km² supplémentaires sur cellules côtières
    t_min: float = -12.0        # °C : en dessous, habitat impossible sans technologie
    t_ok: float = 2.0           # °C : au-dessus, pas de pénalité de froid
    m_base: float = 0.0004      # fraction émigrant /an, même sans pression (exploration)
    m_press: float = 0.006      # fraction émigrant supplémentaire /an à N = K
    p_sea: float = 0.04         # poids relatif d'un saut maritime (~100-200 km)
    rough_scale: float = 700.0  # m : relief rendant un territoire coûteux à traverser
    allee_n: float = 25.0       # sous ce seuil, risque d'extinction démographique
    p_ext: float = 0.004        # probabilité d'extinction /an sous le seuil
    k_noise: float = 0.15       # variabilité locale (écart-type log) à chaque mise à jour climatique


ADJ = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
       (-1, -1, 0.7), (-1, 1, 0.7), (1, -1, 0.7), (1, 1, 0.7)]
HOPS = [(2 * di, 2 * dj, w) for di, dj, w in ADJ]


def shift(a: np.ndarray, di: int, dj: int) -> np.ndarray:
    """out[i, j] = a[i+di, j+dj] ; longitude périodique, latitude bornée (0)."""
    out = np.roll(a, -dj, axis=1)
    if di == 0:
        return out
    res = np.zeros_like(out)
    if di > 0:
        res[:-di] = out[di:]
    else:
        res[-di:] = out[:di]
    return res


class Ecology:
    """Met à jour EarthState et la capacité de charge K (période lente)."""

    name = "ecology"

    def __init__(self, earth: EarthProvider, grid: Grid, params: HumanParams, period: int = 250):
        self.earth, self.grid, self.p, self.period = earth, grid, params, period

    def carrying_capacity(self, s) -> np.ndarray:
        p, g = self.p, self.grid
        land_area = g.cell_area_km2 * s.land_frac
        cold = np.clip((s.temperature - p.t_min) / (p.t_ok - p.t_min), 0, 1)
        dens = p.d_max * np.minimum(s.npp / p.npp_ref, 1.3) * cold
        coastal = (s.land_frac > 0.02) & (s.land_frac < 0.98)
        marine = np.where(coastal, p.marine * g.cell_area_km2 * 0.3 * cold, 0)
        k = dens * land_area + marine
        return np.where(s.ice | (s.land_frac <= 0.02), 0.0, k)

    def step(self, sim: Simulation, year: int, dt: int) -> None:
        s = self.earth.state(year)
        k = self.carrying_capacity(s)
        noise = sim.rng.get("ecology").lognormal(0, self.p.k_noise, k.shape)
        sim.state["earth"] = s
        sim.state["K"] = (k * noise).astype(np.float32)
        sim.state["passable"] = (s.land_frac > 0.02) & ~s.ice
        sim.state["rough_cost"] = np.exp(-s.roughness / self.p.rough_scale).astype(np.float32)


class Demography:
    """Croissance (Ricker), migration sous pression, extinctions démographiques.

    La migration utilise un tableau « paddé » (2 cellules) : latitude bornée,
    longitude périodique. Les décalages sont des vues, sans copie.
    """

    name = "demography"
    PAD = 2

    def __init__(self, params: HumanParams, period: int = 10):
        self.p, self.period = params, period
        self._static_key = None

    def _pad(self, a: np.ndarray) -> np.ndarray:
        P = self.PAD
        a = np.pad(a, ((P, P), (0, 0)))
        return np.concatenate([a[:, -P:], a, a[:, :P]], axis=1)

    def _view(self, padded: np.ndarray, di: int, dj: int, shape) -> np.ndarray:
        P = self.PAD
        ny, nx = shape
        return padded[P + di:P + di + ny, P + dj:P + dj + nx]

    def _static(self, sim: Simulation):
        """Coefficients de passage par direction, recalculés seulement quand le climat change."""
        key = id(sim.state["K"])
        if key != self._static_key:
            passable = sim.state["passable"]
            water_pad = self._pad(~passable)
            self._coef = []
            for di, dj, w in ADJ:
                self._coef.append((di, dj, np.float32(w)))
            for di, dj, w in HOPS:
                mid = self._view(water_pad, di // 2, dj // 2, passable.shape)
                self._coef.append((di, dj, (w * self.p.p_sea * mid).astype(np.float32)))
            self._static_key = key
        return self._coef

    def migrate(self, N: np.ndarray, room: np.ndarray, out_rate: np.ndarray, coefs) -> np.ndarray:
        shape = N.shape
        room_pad = self._pad(room)
        weights = [self._view(room_pad, di, dj, shape) * c for di, dj, c in coefs]
        W = weights[0].copy()
        for w in weights[1:]:
            W += w
        out = np.where(W > 0, N * out_rate, 0)
        share = out / np.where(W > 0, W, 1)
        P = self.PAD
        acc = np.zeros((shape[0] + 2 * P, shape[1] + 2 * P), dtype=N.dtype)
        for (di, dj, _), w in zip(coefs, weights):
            acc[P + di:P + di + shape[0], P + dj:P + dj + shape[1]] += share * w
        acc[:, P:2 * P] += acc[:, -P:]       # repli périodique en longitude
        acc[:, -2 * P:-P] += acc[:, :P]
        return N - out + acc[P:-P, P:-P]

    def step(self, sim: Simulation, year: int, dt: int) -> None:
        """Toutes les populations partagent la même capacité de charge K.

        Compétition de type Lotka-Volterra : pour la population i,
        charge_i = N_i + somme_j alpha[i, j] * N_j.
        alpha[i, j] < 1 : i est peu gênée par j ; > 1 : i est fortement gênée par j.
        """
        K = sim.state["K"]
        Ksafe = np.maximum(K, 1e-9)
        coefs = self._static(sim)
        pops = sim.state["populations"]           # {nom: params}
        alpha = sim.state.get("alpha", {})
        current = {name: sim.state[name] for name in pops}

        for name, p in pops.items():
            N = current[name]
            load = N.copy()
            for other, M in current.items():
                if other != name:
                    load += alpha.get((name, other), 1.0) * M
            rng = sim.rng.get(f"demography:{name}")

            # 1. Croissance / déclin (forme de Ricker : stable pour r·dt petit)
            expo = np.clip(p.r * dt * (1 - load / Ksafe), -3, 1)
            N = np.where(K > 0, N * np.exp(expo), N * 0.5)

            # 2. Migration : on part si c'est plein, on va là où il y a de la place
            if p.m_base > 0 or p.m_press > 0:
                load = load - current[name] + N
                room = np.where(K > 0, np.clip(1 - load / Ksafe, 0, 1), 0) * sim.state["passable"] * sim.state["rough_cost"]
                rng_mask = sim.state.get(f"range:{name}")
                if rng_mask is not None:  # aire imposée (ex. archaïques : connue des fouilles, pas émergente)
                    room = room * rng_mask
                pressure = np.where(K > 0, np.clip(load / Ksafe, 0, 3), 3)
                out_rate = np.clip((p.m_base + p.m_press * pressure) * dt, 0, 0.5).astype(np.float32)
                hop_coefs = coefs if p.p_sea > 0 else coefs[:len(ADJ)]
                N = self.migrate(N, room, out_rate, hop_coefs)

            # 3. Stochasticité démographique : les petits groupes peuvent disparaître
            small = (N > 0) & (N < p.allee_n)
            dies = small & (rng.random(N.shape, dtype=np.float32) < 1 - (1 - p.p_ext) ** dt)
            N = np.where(dies | (N < 1), 0, N)
            sim.state[name] = N.astype(np.float32)
