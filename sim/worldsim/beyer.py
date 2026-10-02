"""
WORLD_SIM — EarthProvider fondé sur Beyer, Krapp & Manica (2020)
« High-resolution terrestrial climate, bioclimate and vegetation for the last 120,000 years »
Sci Data 7, 236. doi:10.1038/s41597-020-0552-1

Fichier utilisé : la version repackagée par pastclim (Zenodo 7388091)
    Beyer2020_annual_vars_v1.2.2.nc
    dims  : time (72 tranches, années depuis 1950, négatives), latitude (-59.75..89.75,
            croissante), longitude (-179.75..179.75) ; 0,5° ; Antarctique absent
    vars  : bio01 (°C), bio12 (mm/an), npp (gC/m²/an), biome (BIOME4, 28 = glace),
            altitude (m), rugosity (m)
    mer   : NaN (le trait de côte suit le niveau marin de la reconstruction)
    glace : masquée dans les variables climatiques, codée 28 dans `biome`

Agrégation 0,5° → 1° par blocs 2×2, puis interpolation linéaire entre tranches
temporelles (pas de 1 000 à 2 000 ans selon l'époque).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy import ndimage

from .earth import DATA, KM_PER_DEG, EarthState, Grid, monsoon_index, sea_level

BEYER_FILE = DATA / "Beyer2020_annual_vars_v1.2.2.nc"
BEYER_URL = "https://zenodo.org/record/7388091/files/Beyer2020_annual_vars_v1.2.2.nc?download=1"
ICE_BIOME = 28
GC_TO_DRY_MATTER = 2.2  # la matière sèche végétale contient ~45 % de carbone
VARS = {"temperature": "bio01", "precipitation": "bio12", "npp": "npp", "altitude": "altitude", "rugosity": "rugosity"}


def _find(names, *candidates):
    for c in candidates:
        for n in names:
            if n.lower() == c:
                return n
    for c in candidates:
        for n in names:
            if c in n.lower():
                return n
    raise KeyError(f"aucune dimension parmi {candidates} dans {list(names)}")


def _block_nanmean(a: np.ndarray, f: int) -> np.ndarray:
    """Moyenne par blocs f×f sur les deux derniers axes, en ignorant NaN."""
    *lead, ny, nx = a.shape
    b = a.reshape(*lead, ny // f, f, nx // f, f)
    with np.errstate(invalid="ignore"):
        valid = np.isfinite(b)
        s = np.where(valid, b, 0).sum(axis=(-3, -1))
        n = valid.sum(axis=(-3, -1))
        return np.where(n > 0, s / np.maximum(n, 1), np.nan)


class BeyerPaleoEarth:
    name = "beyer2020-v1.2.2"

    def __init__(self, grid: Grid, path: Path = BEYER_FILE):
        try:
            import netCDF4
        except ImportError as e:
            raise ImportError("pip install netCDF4  (ou pip install -e '.[climate]')") from e
        if not Path(path).exists():
            raise FileNotFoundError(f"{path} introuvable. Lancer : python scripts/fetch_data.py --beyer")
        self.grid = grid
        with netCDF4.Dataset(path) as ds:
            ds.set_auto_mask(False)
            t_name = _find(ds.variables, "time")
            la_name = _find(ds.variables, "latitude", "lat")
            lo_name = _find(ds.variables, "longitude", "lon")
            times = np.asarray(ds[t_name][:], dtype=np.float64)
            lat = np.asarray(ds[la_name][:], dtype=np.float64)
            lon = np.asarray(ds[lo_name][:], dtype=np.float64)
            res = abs(lat[1] - lat[0])
            f = int(round(grid.res / res))
            if f < 1 or abs(f * res - grid.res) > 1e-6:
                raise ValueError(f"résolution source {res}° incompatible avec la grille {grid.res}°")

            def load(var: str) -> np.ndarray:
                v = ds[var]
                order = [v.dimensions.index(d) for d in (t_name, la_name, lo_name)]
                a = np.transpose(np.asarray(v[:], dtype=np.float32), order)
                fill = getattr(v, "_FillValue", None)
                if fill is not None:
                    a[a == fill] = np.nan
                a[np.abs(a) > 1e20] = np.nan
                return a

            raw = {k: load(v) for k, v in VARS.items()}
            biome = load("biome")

        # Placement sur une grille globale par coordonnées : le fichier réel ne couvre que
        # -60°..90° (l'Antarctique est exclu) et l'ordre des axes peut varier.
        ny_src, nx_src = int(round(180 / res)), int(round(360 / res))
        lon = ((lon + 180) % 360) - 180
        rows = np.round((90 - lat) / res - 0.5).astype(int)
        cols = np.round((lon + 180) / res - 0.5).astype(int)
        if rows.min() < 0 or rows.max() >= ny_src or cols.min() < 0 or cols.max() >= nx_src:
            raise ValueError("coordonnées hors de la grille globale attendue")

        def to_global(a: np.ndarray) -> np.ndarray:
            out = np.full((a.shape[0], ny_src, nx_src), np.nan, dtype=np.float32)
            out[:, rows[:, None], cols[None, :]] = a
            return out

        raw = {k: to_global(v) for k, v in raw.items()}
        biome = to_global(biome)

        ice = biome == ICE_BIOME
        land = np.isfinite(biome) & (biome > 0)
        order = np.argsort(times)
        self.times = times[order]
        self.fields = {k: _block_nanmean(v[order], f) for k, v in raw.items()}
        self.land_frac = _block_nanmean(land[order].astype(np.float32), f)
        self.ice_frac = _block_nanmean(ice[order].astype(np.float32), f)
        self._coast_cache: dict[int, np.ndarray] = {}  # par masque terre/mer

    @property
    def span(self) -> tuple[int, int]:
        return int(self.times[0]), int(self.times[-1])

    def _bracket(self, year: int):
        t = self.times
        y = float(np.clip(year, t[0], t[-1]))
        k = int(np.clip(np.searchsorted(t, y), 1, len(t) - 1))
        w = (y - t[k - 1]) / (t[k] - t[k - 1])
        return k - 1, k, w

    def _lerp(self, a: np.ndarray, i: int, j: int, w: float) -> np.ndarray:
        x, y = a[i], a[j]
        out = (1 - w) * x + w * y
        # Cellule présente d'un seul côté (côte qui avance ou recule) : on garde la valeur connue
        return np.where(np.isfinite(out), out, np.where(np.isfinite(x), x, y))

    def state(self, year: int) -> EarthState:
        i, j, w = self._bracket(year)
        land_frac = (1 - w) * self.land_frac[i] + w * self.land_frac[j]
        ice_frac = (1 - w) * self.ice_frac[i] + w * self.ice_frac[j]
        t = self._lerp(self.fields["temperature"], i, j, w)
        p = self._lerp(self.fields["precipitation"], i, j, w)
        npp = self._lerp(self.fields["npp"], i, j, w) * GC_TO_DRY_MATTER
        elev = np.nan_to_num(self._lerp(self.fields["altitude"], i, j, w))
        rough = np.nan_to_num(self._lerp(self.fields["rugosity"], i, j, w))

        mask = land_frac > 0.5
        key = hash(mask.tobytes())
        if key not in self._coast_cache:
            self._coast_cache[key] = ndimage.distance_transform_edt(mask, sampling=(KM_PER_DEG, KM_PER_DEG * 0.75))
        ice = (ice_frac > 0.5) & (land_frac > 0)
        npp = np.where(ice | (land_frac == 0), 0, np.nan_to_num(npp))
        return EarthState(year, sea_level(year), monsoon_index(year), land_frac, elev, rough,
                          self._coast_cache[key], np.nan_to_num(t, nan=-30.0), np.nan_to_num(p), ice, npp)
