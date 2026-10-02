"""V0.3 : rivières émergentes, eau disponible, trait culturel porté par la migration."""
import numpy as np

from worldsim.earth import Grid, ParametricPaleoEarth
from worldsim.humans import ADJ, Demography, HumanParams, cold_factor
from worldsim.hydrology import Hydrology, runoff_mm

GRID = Grid(1.0)
EARTH = ParametricPaleoEarth(GRID)
HYDRO = Hydrology(GRID, EARTH.topo)


def _cell(lat, lon):
    return int(90 - lat) * GRID.nx + int(lon + 180)


def test_nile_emerges_from_relief_and_rain():
    """Depuis le lac Victoria, l'eau doit couler vers le nord jusqu'en Égypte."""
    c = _cell(0.5, 32.5)
    lats = []
    for _ in range(200):
        if c < 0:
            break
        i, j = divmod(c, GRID.nx)
        lats.append((GRID.lat[i], GRID.lon[j]))
        c = HYDRO.receiver[c]
    assert max(lat for lat, _ in lats) > 27
    assert all(25 < lon < 37 for _, lon in lats)


def test_big_rivers_and_dry_desert():
    s = EARTH.state(0)
    q = HYDRO.discharge_m3s(s.precipitation, s.temperature, s.land_frac > 0.3)
    amazon = q[GRID.box(-3, 1, -52, -48)].max()
    sahara = q[GRID.box(20, 26, 0, 15)].max()
    assert amazon > 10_000 and sahara < 100


def test_budyko_bounds():
    p = np.array([0.0, 50, 500, 3000])
    r = runoff_mm(p, np.full(4, 20.0))
    assert np.all(r >= 0) and np.all(r <= p) and r[0] == 0 and r[-1] > r[-2]


def test_hyperarid_has_no_water_but_river_does():
    w = Hydrology.water_availability(np.array([20.0, 20.0, 800.0]), np.array([25.0, 25.0, 15.0]),
                                     np.array([0.0, 2000.0, 0.0]))
    assert w[0] == 0 and w[1] == 1 and w[2] == 1


def test_cultural_trait_mass_is_conserved_by_migration():
    rng = np.random.default_rng(1)
    shape = (GRID.ny, GRID.nx)
    N = rng.uniform(10, 1000, shape).astype(np.float32)
    c = rng.uniform(0, 1, shape).astype(np.float32)
    room = rng.uniform(0, 1, shape).astype(np.float32)
    room[0] = room[-1] = 0
    coefs = [(di, dj, np.float32(w)) for di, dj, w in ADJ]
    N2, (Nc2,) = Demography(HumanParams()).migrate(N, room, np.full(shape, 0.3, np.float32), coefs, carried=(N * c,))
    assert np.isclose(N.sum(dtype=np.float64), N2.sum(dtype=np.float64), rtol=1e-4)
    assert np.isclose((N * c).sum(dtype=np.float64), Nc2.sum(dtype=np.float64), rtol=1e-4)
    c2 = Nc2 / N2
    assert c2.min() >= -1e-5 and c2.max() <= 1 + 1e-5


def test_culture_extends_cold_tolerance():
    p = HumanParams()
    t = np.array([-20.0])
    assert cold_factor(t, p, 0.0)[0] == 0
    assert cold_factor(t, p, 1.0)[0] > 0.3


def test_ensemble_summary_probabilities():
    from worldsim.ensemble import score, summarize
    def m(seed, a):
        return {"experiment_id": "e", "scenario": "B", "label": "B", "climate_provider": "c", "engine_version": "0.3.0",
                "seed": seed, "regions": [{"region": "Australie", "target": [65000, 45000], "model_bp": a}]}
    sm = summarize([m(1, 50000), m(2, 40000), m(3, None), m(4, 60000)])[0]
    r = sm["regions"][0]
    assert sm["n_runs"] == 4 and r["p_reached"] == 0.75 and r["p_in_range"] == 0.5
    assert score(sm) == 0.5


def test_contingency_makes_worlds_differ_but_seed_is_reproducible():
    from worldsim.experiment import run
    a = run(seed=1, start=-120_000, end=-116_000, grid=GRID, earth=EARTH)
    b = run(seed=2, start=-120_000, end=-116_000, grid=GRID, earth=EARTH)
    a2 = run(seed=1, start=-120_000, end=-116_000, grid=GRID, earth=EARTH)
    assert a.tracker.total == a2.tracker.total
    assert a.tracker.total != b.tracker.total


def test_calibration_ranks_on_train_only(tmp_path):
    import json

    from worldsim.calibration import TEST, TRAIN, report, variants
    assert len(variants()) == 18
    assert not set(TRAIN) & set(TEST)
    regions_all = TRAIN + TEST

    def manifest(variant, seed, good_train, good_test):
        rows = []
        for r in regions_all:
            good = good_train if r in TRAIN else good_test
            rows.append({"region": r, "target": [60000, 40000], "model_bp": 50000 if good else 90000, "verdict": ""})
        return {"experiment_id": "e", "scenario": "B", "label": "B", "climate_provider": "c", "engine_version": "x",
                "seed": seed, "variant": variant, "params": {"adv_max": 0.2, "cx_n0": 2000, "archaic_C": 0.4},
                "regions": rows}
    for v, gt, gs in [("v00", True, False), ("v01", False, True)]:
        for seed in (1, 2):
            d = tmp_path / f"{v}_{seed}"
            d.mkdir()
            (d / "manifest.json").write_text(json.dumps(manifest(v, seed, gt, gs)))
    res = report(tmp_path)
    # v00 gagne sur l'entraînement même si v01 serait meilleure en test : on ne triche pas
    assert res["chosen"]["variant"] == "v00" and res["chosen"]["test"] == 0
