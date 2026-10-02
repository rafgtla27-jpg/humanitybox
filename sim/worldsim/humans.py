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
    # --- V0.3 : eau douce (voir hydrology.py)
    water: bool = True          # la capacité de charge terrestre dépend de l'eau disponible
    marine_water_floor: float = 0.25  # sur la côte, sources et estuaires gardent un minimum d'eau
    # --- V0.3 : adaptation culturelle au froid (vêtements, feu, abris), portée par les cohortes
    c_fixed: float | None = None  # None = trait dynamique ; sinon valeur imposée (ex. archaïques)
    cold_delta: float = 22.0    # °C gagnés sur t_min quand l'adaptation est complète (c = 1)
    cold_gain: float = 1 / 8000  # /an : vitesse d'innovation sous contrainte de froid
    cold_loss: float = 1 / 4000  # /an : perte quand le réseau humain est trop petit (effet Tasmanie)
    cold_ncrit: float = 500.0   # personnes dans le réseau social nécessaires pour maintenir le savoir (calibré v0.3.4)
    # --- V0.4 : complexité culturelle émergente (Henrich 2004 ; Powell, Shennan & Thomas 2009)
    complexity: bool = False    # trait dynamique C ∈ [0, 1] porté par les cohortes
    C_fixed: float | None = None  # valeur imposée (archaïques)
    cx_n0: float = 10000.0      # population en réseau sous laquelle le répertoire s'érode vers 0
    cx_span: float = 40.0       # C* = 1 atteint pour cx_n0 × cx_span personnes en réseau
    cx_tau: float = 3000.0      # ans : temps de relaxation vers l'équilibre
    adv_max: float = 0.3        # avantage compétitif pour un écart de complexité de 1
    net_radius: int = 2         # rayon du réseau social, en cellules (2 → 5×5 ≈ 500 km)
    # --- V0.3 : contingence explicite
    demo_noise: float = 0.06    # /an : naissances + décès par personne (bruit démographique ∝ √N)
    ldd_rate: float = 1 / 4000  # /an par cellule à N = K : départ d'un groupe pionnier lointain
    ldd_founders: float = 30.0  # taille d'un groupe pionnier (une bande)
    ldd_min: int = 3            # distance du saut, en cellules (~300 km)…
    ldd_max: int = 8            # …à ~900 km, par voie de terre (au plus une cellule d'eau)


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
    """Met à jour EarthState, l'hydrologie et la capacité de charge de base (période lente).

    K_base n'inclut pas le froid : la tolérance au froid dépend de la culture de chaque
    population et est appliquée dans Demography.
    """

    name = "ecology"

    def __init__(self, earth: EarthProvider, grid: Grid, params: HumanParams, period: int = 250):
        self.earth, self.grid, self.p, self.period = earth, grid, params, period
        self.hydro = None
        if params.water:
            from .earth import Topography
            from .hydrology import Hydrology
            self.hydro = Hydrology(grid, getattr(earth, "topo", None) or Topography(grid))

    def carrying_capacity(self, s, water: np.ndarray | None = None) -> np.ndarray:
        p, g = self.p, self.grid
        land_area = g.cell_area_km2 * s.land_frac
        w = np.ones_like(s.npp) if water is None else water
        dens = p.d_max * np.minimum(s.npp / p.npp_ref, 1.3) * w
        coastal = (s.land_frac > 0.02) & (s.land_frac < 0.98)
        marine = np.where(coastal, p.marine * g.cell_area_km2 * 0.3 * np.maximum(w, p.marine_water_floor), 0)
        k = dens * land_area + marine
        return np.where(s.ice | (s.land_frac <= 0.02), 0.0, k)

    def step(self, sim: Simulation, year: int, dt: int) -> None:
        s = self.earth.state(year)
        water = None
        if self.hydro is not None:
            q = self.hydro.discharge_m3s(s.precipitation, s.temperature, s.land_frac > 0.3)
            water = self.hydro.water_availability(s.precipitation, s.temperature, q)
            sim.state["discharge"] = q.astype(np.float32)
            sim.state["water"] = water.astype(np.float32)
        k = self.carrying_capacity(s, water)
        noise = sim.rng.get("ecology").lognormal(0, self.p.k_noise, k.shape)
        sim.state["earth"] = s
        sim.state["K"] = (k * noise).astype(np.float32)
        sim.state["passable"] = (s.land_frac > 0.02) & ~s.ice
        sim.state["rough_cost"] = np.exp(-s.roughness / self.p.rough_scale).astype(np.float32)


