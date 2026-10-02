"""
WORLD_SIM — publication d'un run exporté dans Supabase.

Variables d'environnement (jamais dans le code, jamais côté navigateur) :
    SUPABASE_URL                 https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    clé service_role (contourne RLS : réservée à la CI)

Aucune dépendance : HTTP brut vers Storage et PostgREST.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

BUCKET = "runs"


class SupabaseError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def _env():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SupabaseError("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies")
    return url, key


def _request(method: str, url: str, key: str, body: bytes, content_type: str, extra: dict | None = None):
    headers = {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": content_type, **(extra or {})}
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SupabaseError(f"{method} {url} -> {e.code}: {e.read().decode(errors='replace')[:500]}") from None


def upload(path_in_bucket: str, data: bytes, content_type: str) -> None:
    url, key = _env()
    _request("POST", f"{url}/storage/v1/object/{BUCKET}/{path_in_bucket}", key, data, content_type,
             {"x-upsert": "true", "cache-control": "max-age=31536000"})


def insert(table: str, rows: list[dict] | dict, returning: bool = False):
    url, key = _env()
    prefer = "return=representation" if returning else "return=minimal"
    return _request("POST", f"{url}/rest/v1/{table}", key, json.dumps(rows).encode(), "application/json",
                    {"Prefer": prefer})


def publish_run(export_dir: Path, manifest: dict) -> str:
    """Upload des fichiers puis insertion des lignes. Renvoie l'id du run."""
    rows = insert("runs", {
        "experiment_id": manifest["experiment_id"],
        "scenario": manifest["scenario"],
        "label": manifest["label"],
        "seed": manifest["seed"],
        "params": manifest["params"],
        "climate_provider": manifest["climate_provider"],
        "engine_version": manifest["engine_version"],
        "git_sha": manifest["git_sha"],
        "start_year": manifest["start_year"],
        "end_year": manifest["end_year"],
        "has_frames": bool(manifest["frames"]["years"]),
    }, returning=True)
    run_id = rows[0]["id"]
    prefix = f"{manifest['experiment_id']}/{run_id}"

    manifest = {**manifest, "id": run_id}
    upload(f"{prefix}/manifest.json", json.dumps(manifest, ensure_ascii=False).encode(), "application/json")
    if manifest["frames"]["years"]:
        upload(f"{prefix}/frames.bin.gz", (export_dir / "frames.bin.gz").read_bytes(), "application/octet-stream")
    if manifest.get("extra"):
        upload(f"{prefix}/layers.bin.gz", (export_dir / "layers.bin.gz").read_bytes(), "application/octet-stream")
    if manifest.get("climate"):
        upload(f"{prefix}/climate.bin.gz", (export_dir / "climate.bin.gz").read_bytes(), "application/octet-stream")

    insert("region_results", [{
        "run_id": run_id, "region": r["region"], "model_bp": r["model_bp"],
        "target_oldest_bp": r["target"][0], "target_youngest_bp": r["target"][1], "verdict": r["verdict"],
    } for r in manifest["regions"]])
    if manifest["events"]:
        insert("events", [{"run_id": run_id, "year": e["year"], "kind": e["kind"], "region": e["region"],
                           "data": e["data"]} for e in manifest["events"]])
    _request("PATCH", f"{_env()[0]}/rest/v1/runs?id=eq.{run_id}", _env()[1],
             json.dumps({"storage_prefix": prefix}).encode(), "application/json")
    return run_id
