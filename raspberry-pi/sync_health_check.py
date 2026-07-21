"""
Smart School Gate System - Sync Health Check
============================================
Runs a practical cloud-to-local sync verification and prints integrity results.
Use this before hardware purchase/deployment to validate data flow reliability.
"""

import json
import os
import sys
from typing import List, Tuple

import cv2

from database import GateDatabase
from sync_client import SyncClient


def _read_scalar(db: GateDatabase, query: str, params: Tuple = ()) -> int:
    cursor = db.conn.cursor()
    cursor.execute(query, params)
    row = cursor.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _get_setting_value(db: GateDatabase, key: str) -> str:
    cursor = db.conn.cursor()
    cursor.execute("SELECT value FROM system_settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    return str(row[0]) if row and row[0] is not None else ""


def _collect_uniform_keys(db: GateDatabase) -> List[str]:
    raw_list = _get_setting_value(db, "uniform_ref_list").strip()
    if raw_list:
        try:
            parsed = json.loads(raw_list)
            if isinstance(parsed, list):
                keys = [str(k).strip() for k in parsed if str(k).strip()]
                return sorted(list(set(keys)))
        except json.JSONDecodeError:
            pass

    cursor = db.conn.cursor()
    cursor.execute(
        """
        SELECT key
        FROM system_settings
        WHERE key LIKE 'uniform_ref_%'
          AND key NOT LIKE 'uniform_ref_name_%'
          AND key <> 'uniform_ref_list'
        ORDER BY key ASC
        """
    )
    return [str(row[0]) for row in cursor.fetchall()]


def run_health_check() -> int:
    print("\n=== Smart Gate Sync Health Check ===")

    db = GateDatabase()
    client = SyncClient(db)

    sync_ok, summary = client.full_sync()
    print(f"Sync summary: {summary}")

    active_students = _read_scalar(db, "SELECT COUNT(*) FROM students WHERE is_active = 1")
    active_cards = _read_scalar(db, "SELECT COUNT(*) FROM guest_cards WHERE is_active = 1")
    setting_count = _read_scalar(db, "SELECT COUNT(*) FROM system_settings")

    print("\nLocal cache counts:")
    print(f"- Active students: {active_students}")
    print(f"- Active guest cards: {active_cards}")
    print(f"- System settings: {setting_count}")

    uniform_keys = _collect_uniform_keys(db)
    uniforms_dir = os.path.join(os.path.dirname(__file__), "data", "uniforms")

    missing_url = []
    missing_file = []
    invalid_image = []

    for key in uniform_keys:
        url = _get_setting_value(db, key).strip()
        if not url.startswith("http"):
            missing_url.append(key)
            continue

        local_file = os.path.join(uniforms_dir, f"{key}.jpg")
        if not os.path.exists(local_file):
            missing_file.append(key)
            continue

        img = cv2.imread(local_file)
        if img is None or img.size == 0:
            invalid_image.append(key)

    print("\nUniform reference integrity:")
    print(f"- Keys discovered: {len(uniform_keys)}")
    print(f"- Missing cloud URL: {len(missing_url)}")
    print(f"- Missing local file: {len(missing_file)}")
    print(f"- Invalid local image: {len(invalid_image)}")

    if missing_url:
        print("  Missing URL keys:", ", ".join(missing_url))
    if missing_file:
        print("  Missing file keys:", ", ".join(missing_file))
    if invalid_image:
        print("  Invalid image keys:", ", ".join(invalid_image))

    db.close()

    has_integrity_issue = bool(missing_url or missing_file or invalid_image)
    if sync_ok and not has_integrity_issue:
        print("\nRESULT: PASS - Cloud->local sync and uniform cache look healthy.")
        return 0

    print("\nRESULT: WARNING - Review issues above before hardware deployment.")
    return 1


if __name__ == "__main__":
    sys.exit(run_health_check())
