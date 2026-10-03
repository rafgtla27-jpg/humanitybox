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


def test_social_network_kernel_counts_people():
    from worldsim.humans import Demography
    N = np.full((GRID.ny, GRID.nx), 100.0, np.float32)
    n = Demography.network(N, 3.0)
    mid = n[60:120]  # loin des pôles
    assert np.allclose(mid, 100 * 2 * np.pi * 9, rtol=0.02)


def test_calibration_refuses_to_choose_when_everything_fails(tmp_path):
    import json

    from worldsim.calibration import TEST, TRAIN, report
    rows = [{"region": r, "target": [60000, 40000], "model_bp": None, "verdict": "jamais"} for r in TRAIN + TEST]
    d = tmp_path / "x"
    d.mkdir()
    (d / "manifest.json").write_text(json.dumps({"experiment_id": "e", "scenario": "C", "label": "C", "climate_provider": "c",
                                                 "engine_version": "x", "seed": 1, "variant": "v00", "params": {}, "regions": rows}))
    assert report(tmp_path)["chosen"] is None
    assert "rien n'est choisi" in (tmp_path / "calibration.md").read_text()


def test_rivers_feed_people_in_a_desert():
    from worldsim.humans import Ecology
    s = EARTH.state(0)
    eco = Ecology(EARTH, GRID, HumanParams())
    dry = np.zeros_like(s.npp)
    k_no = eco.carrying_capacity(s, dry, None)
    k_river = eco.carrying_capacity(s, dry, np.ones_like(dry))
    land = (s.land_frac > 0.5) & ~s.ice
    assert (k_river[land] > k_no[land]).all()


def test_boats_need_complexity():
    p = HumanParams(boat_C=0.5)
    b = Demography.boat_factor(np.array([0.2, 0.5, 0.75, 1.0]), p)
    assert b[0] == 0 and b[1] == 0 and 0.4 < b[2] < 0.6 and b[3] == 1


def test_straits_and_land_bridges():
    t = EARTH.topo

    def linked(a, b, sl):
        c = t.connectivity(sl)
        i, j = int(90 - a[0]), int(a[1] + 180)
        k, l = int(90 - b[0]), int(b[1] + 180)
        return bool(c[(k - i, l - j)][i, j])
    assert not linked((35.5, -5.5), (36.5, -5.5), -120)      # Gibraltar : jamais émergé
    assert not linked((13.5, 42.5), (13.5, 43.5), -120)      # Bab-el-Mandeb
    assert linked((65.5, -169.5), (65.5, -168.5), -120)      # Béringie au dernier maximum glaciaire
    assert not linked((65.5, -169.5), (65.5, -168.5), 0)     # … mais pas aujourd'hui
    assert linked((50.5, 1.5), (51.5, 1.5), -120)            # Manche à pied au LGM


def test_empty_cell_judged_with_newcomers_culture():
    """Régression 0.4.4 : une cellule vide voisine de gens adaptés au froid doit leur paraître habitable."""
    from worldsim.kernel import Simulation
    shape = (GRID.ny, GRID.nx)
    sim = Simulation(-1000, 0, 10, 1)
    N = np.zeros(shape, np.float32)
    c = np.zeros(shape, np.float32)
    N[20, 100] = 500
    c[20, 100] = 0.95
    sim.state["N"], sim.state["culture:N"] = N, c
    ce = Demography(HumanParams()).carried_trait(sim, "N", "culture", 3.0)
    assert ce[20, 101] > 0.9 and ce[20, 100] > 0.9 and ce[100, 100] == 0


def test_lhs_covers_each_parameter_range():
    from worldsim.calibration2 import SPACE, lhs, plan
    pts = lhs(30)
    for k, (lo, hi, _) in SPACE.items():
        v = np.array([p[k] for p in pts])
        assert v.min() >= lo * 0.999 and v.max() <= hi * 1.001
        assert v.max() - v.min() > 0.8 * (hi - lo)   # bien réparti, pas agglutiné
    assert len(plan()["include"]) == 30


def test_final_validation_is_computable_but_separate():
    from worldsim import calibration2, final_validation
    assert "final_validation" not in open(calibration2.__file__).read()  # jamais utilisé pour choisir
    regions = [{"region": n, "model_bp": v} for n, v in final_validation.REFERENCE_ORDER.items()] + [{"region": "Levant", "model_bp": 110000}]
    res = final_validation.evaluate([{"series": {"total": [5e6]}, "regions": regions}])
    assert res["passed"] and res["kendall_tau"] > 0.9  # ex aequo Chine/Australie dans la référence
