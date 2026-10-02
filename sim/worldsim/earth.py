"""
WORLD_SIM — EarthState(t)

Le substrat géométrique est RÉEL (ETOPO1 dégradé à 10', puis agrégé à 1°).
Le niveau marin vient d'une courbe de reconstruction (approximée par points).
Le climat est un PLACEHOLDER paramétrique : il existe pour faire tourner
la chaîne climat → ressources → humains, et doit être remplacé par des
reconstructions indépendantes (Beyer et al. 2020, ICE-6G pour les glaces)
via la même interface `EarthProvider`.

Ne JAMAIS ajuster ce climat pour que les humains arrivent « au bon moment » :
la validation deviendrait circulaire.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from scipy import ndimage

DATA = Path(__file__).resolve().parent.parent / "data"
KM_PER_DEG = 111.2


# ----------------------------------------------------------------------------
# Grille
# ----------------------------------------------------------------------------
class Grid:
    """Grille régulière lat/lon. Ligne 0 = nord. Longitude périodique."""

    def __init__(self, res_deg: float = 1.0):
        self.res = res_deg
        self.ny = int(round(180 / res_deg))
        self.nx = int(round(360 / res_deg))
        self.lat = 90 - res_deg * (np.arange(self.ny) + 0.5)
        self.lon = -180 + res_deg * (np.arange(self.nx) + 0.5)
        self.LON, self.LAT = np.meshgrid(self.lon, self.lat)
        coslat = np.cos(np.radians(self.LAT))
        self.cell_area_km2 = (KM_PER_DEG * res_deg) ** 2 * coslat

    def box(self, lat0, lat1, lon0, lon1) -> np.ndarray:
        return (self.LAT >= lat0) & (self.LAT <= lat1) & (self.LON >= lon0) & (self.LON <= lon1)


# ----------------------------------------------------------------------------
# Forçages globaux (courbes)
# ----------------------------------------------------------------------------
# Niveau marin relatif à l'actuel (m). Approximation grossière des
# reconstructions type Spratt & Lisiecki 2016 / Waelbroeck 2002.
_SEA_LEVEL_KYR = np.array([130, 125, 118, 113, 105, 100, 92, 85, 80, 72, 65, 58, 50, 42, 35, 30, 26, 21, 18, 16, 14.5, 13, 11.5, 10, 8, 7, 6, 0])
_SEA_LEVEL_M = np.array([-20, 6, 0, -40, -45, -22, -50, -40, -22, -45, -85, -70, -65, -70, -75, -85, -120, -128, -118, -105, -85, -70, -60, -42, -15, -6, 0, 0])


def sea_level(year: int) -> float:
    kyr = -year / 1000
    return float(np.interp(kyr, _SEA_LEVEL_KYR[::-1], _SEA_LEVEL_M[::-1]))


# Indice de mousson nord-africaine/arabique, piloté par la précession.
# Maxima d'insolation estivale boréale (kyr BP) et amplitude (excentricité).
_MONSOON_MAX_KYR = np.array([150, 128, 106, 84, 60, 37, 11, -12])
_MONSOON_AMP = np.array([0.5, 1.0, 0.85, 0.8, 0.5, 0.35, 0.7, 0.5])


def monsoon_index(year: int) -> float:
    kyr = -year / 1000
    m = _MONSOON_MAX_KYR
    k = np.searchsorted(-m, -kyr)  # m est décroissant
    k = int(np.clip(k, 1, len(m) - 1))
    older, younger = m[k - 1], m[k]
    phase = 2 * np.pi * (older - kyr) / (older - younger)
    amp = np.interp(phase, [0, 2 * np.pi], [_MONSOON_AMP[k - 1], _MONSOON_AMP[k]])
    return float(amp * np.cos(phase))


# ----------------------------------------------------------------------------
# Topographie réelle
# ----------------------------------------------------------------------------
class Topography:
    """ETOPO 10' agrégé par blocs : la fraction de terre émergée est
    recalculée exactement pour n'importe quel niveau marin."""

    def __init__(self, grid: Grid, path: Path = DATA / "etopo10_ice_g_i2.bin"):
        z = np.fromfile(path, dtype="<i2").reshape(1081, 2161).astype(np.float32)
        z = z[:1080, :2160]  # retire la ligne/colonne dupliquée (grille 'g')
        b = int(round(grid.res * 6))
        self.blocks = z.reshape(grid.ny, b, grid.nx, b).transpose(0, 2, 1, 3).reshape(grid.ny, grid.nx, b * b)
        self.grid = grid
        self._cache: dict[int, tuple] = {}

    def at_sea_level(self, sl: float):
        key = int(round(sl))
        if key not in self._cache:
            land_frac, elev, rough = self._compute(float(key))
            coast = ndimage.distance_transform_edt(land_frac > 0.5, sampling=(KM_PER_DEG, KM_PER_DEG * 0.75))
            self._cache[key] = (land_frac, elev, rough, coast)
        return self._cache[key]

    def _compute(self, sl: float):
        above = self.blocks > sl
        land_frac = above.mean(axis=2)
        n = np.maximum(above.sum(axis=2), 1)
        elev = np.where(above, self.blocks, 0).sum(axis=2) / n  # altitude moyenne de la partie émergée
        mean2 = np.where(above, self.blocks ** 2, 0).sum(axis=2) / n
        rough = np.sqrt(np.maximum(mean2 - elev ** 2, 0))
        return land_frac, elev, rough


