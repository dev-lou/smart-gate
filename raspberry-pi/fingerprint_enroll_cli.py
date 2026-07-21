"""
Smart School Gate - Fingerprint Enrollment CLI
==============================================
Enrolls fingerprints for active students/faculty without requiring admin to
pre-fill template IDs manually.
"""

from database import GateDatabase
from fingerprint_utils import FingerprintSensor


def main() -> None:
    db = GateDatabase()
    sensor = FingerprintSensor()

    try:
        pending = db.get_active_people_without_fingerprint()
        if not pending:
            print("No active people pending fingerprint enrollment.")
            return

        print("\n=== Pending Fingerprint Enrollment ===")
        for i, person in enumerate(pending, start=1):
            role = str(person.get("person_type", "student")).title()
            print(f"[{i}] {person['name']} ({role})")

        print("\nSelect a person to enroll (number), or 0 to cancel:")
        raw = input("> ").strip()
        if not raw.isdigit() or int(raw) < 0 or int(raw) > len(pending):
            print("Invalid selection.")
            return

        idx = int(raw)
        if idx == 0:
            print("Enrollment cancelled.")
            return

        selected = pending[idx - 1]
        print(f"\nEnrolling fingerprint for: {selected['name']}")
        print("Follow scanner instructions...")

        ok, result = sensor.enroll_fingerprint()
        if not ok:
            print(f"Enrollment failed: {result}")
            return

        template_id = str(result)
        if db.set_person_fingerprint(selected["id"], template_id):
            print(
                f"Enrollment complete. {selected['name']} is now linked to template ID {template_id}."
            )
        else:
            print("Enrollment captured but failed to update local database.")

    finally:
        sensor.cleanup()
        db.close()


if __name__ == "__main__":
    main()