def cold_factor(temperature: np.ndarray, p: HumanParams, c) -> np.ndarray:
    t_min = p.t_min - p.cold_delta * c
    return np.clip((temperature - t_min) / (p.t_ok - t_min), 0, 1)


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

    def migrate(self, N: np.ndarray, room: np.ndarray, out_rate: np.ndarray, coefs, carried=()):
        """Déplace N et, avec exactement les mêmes flux relatifs, les quantités `carried`
        (ex. N × trait culturel). Renvoie N seul si carried est vide, sinon (N, [carried…])."""
        shape = N.shape
        room_pad = self._pad(room)
        weights = [self._view(room_pad, di, dj, shape) * c for di, dj, c in coefs]
        W = weights[0].copy()
        for w in weights[1:]:
            W += w
        rate = np.where(W > 0, out_rate, 0)
        Wsafe = np.where(W > 0, W, 1)
        P = self.PAD

        def move(X):
            out = X * rate
            share = out / Wsafe
            acc = np.zeros((shape[0] + 2 * P, shape[1] + 2 * P), dtype=np.float32)
            for (di, dj, _), w in zip(coefs, weights):
                acc[P + di:P + di + shape[0], P + dj:P + dj + shape[1]] += share * w
            acc[:, P:2 * P] += acc[:, -P:]       # repli périodique en longitude
            acc[:, -2 * P:-P] += acc[:, :P]
            return X - out + acc[P:-P, P:-P]

        if not carried:
            return move(N)
        return move(N), [move(X) for X in carried]

    def _long_jumps(self, sim, N, K, p, dt, rng, c):
        """Sauts de groupes pionniers. Renvoie (N, c) mis à jour et journalise les fondations."""
        pressure = np.where(K > 0, np.clip(N / np.maximum(K, 1e-9), 0, 1), 0)
        prob = p.ldd_rate * dt * pressure * (N > 4 * p.ldd_founders)
        sources = np.flatnonzero(rng.random(N.shape, dtype=np.float32).ravel() < prob.ravel())
        if sources.size == 0:
            return N, c
        ny, nx = N.shape
        passable = sim.state["passable"]
        Nf = N.ravel().copy()
        cf = None if c is None else c.ravel().copy()
        Kf = K.ravel()
        for src in sources:
            i, j = divmod(int(src), nx)
            dist = int(rng.integers(p.ldd_min, p.ldd_max + 1))
            ang = rng.random() * 2 * np.pi
            di, dj = np.sin(ang), np.cos(ang)
            ti = int(round(i + di * dist))
            if ti < 0 or ti >= ny:
                continue
            tj = int(round(j + dj * dist)) % nx
            # Le trajet doit rester terrestre (une seule cellule d'eau tolérée)
            wet = 0
            for k in range(1, dist):
                ii = int(round(i + di * k))
                jj = int(round(j + dj * k)) % nx
                if not passable[ii, jj]:
                    wet += 1
            dst = ti * nx + tj
            if wet > 1 or not passable[ti, tj] or Kf[dst] <= 0 or Nf[dst] >= 0.5 * Kf[dst]:
                continue
            f = min(p.ldd_founders, Nf[src] * 0.25)
            if cf is not None:
                cf[dst] = (cf[dst] * Nf[dst] + cf[src] * f) / (Nf[dst] + f)
            Nf[src] -= f
            Nf[dst] += f
            if Nf[dst] - f < 1 and sim.state.get("log_jumps", False):
                sim.log.emit(sim.year, "PIONNIERS", f"{90 - ti - 0.5:.0f}°, {tj - 180 + 0.5:.0f}°", depuis=f"{90 - i - 0.5:.0f}°, {j - 180 + 0.5:.0f}°")
        N = Nf.reshape(N.shape).astype(np.float32)
        return N, (None if cf is None else cf.reshape(N.shape).astype(np.float32))

    def _neighborhood(self, N: np.ndarray, radius: int = 1) -> np.ndarray:
        radius = min(radius, self.PAD)
        padded = self._pad(N)
        r = range(-radius, radius + 1)
        return sum(self._view(padded, di, dj, N.shape) for di in r for dj in r)

    def _complexity_alpha(self, sim, pops, alpha):
        """Avantage compétitif émergent : il dépend de l'écart de complexité culturelle, cellule par
        cellule. Un sapiens au répertoire appauvri peut perdre face aux Néandertaliens."""
        names = list(pops)
        if len(names) != 2:
            return alpha
        a, b = names
        pa, pb = pops[a], pops[b]
        if not (pa.complexity or pb.complexity):
            return alpha
        Ca = sim.state.get(f"complexity:{a}") if pa.C_fixed is None else pa.C_fixed
        Cb = sim.state.get(f"complexity:{b}") if pb.C_fixed is None else pb.C_fixed
        if Ca is None or Cb is None:
            return alpha
        adv = np.clip(max(pa.adv_max, pb.adv_max) * (np.asarray(Ca) - np.asarray(Cb)), -0.5, 0.5).astype(np.float32)
        return {**alpha, (a, b): 1 - adv, (b, a): 1 + adv}

    def step(self, sim: Simulation, year: int, dt: int) -> None:
        """Toutes les populations partagent la même capacité de charge de base.

        Compétition de type Lotka-Volterra : pour la population i,
        charge_i = N_i + somme_j alpha[i, j] * N_j, comparée à K_i = K_base × froid_i(culture_i).
        alpha[i, j] < 1 : i est peu gênée par j ; > 1 : i est fortement gênée par j.
        """
        K_base = sim.state["K"]
        T = sim.state["earth"].temperature
        coefs = self._static(sim)
        pops = sim.state["populations"]           # {nom: params}
        alpha = self._complexity_alpha(sim, pops, sim.state.get("alpha", {}))
        current = {name: sim.state[name] for name in pops}

        for name, p in pops.items():
            N = current[name]
            dynamic = p.c_fixed is None
            c = sim.state.get(f"culture:{name}") if dynamic else None
            if dynamic and c is None:
                c = np.zeros_like(N, dtype=np.float32)
            c_eff = c if dynamic else p.c_fixed
            K = (K_base * cold_factor(T, p, c_eff)).astype(np.float32)
            Ksafe = np.maximum(K, 1e-9)
            load = N.copy()
            for other, M in current.items():
                if other != name:
                    load += alpha.get((name, other), 1.0) * M
            rng = sim.rng.get(f"demography:{name}")

            # 1. Croissance / déclin (forme de Ricker : stable pour r·dt petit)
            expo = np.clip(p.r * dt * (1 - load / Ksafe), -3, 1).astype(np.float32)
            N = np.where(K > 0, N * np.exp(expo), N * np.float32(0.5))

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
                cx = sim.state.get(f"complexity:{name}") if p.complexity and p.C_fixed is None else None
                carried = ([N * c] if dynamic else []) + ([N * cx] if cx is not None else [])
                if carried:
                    N, moved = self.migrate(N, room, out_rate, hop_coefs, carried=tuple(carried))
                    safe = np.maximum(N, 1e-9)
                    if dynamic:
                        c = np.where(N > 1e-9, np.clip(moved.pop(0) / safe, 0, 1), 0)
                    if cx is not None:
                        sim.state[f"complexity:{name}"] = np.where(N > 1e-9, np.clip(moved.pop(0) / safe, 0, 1), 0).astype(np.float32)
                else:
                    N = self.migrate(N, room, out_rate, hop_coefs)

            # 3. Contingence
            # 3a. Bruit démographique : naissances et décès sont des événements discrets ;
            #     écart-type ∝ √N, négligeable pour une grande population, décisif pour une petite.
            if p.demo_noise > 0:
                sd = np.sqrt(np.maximum(N, 0) * p.demo_noise * dt).astype(np.float32)
                N = np.maximum(N + sd * rng.standard_normal(N.shape, dtype=np.float32), 0)
            # 3b. Dispersion lointaine : de rares groupes pionniers partent loin devant le front.
            #     C'est ce qui rend chaque histoire différente : où et quand ils partent, s'ils survivent.
            if p.ldd_rate > 0 and (p.m_base > 0 or p.m_press > 0):
                if dynamic:
                    N, c = self._long_jumps(sim, N, K, p, dt, rng, c)
                else:
                    N, _ = self._long_jumps(sim, N, K, p, dt, rng, None)

            # 3c. Les petits groupes peuvent disparaître
            small = (N > 0) & (N < p.allee_n)
            dies = small & (rng.random(N.shape, dtype=np.float32) < 1 - (1 - p.p_ext) ** dt)
            N = np.where(dies | (N < 1), 0, N)

            # 4. Culture : on innove sous la contrainte du froid si le réseau humain est assez grand,
            #    on oublie si le groupe est trop isolé (aucune technique n'est acquise pour toujours)
            n_net = self._neighborhood(N, p.net_radius)
            if p.complexity and p.C_fixed is None:
                # Le répertoire culturel tend vers un équilibre fixé par la taille du réseau social :
                # grand réseau → techniques complexes maintenues ; petit réseau → érosion.
                C = sim.state.get(f"complexity:{name}")
                target = np.clip(np.log(np.maximum(n_net, 1) / p.cx_n0) / np.log(p.cx_span), 0, 1)
                if C is None:
                    C = target
                C = C + (target - C) * (1 - np.exp(-dt / p.cx_tau))
                sim.state[f"complexity:{name}"] = np.where(N > 0, C, 0).astype(np.float32)
            if dynamic:
                n_eff = n_net
                stressed = T < p.t_ok + 5
                big = n_eff >= p.cold_ncrit
                rate = p.cold_gain
                if p.complexity and p.C_fixed is None:
                    rate = p.cold_gain * sim.state[f"complexity:{name}"]  # coudre des vêtements exige un répertoire riche
                gain = np.where(big & stressed, rate * dt * (1 - c), 0)
                loss = np.where(~big, p.cold_loss * dt * c, 0)
                c = np.where(N > 0, np.clip(c + gain - loss, 0, 1), 0)
                sim.state[f"culture:{name}"] = c.astype(np.float32)

            sim.state[name] = N.astype(np.float32)
