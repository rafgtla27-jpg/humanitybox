"""Invariants du moteur. Lancer : python -m pytest tests -q"""
import numpy as np

from worldsim.earth import Grid, ParametricPaleoEarth, sea_level
from worldsim.experiment import run
from worldsim.humans import ADJ, Demography, HumanParams
from worldsim.kernel import RngStreams

GRID = Grid(1.0)
EARTH = ParametricPaleoEarth(GRID)


def test_migration_conserves_people():
    rng = np.random.default_rng(0)
    shape = (GRID.ny, GRID.nx)
    N = rng.uniform(0, 1000, shape).astype(np.float32)
    room = rng.uniform(0, 1, shape).astype(np.float32)
    room[0] = room[-1] = 0  # pas de sortie par les pôles
    out_rate = np.full(shape, 0.3, np.float32)
    d = Demography(HumanParams())
    coefs = [(di, dj, np.float32(w)) for di, dj, w in ADJ]
    N2 = d.migrate(N, room, out_rate, coefs)
    assert np.isclose(N.sum(dtype=np.float64), N2.sum(dtype=np.float64), rtol=1e-5)


def test_same_seed_same_world():
    a = run(seed=7, start=-60_000, end=-58_000, grid=GRID, earth=EARTH)
    b = run(seed=7, start=-60_000, end=-58_000, grid=GRID, earth=EARTH)
    assert a.tracker.total == b.tracker.total


def test_streams_are_independent_of_creation_order():
    r1, r2 = RngStreams(3), RngStreams(3)
    r1.get("climat")
    assert r1.get("demography").random() == r2.get("demography").random()


def test_sea_level_lgm():
    assert sea_level(-21_000) < -110
    assert abs(sea_level(0)) < 1


def test_bering_land_bridge_at_lgm():
    bering = GRID.box(64, 67, -172, -166)
    lf_lgm = EARTH.state(-21_000).land_frac[bering].mean()
    lf_now = EARTH.state(0).land_frac[bering].mean()
    assert lf_lgm > 0.9 and lf_now < 0.6


def test_export_writes_frames_and_climate(tmp_path):
    import gzip
    import json

    from worldsim.export import export_run
    from worldsim.publish import configured

    r = run(seed=1, start=-60_000, end=-56_000, grid=GRID, earth=EARTH, snapshot_every=2000)
    m = export_run(r, GRID, tmp_path, {"experiment_id": "t", "scenario": "A", "label": "t", "seed": 1,
                                       "params": {}, "climate_provider": EARTH.name,
                                       "start_year": -60_000, "end_year": -56_000})
    n = len(m["frames"]["years"])
    plane = GRID.ny * GRID.nx
    assert len(gzip.decompress((tmp_path / "frames.bin.gz").read_bytes())) == n * 3 * plane
    assert len(gzip.decompress((tmp_path / "climate.bin.gz").read_bytes())) == n * 3 * plane
    assert json.loads((tmp_path / "manifest.json").read_text())["climate"]["layers"] == ["temperature", "precipitation", "npp"]
    assert configured() is False  # pas de secrets en test : la publication doit être ignorée, pas planter