# ----------------------------------------------------------------------------
# État de la Terre à une date
# ----------------------------------------------------------------------------
@dataclass
class EarthState:
    year: int
    sea_level: float
    monsoon: float
    land_frac: np.ndarray      # 0..1
    elevation: np.ndarray      # m, partie émergée
    roughness: np.ndarray      # m, écart-type intra-cellule
    coast_dist_km: np.ndarray
    temperature: np.ndarray    # °C moyenne annuelle
    precipitation: np.ndarray  # mm/an
    ice: np.ndarray            # bool
    npp: np.ndarray            # g matière sèche / m² / an


class EarthProvider(Protocol):
    def state(self, year: int) -> EarthState: ...


# Profil zonal de précipitations actuel (mm/an), cellules de Hadley/Ferrel
_P_LAT = np.array([0, 8, 15, 22, 28, 35, 45, 55, 65, 75, 90])
_P_MM = np.array([2000, 1700, 900, 350, 250, 500, 800, 750, 450, 250, 150])


class ParametricPaleoEarth:
    """PLACEHOLDER climatique. Topographie et niveau marin réels ;
    température/précipitations/glaces paramétriques."""

    name = "parametric-v0.1"

    def __init__(self, grid: Grid):
        self.grid = grid
        self.topo = Topography(grid)

    def state(self, year: int) -> EarthState:
        g = self.grid
        sl = sea_level(year)
        mon = monsoon_index(year)
        land_frac, elev, rough, coast_dist = self.topo.at_sea_level(sl)
        alat = np.abs(g.LAT)

        # --- Température
        ice_volume = np.clip(-sl / 125, 0, 1.1)
        t = -20 + 47 * np.cos(np.radians(g.LAT))
        cont = 1 - np.exp(-coast_dist / 1000)
        t -= 10 * cont * np.clip((alat - 35) / 30, 0, 1)
        t -= 6.5 * np.maximum(elev, 0) / 1000
        t -= 6.0 * ice_volume * (1 + 1.5 * (alat / 90) ** 2)

        # --- Précipitations
        p = np.interp(alat, _P_LAT, _P_MM)
        p *= 0.3 + 0.7 * np.exp(-coast_dist / 1000)
        p *= 1 - 0.2 * ice_volume
        sahara_arabia = g.box(8, 33, -20, 75)
        band = np.clip(1 - np.abs(g.LAT - 20) / 13, 0, 1)
        p += np.where(sahara_arabia, 450 * max(mon, 0) * band, 0)
        p *= np.where(sahara_arabia, 1 + 0.35 * min(mon, 0), 1)

        # --- Glaces : calottes permanentes + dômes pilotés par le volume de glace
        v = np.clip(ice_volume, 0, 1) ** 0.8
        ice = (g.LAT < -60)
        ice |= g.box(60, 90, -73, -12)                                         # Groenland
        ice |= g.box(72 - 32 * v, 90, -140, -52) & (v > 0.05)                  # Laurentide + Cordillère
        ice |= g.box(70 - 18 * v, 90, -10, 60) & (v > 0.05)                    # Fennoscandie
        ice |= (t < -14) & (elev > 1500)                                       # glaciers d'altitude
        ice &= land_frac > 0

        # --- Productivité primaire nette (modèle de Miami, Lieth 1975)
        npp_t = 3000 / (1 + np.exp(1.315 - 0.119 * t))
        npp_p = 3000 * (1 - np.exp(-0.000664 * p))
        npp = np.minimum(npp_t, npp_p)
        npp = np.where(ice | (land_frac == 0), 0, npp)

        return EarthState(year, sl, mon, land_frac, elev, rough, coast_dist, t, p, ice, npp)
