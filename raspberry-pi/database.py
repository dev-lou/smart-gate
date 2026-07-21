"""
Smart School Gate System - Local SQLite Database
=================================================
Handles all local data storage: students, guest cards,
access logs, and sync metadata. Runs offline.
"""

import json
import logging
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import config

logger = logging.getLogger(__name__)


class GateDatabase:
    """SQLite database manager for the gate controller."""

    def __init__(self, db_path: str = config.DATABASE_PATH) -> None:
        """Initialize database connection and create tables if needed."""
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self._connect()
        self._create_tables()

    def _connect(self) -> None:
        """Establish database connection."""
        try:
            self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            logger.info(f"Connected to database: {self.db_path}")
        except sqlite3.Error as e:
            logger.error(f"Database connection failed: {e}")
            raise

    def _create_tables(self) -> None:
        """Create all required tables if they don't exist."""
        cursor = self.conn.cursor()

        # Students table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS students (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                student_id TEXT UNIQUE,
                person_type TEXT NOT NULL DEFAULT 'student',
                face_embedding BLOB,
                fingerprint_id TEXT,
                uniform_type TEXT NOT NULL DEFAULT 'default',
                photo_url TEXT,
                department TEXT,
                grade TEXT,
                section TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Guest cards table (legacy RFID support)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS guest_cards (
                id TEXT PRIMARY KEY,
                card_uid TEXT NOT NULL UNIQUE,
                holder_name TEXT NOT NULL,
                purpose TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                valid_from TEXT DEFAULT (datetime('now')),
                valid_until TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Guest visits table (QR-based temporary visitor transactions)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS guest_visits (
                id TEXT PRIMARY KEY,
                visitor_name TEXT,
                purpose TEXT,
                host_person_id TEXT,
                host_name TEXT,
                department TEXT,
                contact_number TEXT,
                photo_url TEXT,
                qr_token_hash TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending_approval',
                checked_in_at TEXT,
                checked_out_at TEXT,
                entry_gate_id TEXT DEFAULT 'GATE-01',
                exit_gate_id TEXT,
                guard_in_id TEXT,
                guard_in_name TEXT,
                guard_out_id TEXT,
                guard_out_name TEXT,
                remarks TEXT,
                valid_from TEXT DEFAULT (datetime('now')),
                valid_until TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Access logs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cloud_id TEXT,
                person_id TEXT,
                person_name TEXT,
                person_type TEXT,
                guest_visit_id TEXT,
                direction TEXT NOT NULL DEFAULT 'entry',
                method TEXT NOT NULL,
                success INTEGER NOT NULL DEFAULT 0,
                confidence REAL,
                uniform_ok INTEGER,
                photo_url TEXT,
                gate_id TEXT DEFAULT 'GATE-01',
                failure_reason TEXT,
                override_operator_id TEXT,
                override_operator_name TEXT,
                override_reason TEXT,
                override_source TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                synced INTEGER NOT NULL DEFAULT 0
            )
        """)

        # Sync metadata table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # System settings cache (local copy from cloud)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Create indexes
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_students_updated ON students(updated_at)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_synced ON access_logs(synced)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON access_logs(timestamp)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_direction ON access_logs(direction)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_person_type ON access_logs(person_type)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_cards_uid ON guest_cards(card_uid)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_guest_visits_qr_hash ON guest_visits(qr_token_hash)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_guest_visits_updated ON guest_visits(updated_at)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_guest_visits_status ON guest_visits(status)"
        )

        # Initialize sync metadata
        cursor.execute("""
            INSERT OR IGNORE INTO sync_metadata (key, value)
            VALUES ('last_sync', '1970-01-01T00:00:00')
        """)

        # Backward-compatible schema migration for existing databases
        cursor.execute("PRAGMA table_info(students)")
        columns = [row[1] for row in cursor.fetchall()]
        if "person_type" not in columns:
            cursor.execute(
                "ALTER TABLE students ADD COLUMN person_type TEXT NOT NULL DEFAULT 'student'"
            )
        if "department" not in columns:
            cursor.execute("ALTER TABLE students ADD COLUMN department TEXT")

        cursor.execute("PRAGMA table_info(access_logs)")
        log_columns = [row[1] for row in cursor.fetchall()]
        log_migrations = {
            "person_type": "ALTER TABLE access_logs ADD COLUMN person_type TEXT",
            "guest_visit_id": "ALTER TABLE access_logs ADD COLUMN guest_visit_id TEXT",
            "direction": "ALTER TABLE access_logs ADD COLUMN direction TEXT NOT NULL DEFAULT 'entry'",
            "override_operator_id": "ALTER TABLE access_logs ADD COLUMN override_operator_id TEXT",
            "override_operator_name": "ALTER TABLE access_logs ADD COLUMN override_operator_name TEXT",
            "override_reason": "ALTER TABLE access_logs ADD COLUMN override_reason TEXT",
            "override_source": "ALTER TABLE access_logs ADD COLUMN override_source TEXT",
        }
        for column, sql in log_migrations.items():
            if column not in log_columns:
                cursor.execute(sql)

        self.conn.commit()
        logger.info("Database tables initialized.")

    # ========================================================
    # Student Operations
    # ========================================================

    def get_all_active_students(self) -> List[Dict[str, Any]]:
        """Get all active enrolled people with face embeddings.

        Kept as get_all_active_students for backward compatibility with
        existing face-recognition code. Rows may represent students, faculty,
        or staff via the person_type column.
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id, name, student_id, person_type, face_embedding, fingerprint_id,
                     uniform_type, photo_url, department, grade, section
            FROM students
            WHERE is_active = 1
        """)
        return [dict(row) for row in cursor.fetchall()]

    def get_all_active_people(self) -> List[Dict[str, Any]]:
        """Alias for clearer all-person terminology."""
        return self.get_all_active_students()

    def get_student_by_id(self, student_id: str) -> Optional[Dict[str, Any]]:
        """Get an enrolled person by their UUID."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM students WHERE id = ?", (student_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_person_by_id(self, person_id: str) -> Optional[Dict[str, Any]]:
        """Alias for clearer all-person terminology."""
        return self.get_student_by_id(person_id)

    def get_student_by_fingerprint(
        self, fingerprint_id: str
    ) -> Optional[Dict[str, Any]]:
        """Find an enrolled person by fingerprint template ID."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT * FROM students
            WHERE fingerprint_id = ? AND is_active = 1
        """,
            (fingerprint_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_person_by_fingerprint(
        self, fingerprint_id: str
    ) -> Optional[Dict[str, Any]]:
        """Alias for clearer all-person terminology."""
        return self.get_student_by_fingerprint(fingerprint_id)

    def get_active_people_without_fingerprint(self) -> List[Dict[str, Any]]:
        """Get active people missing fingerprint enrollment."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id, name, person_type, grade, section
            FROM students
            WHERE is_active = 1
              AND (fingerprint_id IS NULL OR TRIM(fingerprint_id) = '')
            ORDER BY
              CASE WHEN person_type = 'faculty' THEN 0 ELSE 1 END,
              name ASC
        """)
        return [dict(row) for row in cursor.fetchall()]

    def set_person_fingerprint(self, person_id: str, template_id: str) -> bool:
        """Bind a fingerprint template ID to an existing active person."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            UPDATE students
            SET fingerprint_id = ?, updated_at = ?
            WHERE id = ? AND is_active = 1
            """,
            (template_id, datetime.now().isoformat(), person_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def upsert_student(self, student: Dict[str, Any]) -> None:
        """Insert or update a student from cloud sync data."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO students (id, name, student_id, person_type, face_embedding, fingerprint_id,
                                  uniform_type, photo_url, department, grade, section,
                                  is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                student_id = excluded.student_id,
                person_type = excluded.person_type,
                face_embedding = excluded.face_embedding,
                fingerprint_id = excluded.fingerprint_id,
                uniform_type = excluded.uniform_type,
                photo_url = excluded.photo_url,
                department = excluded.department,
                grade = excluded.grade,
                section = excluded.section,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
        """,
            (
                student.get("id"),
                student.get("name"),
                student.get("student_id"),
                student.get("person_type", "student"),
                student.get("face_embedding"),
                student.get("fingerprint_id"),
                student.get("uniform_type", "default"),
                student.get("photo_url"),
                student.get("department"),
                student.get("grade"),
                student.get("section"),
                1 if student.get("is_active", True) else 0,
                student.get("created_at", datetime.now().isoformat()),
                student.get("updated_at", datetime.now().isoformat()),
            ),
        )
        self.conn.commit()
        logger.debug(f"Upserted student: {student.get('name')} ({student.get('id')})")

    # ========================================================
    # Guest Card Operations
    # ========================================================

    def get_guest_card(self, card_uid: str) -> Optional[Dict[str, Any]]:
        """Look up a guest card by its RFID UID."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT * FROM guest_cards
            WHERE card_uid = ? AND is_active = 1
              AND (valid_until IS NULL OR valid_until >= datetime('now'))
        """,
            (card_uid,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def upsert_guest_card(self, card: Dict[str, Any]) -> None:
        """Insert or update a guest card from cloud sync data."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO guest_cards (id, card_uid, holder_name, purpose,
                                     is_active, valid_from, valid_until,
                                     created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                card_uid = excluded.card_uid,
                holder_name = excluded.holder_name,
                purpose = excluded.purpose,
                is_active = excluded.is_active,
                valid_from = excluded.valid_from,
                valid_until = excluded.valid_until,
                updated_at = excluded.updated_at
        """,
            (
                card.get("id"),
                card.get("card_uid"),
                card.get("holder_name"),
                card.get("purpose"),
                1 if card.get("is_active", True) else 0,
                card.get("valid_from"),
                card.get("valid_until"),
                card.get("created_at", datetime.now().isoformat()),
                card.get("updated_at", datetime.now().isoformat()),
            ),
        )
        self.conn.commit()
        logger.debug(f"Upserted guest card: {card.get('card_uid')}")

    # ========================================================
    # Guest Visit Operations (QR visitor workflow)
    # ========================================================

    def get_guest_visit_by_qr_hash(
        self, qr_token_hash: str
    ) -> Optional[Dict[str, Any]]:
        """Look up an active guest visit by hashed QR token."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT * FROM guest_visits
            WHERE qr_token_hash = ?
              AND is_active = 1
              AND (valid_until IS NULL OR valid_until >= datetime('now'))
        """,
            (qr_token_hash,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def upsert_guest_visit(self, visit: Dict[str, Any]) -> None:
        """Insert or update a QR guest visit from cloud sync data."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO guest_visits (
                id, visitor_name, purpose, host_person_id, host_name, department,
                contact_number, photo_url, qr_token_hash, status, checked_in_at,
                checked_out_at, entry_gate_id, exit_gate_id, guard_in_id,
                guard_in_name, guard_out_id, guard_out_name, remarks, valid_from,
                valid_until, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                visitor_name = excluded.visitor_name,
                purpose = excluded.purpose,
                host_person_id = excluded.host_person_id,
                host_name = excluded.host_name,
                department = excluded.department,
                contact_number = excluded.contact_number,
                photo_url = excluded.photo_url,
                qr_token_hash = excluded.qr_token_hash,
                status = excluded.status,
                checked_in_at = excluded.checked_in_at,
                checked_out_at = excluded.checked_out_at,
                entry_gate_id = excluded.entry_gate_id,
                exit_gate_id = excluded.exit_gate_id,
                guard_in_id = excluded.guard_in_id,
                guard_in_name = excluded.guard_in_name,
                guard_out_id = excluded.guard_out_id,
                guard_out_name = excluded.guard_out_name,
                remarks = excluded.remarks,
                valid_from = excluded.valid_from,
                valid_until = excluded.valid_until,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
        """,
            (
                visit.get("id"),
                visit.get("visitor_name"),
                visit.get("purpose"),
                visit.get("host_person_id"),
                visit.get("host_name"),
                visit.get("department"),
                visit.get("contact_number"),
                visit.get("photo_url"),
                visit.get("qr_token_hash"),
                visit.get("status", "pending_approval"),
                visit.get("checked_in_at"),
                visit.get("checked_out_at"),
                visit.get("entry_gate_id", "GATE-01"),
                visit.get("exit_gate_id"),
                visit.get("guard_in_id"),
                visit.get("guard_in_name"),
                visit.get("guard_out_id"),
                visit.get("guard_out_name"),
                visit.get("remarks"),
                visit.get("valid_from"),
                visit.get("valid_until"),
                1 if visit.get("is_active", True) else 0,
                visit.get("created_at", datetime.now().isoformat()),
                visit.get("updated_at", datetime.now().isoformat()),
            ),
        )
        self.conn.commit()
        logger.debug(f"Upserted guest visit: {visit.get('id')}")

    def update_guest_visit_event(
        self,
        visit_id: str,
        direction: str,
        guard_id: Optional[str] = None,
        guard_name: Optional[str] = None,
        gate_id: str = "GATE-01",
    ) -> None:
        """Mark a guest visit as checked in or checked out locally."""
        now = datetime.now().isoformat()
        cursor = self.conn.cursor()
        normalized_direction = (direction or "entry").lower()
        if normalized_direction == "exit":
            cursor.execute(
                """
                UPDATE guest_visits
                SET status = 'completed', checked_out_at = COALESCE(checked_out_at, ?),
                    exit_gate_id = ?, guard_out_id = ?, guard_out_name = ?, updated_at = ?
                WHERE id = ?
            """,
                (now, gate_id, guard_id, guard_name, now, visit_id),
            )
        else:
            cursor.execute(
                """
                UPDATE guest_visits
                SET status = CASE
                        WHEN visitor_name IS NULL OR TRIM(visitor_name) = ''
                        THEN 'inside_pending_details'
                        ELSE 'inside_details_complete'
                    END,
                    checked_in_at = COALESCE(checked_in_at, ?),
                    entry_gate_id = ?, guard_in_id = ?, guard_in_name = ?, updated_at = ?
                WHERE id = ?
            """,
                (now, gate_id, guard_id, guard_name, now, visit_id),
            )
        self.conn.commit()

    # ========================================================
    # Access Log Operations
    # ========================================================

    def log_access(
        self,
        method: str,
        success: bool,
        person_id: Optional[str] = None,
        person_name: Optional[str] = None,
        person_type: Optional[str] = None,
        guest_visit_id: Optional[str] = None,
        direction: str = "entry",
        gate_id: str = "GATE-01",
        confidence: Optional[float] = None,
        uniform_ok: Optional[bool] = None,
        failure_reason: Optional[str] = None,
        override_operator_id: Optional[str] = None,
        override_operator_name: Optional[str] = None,
        override_reason: Optional[str] = None,
        override_source: Optional[str] = None,
    ) -> int:
        """Log an access attempt to the local database."""
        normalized_direction = (direction or "entry").lower()
        if normalized_direction not in {"entry", "exit"}:
            normalized_direction = "entry"

        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO access_logs (
                person_id, person_name, person_type, guest_visit_id, direction,
                method, success, confidence, uniform_ok, gate_id, failure_reason,
                override_operator_id, override_operator_name, override_reason,
                override_source, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                person_id,
                person_name,
                person_type,
                guest_visit_id,
                normalized_direction,
                method,
                1 if success else 0,
                confidence,
                1 if uniform_ok else (0 if uniform_ok is not None else None),
                gate_id,
                failure_reason,
                override_operator_id,
                override_operator_name,
                override_reason,
                override_source,
                datetime.now().isoformat(),
            ),
        )
        self.conn.commit()
        log_id = cursor.lastrowid
        logger.info(
            f"Access log #{log_id}: method={method}, success={success}, "
            f"person={person_name or 'unknown'}"
        )
        return log_id

    def get_unsynced_logs(self) -> List[Dict[str, Any]]:
        """Get all access logs not yet synced to cloud."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id, person_id, person_name, person_type, guest_visit_id,
                   direction, method, success, confidence, uniform_ok,
                   photo_url, gate_id, failure_reason, override_operator_id,
                   override_operator_name, override_reason, override_source,
                   timestamp
            FROM access_logs
            WHERE synced = 0
            ORDER BY timestamp ASC
        """)
        return [dict(row) for row in cursor.fetchall()]

    def mark_logs_synced(self, log_ids: List[int]) -> None:
        """Mark access logs as synced after successful push to cloud."""
        if not log_ids:
            return
        placeholders = ",".join("?" for _ in log_ids)
        cursor = self.conn.cursor()
        cursor.execute(
            f"UPDATE access_logs SET synced = 1 WHERE id IN ({placeholders})", log_ids
        )
        self.conn.commit()
        logger.info(f"Marked {len(log_ids)} logs as synced.")

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent access logs for display."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT * FROM access_logs
            ORDER BY timestamp DESC
            LIMIT ?
        """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    # ========================================================
    # Sync Metadata
    # ========================================================

    def get_last_sync_time(self) -> str:
        """Get the last sync timestamp."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT value FROM sync_metadata WHERE key = 'last_sync'")
        row = cursor.fetchone()
        return row["value"] if row else "1970-01-01T00:00:00"

    def set_last_sync_time(self, timestamp: str) -> None:
        """Update the last sync timestamp."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO sync_metadata (key, value)
            VALUES ('last_sync', ?)
        """,
            (timestamp,),
        )
        self.conn.commit()

    # ========================================================
    # System Settings (local cache)
    # ========================================================

    def get_setting(self, key: str, default: str = "") -> str:
        """Get a system setting from local cache."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT value FROM system_settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row["value"] if row else default

    def upsert_setting(self, key: str, value: str) -> None:
        """Insert or update a system setting."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
        """,
            (key, value, datetime.now().isoformat()),
        )
        self.conn.commit()

    def get_uniform_type_for_person(
        self, person: Dict[str, Any], default: str = "default"
    ) -> str:
        """Resolve expected uniform type from department policy or person record."""
        if not person:
            return default

        direct_uniform = str(person.get("uniform_type") or default or "default")
        person_type = str(person.get("person_type", "student") or "student").lower()
        if person_type != "student":
            return direct_uniform

        department = str(person.get("department") or "").strip().lower()
        if not department:
            return direct_uniform

        raw = self.get_setting("department_uniform_policies", "[]")
        try:
            policies = json.loads(raw)
        except Exception:
            policies = []

        if isinstance(policies, list):
            for policy in policies:
                if not isinstance(policy, dict):
                    continue
                policy_department = str(policy.get("department") or "").strip().lower()
                if policy_department == department:
                    return str(
                        policy.get("uniform_type") or direct_uniform or "default"
                    )

        return direct_uniform

    # ========================================================
    # Cleanup
    # ========================================================

    def close(self) -> None:
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed.")
