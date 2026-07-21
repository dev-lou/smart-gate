"""
Smart Gate Brain API
====================
Lightweight HTTP API so a phone/web kiosk can call Raspberry Pi face/uniform
logic without running the full OpenCV window loop.
"""

import base64
import hashlib
import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen

import config
import cv2
import numpy as np
from database import GateDatabase
from face_utils import FACE_RECOGNITION_AVAILABLE, FaceRecognizer
from sync_client import SyncClient
from uniform_utils import UniformDetector

logger = logging.getLogger("BrainAPI")
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


class SmartGateBrain:
    """In-memory brain service for face + uniform + fingerprint checks."""

    def __init__(self) -> None:
        self.db = GateDatabase()
        self.sync = SyncClient(self.db)
        self.sync.timeout = 6
        self.face = FaceRecognizer()
        self.uniform = UniformDetector()
        self.gate = None
        if getattr(config, "BRAIN_API_GATE_CONTROL_ENABLED", False):
            from gate_controller import GateController

            self.gate = GateController()
        self.photo_profiles: List[Dict[str, Any]] = []
        self._lbph = cv2.face.LBPHFaceRecognizer_create()
        self._lbph_trained = False
        self._label_to_profile: Dict[int, Dict[str, Any]] = {}
        self._haar = cv2.CascadeClassifier(
            os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        )
        self._last_sync_ts = 0.0
        self._pull_interval_sec = 45.0
        self._reload_faces()

    def maybe_sync(self, force: bool = False) -> Dict[str, Any]:
        """Keep local DB fresh while running kiosk-only brain API."""
        now = time.time()
        should_pull = force or (now - self._last_sync_ts >= self._pull_interval_sec)

        if not should_pull:
            return {"ok": True, "pulled": False, "reason": "cooldown"}

        # Admin dashboard "Sync Now" sets this flag in cloud settings.
        sync_required = False
        try:
            sync_required = self.sync.check_sync_required()
        except Exception as e:
            logger.debug("Sync flag check failed: %s", e)

        if (
            not force
            and not sync_required
            and (now - self._last_sync_ts < self._pull_interval_sec)
        ):
            return {"ok": True, "pulled": False, "reason": "cooldown"}

        self._last_sync_ts = now
        ok, counts = self.sync.pull_updates()
        if ok:
            self._reload_faces()
            return {"ok": True, "pulled": True, "counts": counts}
        return {"ok": False, "pulled": False, "counts": counts}

    def _reload_faces(self) -> None:
        students = self.db.get_all_active_students()
        count = self.face.load_known_faces(students)
        self._reload_photo_profiles(students)
        logger.info("Loaded %s known faces.", count)

    def _reload_photo_profiles(self, students: List[Dict[str, Any]]) -> None:
        """Load fallback profiles from photo_url for environments without face_recognition."""
        self.photo_profiles = []
        self._lbph_trained = False
        self._label_to_profile = {}
        lbph_images: List[np.ndarray] = []
        lbph_labels: List[int] = []
        next_label = 0

        for student in students:
            url = str(student.get("photo_url") or "").strip()
            if not url:
                continue
            frame = self._download_image(url)
            if frame is None:
                continue
            vec, _ = self._vectorize_face(frame)
            if vec is None:
                continue
            profile = {
                "id": student.get("id"),
                "name": student.get("name", "Unknown"),
                "person_type": str(student.get("person_type", "student")).lower(),
                "vector": vec,
            }
            self.photo_profiles.append(profile)

            rect = self._detect_best_face_rect(frame)
            if rect is None:
                continue
            top, right, bottom, left = rect
            face = frame[max(0, top) : max(0, bottom), max(0, left) : max(0, right)]
            if face.size == 0:
                continue

            gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)
            gray = cv2.resize(gray, (160, 160), interpolation=cv2.INTER_AREA)

            self._label_to_profile[next_label] = profile
            lbph_images.append(gray)
            lbph_labels.append(next_label)

            # Small augmentations to reduce overfitting from single photo/profile.
            lbph_images.append(cv2.GaussianBlur(gray, (3, 3), 0))
            lbph_labels.append(next_label)
            lbph_images.append(cv2.flip(gray, 1))
            lbph_labels.append(next_label)
            next_label += 1

        if lbph_images and lbph_labels:
            try:
                self._lbph.train(lbph_images, np.array(lbph_labels, dtype=np.int32))
                self._lbph_trained = True
            except Exception as e:
                logger.warning(
                    "LBPH training failed, fallback will use vector matcher: %s", e
                )
                self._lbph_trained = False

        logger.info("Loaded %s photo fallback profiles.", len(self.photo_profiles))
        logger.info(
            "LBPH trained: %s with %s labels.",
            self._lbph_trained,
            len(self._label_to_profile),
        )

    @staticmethod
    def _download_image(url: str) -> Optional[np.ndarray]:
        try:
            req = Request(url, headers={"User-Agent": "smart-gate/1.0"})
            with urlopen(req, timeout=5) as res:
                raw = res.read()
            arr = np.frombuffer(raw, dtype=np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception as e:
            logger.warning("Failed to download photo_url %s: %s", url, e)
            return None

    def _detect_best_face_rect(
        self, frame: np.ndarray
    ) -> Optional[Tuple[int, int, int, int]]:
        h, w = frame.shape[:2]
        if h < 20 or w < 20:
            return None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self._haar.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
        )
        if len(faces) > 0:
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            return int(y), int(x + fw), int(y + fh), int(x)
        return None

    def _vectorize_face(
        self, frame: np.ndarray
    ) -> Tuple[Optional[np.ndarray], Optional[Tuple[int, int, int, int]]]:
        rect = self._detect_best_face_rect(frame)
        if rect is None:
            return None, None
        top, right, bottom, left = rect
        face = frame[max(0, top) : max(0, bottom), max(0, left) : max(0, right)]
        if face.size == 0:
            return None, None

        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        # Reject very dark/flat frames (e.g., covered camera) to avoid false matches.
        if float(np.mean(gray)) < 35.0 or float(np.std(gray)) < 12.0:
            return None, rect
        gray = cv2.equalizeHist(gray)
        small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
        vec = small.astype(np.float32).reshape(-1)
        norm = float(np.linalg.norm(vec))
        if norm <= 1e-8:
            return None, rect
        vec /= norm
        return vec, rect

    def _photo_fallback_match(
        self, frame: np.ndarray
    ) -> Tuple[
        Optional[str], Optional[str], float, Optional[Tuple[int, int, int, int]], str
    ]:
        if not self.photo_profiles:
            return None, None, 0.0, None, "No photo profiles loaded from photo_url."

        probe_vec, face_rect = self._vectorize_face(frame)
        if probe_vec is None or face_rect is None:
            return None, None, 0.0, None, "No face region found for photo fallback."

        # Compute vector similarities once for margin checks and LBPH cross-check.
        best_vec = None
        best_score = -1.0
        second_best = -1.0
        for p in self.photo_profiles:
            score = float(np.dot(probe_vec, p["vector"]))
            if score > best_score:
                second_best = best_score
                best_score = score
                best_vec = p
            elif score > second_best:
                second_best = score

        margin = best_score - max(0.0, second_best)

        if self._lbph_trained:
            top, right, bottom, left = face_rect
            face = frame[max(0, top) : max(0, bottom), max(0, left) : max(0, right)]
            if face.size > 0:
                gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
                gray = cv2.equalizeHist(gray)
                gray = cv2.resize(gray, (160, 160), interpolation=cv2.INTER_AREA)
                try:
                    pred_label, lbph_conf = self._lbph.predict(gray)
                    profile = self._label_to_profile.get(int(pred_label))

                    # Relaxed thresholds for demo environments
                    lbph_ok = profile is not None and float(lbph_conf) <= 95.0
                    vec_ok = best_vec is not None and best_score >= 0.85
                    agree = (
                        lbph_ok
                        and vec_ok
                        and (
                            best_vec.get("id") == profile.get("id")
                            if profile and best_vec
                            else False
                        )
                    )

                    if agree:
                        assert profile is not None
                        similarity = max(
                            0.0,
                            min(
                                1.0,
                                (best_score * 0.55)
                                + ((1.0 - min(float(lbph_conf), 100.0) / 100.0) * 0.45),
                            ),
                        )
                        return (
                            str(profile["id"]),
                            str(profile["name"]),
                            similarity,
                            face_rect,
                            f"LBPH+vector matched (lbph={float(lbph_conf):.2f}, score={best_score:.3f}, margin={margin:.3f})",
                        )

                    return (
                        None,
                        None,
                        max(0.0, best_score),
                        face_rect,
                        f"Mismatch/weak match (lbph={float(lbph_conf):.2f}, score={best_score:.3f}, margin={margin:.3f})",
                    )
                except Exception as e:
                    logger.debug("LBPH predict failed: %s", e)

        # Balanced thresholds for photo-only fallback.
        # Strong enough to prevent most false matches while allowing noisy laptop camera frames.
        threshold = 0.92
        min_margin = 0.06

        if not best_vec or best_score < threshold:
            return (
                None,
                None,
                best_score,
                face_rect,
                f"Photo score too low ({best_score:.3f} < {threshold:.3f}).",
            )

        if len(self.photo_profiles) > 1 and margin < min_margin:
            return (
                None,
                None,
                best_score,
                face_rect,
                f"Ambiguous match (margin {margin:.3f} < {min_margin:.3f}).",
            )

        return (
            str(best_vec["id"]),
            str(best_vec["name"]),
            best_score,
            face_rect,
            "Photo fallback matched",
        )

    @staticmethod
    def simulate_analyze(scenario: str = "granted") -> Dict[str, Any]:
        """Return deterministic responses so kiosk flows can be tested end-to-end."""
        cases: Dict[str, Dict[str, Any]] = {
            "granted": {
                "status": "granted",
                "message": "[SIM] Access granted. Welcome Test Student.",
                "person_id": "sim-student-001",
                "person_name": "Test Student",
                "person_type": "student",
                "face_confidence": 0.99,
                "uniform_ok": True,
                "uniform_confidence": 0.97,
                "uniform_detail": "[SIM] Uniform matched",
            },
            "unknown_face": {
                "status": "unknown_face",
                "message": "[SIM] Face not recognized. Try fingerprint fallback.",
                "confidence": 0.12,
            },
            "no_face": {
                "status": "no_face",
                "message": "[SIM] No face detected. Please align your face.",
                "confidence": 0.0,
            },
            "denied_uniform": {
                "status": "denied_uniform",
                "message": "[SIM] Uniform check failed for Test Student.",
                "person_id": "sim-student-001",
                "person_name": "Test Student",
                "person_type": "student",
                "face_confidence": 0.96,
                "uniform_ok": False,
                "uniform_confidence": 0.21,
                "uniform_detail": "[SIM] Missing required uniform",
            },
        }
        return cases.get(scenario, cases["granted"])

    @staticmethod
    def simulate_fingerprint(template_id: str) -> Dict[str, Any]:
        """Simulate fingerprint verification responses for QA and demos."""
        tid = str(template_id or "").strip().lower()
        if tid in {"", "none", "0", "bad", "unknown"}:
            return {
                "status": "fingerprint_unknown",
                "message": "[SIM] Fingerprint template not linked to any active person.",
            }
        if tid in {"deny", "uniform-fail", "uniform_fail"}:
            return {
                "status": "denied_uniform",
                "message": "[SIM] Fingerprint matched but uniform failed for Test Student.",
                "person_id": "sim-student-001",
                "person_name": "Test Student",
                "person_type": "student",
                "uniform_ok": False,
                "uniform_confidence": 0.2,
                "uniform_detail": "[SIM] Uniform not compliant",
            }
        return {
            "status": "granted",
            "message": "[SIM] Fingerprint accepted. Welcome Test Student.",
            "person_id": "sim-student-001",
            "person_name": "Test Student",
            "person_type": "student",
            "uniform_ok": True,
        }

    @staticmethod
    def _decode_image(image_b64: str) -> Optional[np.ndarray]:
        if not image_b64:
            logger.warning("Empty image_b64 received")
            return None
        try:
            payload = image_b64
            if "," in payload and payload.lower().startswith("data:image"):
                payload = payload.split(",", 1)[1]
            raw = base64.b64decode(payload)
            if len(raw) == 0:
                logger.warning("Empty image data after base64 decode")
                return None
            arr = np.frombuffer(raw, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                logger.warning("cv2.imdecode returned None")
                return None
            logger.info(f"Successfully decoded image: {frame.shape}")
            return frame
        except Exception as e:
            logger.error(f"Image decode failed: {e}")
            return None

    def verify_face_only(self, frame: np.ndarray) -> Dict[str, Any]:
        """Face-only stage for kiosk flow: identify person without uniform decision."""
        self.maybe_sync(force=False)

        if FACE_RECOGNITION_AVAILABLE and self.face.known_encodings:
            person_id, person_name, confidence, face_location = self.face.identify_face(
                frame
            )
            detail = ""
        else:
            person_id, person_name, confidence, face_location, detail = (
                self._photo_fallback_match(frame)
            )

        if not face_location:
            return {
                "status": "no_face",
                "message": "No face detected. Please align your face.",
                "confidence": 0.0,
            }

        if not person_id:
            msg = "Face not recognized. Try again."
            if detail:
                msg = f"Face not recognized ({detail})."
            return {
                "status": "unknown_face",
                "message": msg,
                "confidence": float(confidence or 0.0),
            }

        person = self.db.get_student_by_id(person_id) or {}
        person_type = str(person.get("person_type", "student")).lower()
        if person_type == "faculty":
            display_name = f"Faculty {person_name}"
        elif person_type == "staff":
            display_name = f"Staff {person_name}"
        else:
            display_name = person_name or "Unknown"
        return {
            "status": "face_verified",
            "message": f"Face verified. Please show uniform, {display_name}.",
            "person_id": person_id,
            "person_name": display_name,
            "person_type": person_type,
            "face_confidence": float(confidence or 0.0),
        }

    def verify_uniform_only(self, person_id: str, frame: np.ndarray) -> Dict[str, Any]:
        """Uniform-only stage for an already verified person."""
        self.maybe_sync(force=False)

        person = self.db.get_student_by_id(str(person_id))
        if not person:
            return {
                "status": "unknown_face",
                "message": "Person session expired or unknown. Please scan face again.",
                "confidence": 0.0,
            }

        person_type = str(person.get("person_type", "student")).lower()
        raw_name = str(person.get("name", "Unknown"))
        if person_type == "faculty":
            display_name = f"Faculty {raw_name}"
        elif person_type == "staff":
            display_name = f"Staff {raw_name}"
        else:
            display_name = raw_name

        require_uniform = config.UNIFORM_DETECTION_ENABLED and person_type == "student"

        uniform_type = self.db.get_uniform_type_for_person(person)
        if require_uniform:
            uniform_ok, uniform_conf, uniform_detail = self.uniform.check_uniform(
                frame, uniform_type, None
            )
        else:
            uniform_ok, uniform_conf, uniform_detail = (
                True,
                1.0,
                "Skipped (non-student policy)",
            )

        if uniform_ok:
            return {
                "status": "granted",
                "message": f"Access granted. Welcome {display_name}.",
                "person_id": str(person.get("id", person_id)),
                "person_name": display_name,
                "person_type": person_type,
                "uniform_ok": True,
                "uniform_confidence": float(uniform_conf or 0.0),
                "uniform_detail": uniform_detail,
            }

        return {
            "status": "denied_uniform",
            "message": f"Uniform check failed for {display_name}.",
            "person_id": str(person.get("id", person_id)),
            "person_name": display_name,
            "person_type": person_type,
            "uniform_ok": False,
            "uniform_confidence": float(uniform_conf or 0.0),
            "uniform_detail": uniform_detail,
        }

    def analyze_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        self.maybe_sync(force=False)

        try:
            detail = ""
            if FACE_RECOGNITION_AVAILABLE and self.face.known_encodings:
                student_id, student_name, confidence, face_location = (
                    self.face.identify_face(frame)
                )
            else:
                student_id, student_name, confidence, face_location, detail = (
                    self._photo_fallback_match(frame)
                )

            if not face_location:
                return {
                    "status": "no_face",
                    "message": "No face detected. Please align your face.",
                    "confidence": 0.0,
                }

            if not student_id:
                return {
                    "status": "unknown_face",
                    "message": (
                        f"Face not recognized ({detail} confidence={float(confidence or 0.0):.3f}). "
                        "Try fingerprint fallback."
                    ),
                    "confidence": float(confidence or 0.0),
                }
        except Exception as e:
            logger.error(f"Error in analyze_frame: {e}")
            import traceback

            traceback.print_exc()
            return {
                "status": "error",
                "message": f"Processing error: {str(e)}",
                "confidence": 0.0,
            }

        if not student_id and not face_location:
            return {
                "status": "no_face",
                "message": "No face detected. Please align your face.",
                "confidence": 0.0,
            }

        if not student_id:
            return {
                "status": "unknown_face",
                "message": "Face not recognized. Try fingerprint fallback.",
                "confidence": float(confidence or 0.0),
            }

        person = self.db.get_student_by_id(student_id) or {}
        person_type = str(person.get("person_type", "student")).lower()
        uniform_type = self.db.get_uniform_type_for_person(person)
        if person_type == "faculty":
            display_name = f"Faculty {student_name}"
        elif person_type == "staff":
            display_name = f"Staff {student_name}"
        else:
            display_name = student_name or "Unknown"
        photo_url = str(person.get("photo_url") or "").strip()

        require_uniform = config.UNIFORM_DETECTION_ENABLED and person_type == "student"

        if face_location is None:
            return {
                "status": "no_face",
                "message": "No face detected. Please align your face.",
                "confidence": 0.0,
            }

        body_region = self.uniform.get_body_region_from_face(face_location, frame.shape)

        # Guardrail: head-only close-up shots must not pass uniform checks.
        # Require enough visible torso area below the face.
        top, right, bottom, left = face_location
        face_h = max(1, bottom - top)
        face_w = max(1, right - left)
        frame_h, frame_w = frame.shape[:2]
        frame_area = max(1, frame_h * frame_w)
        face_area_ratio = float((face_h * face_w) / frame_area)

        torso_visible_ok = True
        if body_region:
            b_top, b_right, b_bottom, b_left = body_region
            torso_h = max(0, b_bottom - b_top)
            torso_w = max(0, b_right - b_left)
            min_torso_h = int(max(80, face_h * 1.2))
            min_torso_w = int(max(90, face_w * 0.9))
            torso_visible_ok = torso_h >= min_torso_h and torso_w >= min_torso_w

        # If face occupies too much of the frame, user is too close to camera.
        too_close = face_area_ratio >= 0.22

        if require_uniform:
            if too_close or not torso_visible_ok:
                return {
                    "status": "denied_uniform",
                    "message": f"Please step back and show your full upper uniform, {display_name}.",
                    "person_id": student_id,
                    "person_name": display_name,
                    "person_type": person_type,
                    "photo_url": photo_url or None,
                    "face_confidence": float(confidence or 0.0),
                    "uniform_ok": False,
                    "uniform_confidence": 0.0,
                    "uniform_detail": (
                        f"Torso not visible enough (face_ratio={face_area_ratio:.2f}, "
                        f"torso_visible_ok={torso_visible_ok})"
                    ),
                }

            uniform_ok, uniform_conf, uniform_detail = self.uniform.check_uniform(
                frame, uniform_type, body_region
            )

            # Retry with a wider region when face-derived body ROI is too tight/offset.
            if not uniform_ok:
                alt_ok, alt_conf, alt_detail = self.uniform.check_uniform(
                    frame, uniform_type, None
                )
                if alt_conf > uniform_conf:
                    uniform_ok, uniform_conf, uniform_detail = (
                        alt_ok,
                        alt_conf,
                        f"{alt_detail} [roi=wide]",
                    )

            # Final guardrail: do not grant on weak uniform confidence.
            min_uniform_conf = float(
                getattr(config, "UNIFORM_MIN_CONFIDENCE_FOR_GRANT", 0.70)
            )
            if uniform_ok and float(uniform_conf or 0.0) < min_uniform_conf:
                uniform_ok = False
                uniform_detail = (
                    f"{uniform_detail} | below minimum confidence "
                    f"({float(uniform_conf or 0.0):.2f} < {min_uniform_conf:.2f})"
                )
        else:
            uniform_ok, uniform_conf, uniform_detail = (
                True,
                1.0,
                "Skipped (fallback mode or non-student)",
            )

        if uniform_ok:
            return {
                "status": "granted",
                "message": f"Access granted. Welcome {display_name}.",
                "person_id": student_id,
                "person_name": display_name,
                "person_type": person_type,
                "photo_url": photo_url or None,
                "face_confidence": float(confidence or 0.0),
                "uniform_ok": True,
                "uniform_confidence": float(uniform_conf or 0.0),
                "uniform_detail": uniform_detail,
            }

        return {
            "status": "denied_uniform",
            "message": f"Uniform check failed for {display_name}.",
            "person_id": student_id,
            "person_name": display_name,
            "person_type": person_type,
            "photo_url": photo_url or None,
            "face_confidence": float(confidence or 0.0),
            "uniform_ok": False,
            "uniform_confidence": float(uniform_conf or 0.0),
            "uniform_detail": uniform_detail,
        }

    def verify_fingerprint(
        self, template_id: str, frame: Optional[np.ndarray]
    ) -> Dict[str, Any]:
        self.maybe_sync(force=False)
        if not template_id:
            return {"status": "error", "message": "Missing template_id"}

        person = self.db.get_student_by_fingerprint(str(template_id))
        if not person:
            return {
                "status": "fingerprint_unknown",
                "message": "Fingerprint template not linked to any active person.",
            }

        person_type = str(person.get("person_type", "student")).lower()
        if person_type == "faculty":
            display_name = f"Faculty {person['name']}"
        elif person_type == "staff":
            display_name = f"Staff {person['name']}"
        else:
            display_name = person["name"]

        require_uniform = (
            config.FINGERPRINT_REQUIRES_UNIFORM and person_type == "student"
        )

        if require_uniform and frame is not None:
            uniform_type = self.db.get_uniform_type_for_person(person)
            uniform_ok, uniform_conf, uniform_detail = self.uniform.check_uniform(
                frame, uniform_type, None
            )
            if not uniform_ok:
                return {
                    "status": "denied_uniform",
                    "message": f"Fingerprint matched but uniform failed for {display_name}.",
                    "person_id": person["id"],
                    "person_name": display_name,
                    "person_type": person_type,
                    "uniform_ok": False,
                    "uniform_confidence": float(uniform_conf or 0.0),
                    "uniform_detail": uniform_detail,
                }

        return {
            "status": "granted",
            "message": f"Fingerprint accepted. Welcome {display_name}.",
            "person_id": person["id"],
            "person_name": display_name,
            "person_type": person_type,
            "uniform_ok": True if require_uniform else None,
        }

    @staticmethod
    def hash_qr_token(qr_token: str) -> str:
        """Hash a raw guest QR token for local lookup."""
        return hashlib.sha256(qr_token.strip().encode("utf-8")).hexdigest()

    def verify_registered_access(
        self,
        frame: np.ndarray,
        direction: str = "entry",
    ) -> Dict[str, Any]:
        """Verify a registered person and write an entry/exit access log."""
        normalized_direction = str(direction or "entry").strip().lower()
        if normalized_direction not in {"entry", "exit"}:
            normalized_direction = "entry"

        if normalized_direction == "exit":
            result = self.verify_face_only(frame)
            granted = result.get("status") == "face_verified"
            confidence = float(
                result.get("face_confidence", result.get("confidence", 0.0)) or 0.0
            )
            failure_reason = (
                None if granted else str(result.get("message", "Face not recognized"))
            )
            log_id = self.db.log_access(
                method="face",
                success=granted,
                person_id=result.get("person_id"),
                person_name=result.get("person_name"),
                person_type=result.get("person_type"),
                direction="exit",
                confidence=confidence,
                uniform_ok=None,
                failure_reason=failure_reason,
            )
            if granted and self.gate:
                self.gate.open_gate()
            return {
                **result,
                "status": "granted" if granted else result.get("status", "denied"),
                "access": granted,
                "direction": "exit",
                "log_id": log_id,
                "gate_triggered": bool(granted and self.gate),
            }

        result = self.analyze_frame(frame)
        granted = result.get("status") == "granted"
        face_conf = float(
            result.get("face_confidence", result.get("confidence", 0.0)) or 0.0
        )
        self.db.log_access(
            method="face",
            success=granted,
            person_id=result.get("person_id"),
            person_name=result.get("person_name"),
            person_type=result.get("person_type"),
            direction="entry",
            confidence=face_conf,
            uniform_ok=result.get("uniform_ok"),
            failure_reason=None
            if granted
            else str(result.get("message", "Access denied")),
        )
        if granted and self.gate:
            self.gate.open_gate()
        return {
            **result,
            "access": granted,
            "direction": "entry",
            "gate_triggered": bool(granted and self.gate),
        }

    def verify_guest_qr(
        self,
        qr_token: str,
        direction: str = "exit",
        guard_id: Optional[str] = None,
        guard_name: Optional[str] = None,
        gate_id: str = "GATE-01",
    ) -> Dict[str, Any]:
        """Validate a temporary guest QR pass and record entry/exit."""
        token = str(qr_token or "").strip()
        normalized_direction = str(direction or "exit").strip().lower()
        if normalized_direction not in {"entry", "exit"}:
            normalized_direction = "exit"

        if not token:
            self.db.log_access(
                method="qr",
                success=False,
                person_type="guest",
                direction=normalized_direction,
                gate_id=gate_id,
                failure_reason="Missing QR token",
            )
            return {
                "status": "invalid_qr",
                "access": False,
                "message": "Missing QR token.",
            }

        visit = self.db.get_guest_visit_by_qr_hash(self.hash_qr_token(token))
        if not visit:
            self.db.log_access(
                method="qr",
                success=False,
                person_type="guest",
                direction=normalized_direction,
                gate_id=gate_id,
                failure_reason="Guest QR not found or expired",
            )
            return {
                "status": "invalid_qr",
                "access": False,
                "message": "Guest QR not found, inactive, or expired.",
            }

        visit_status = str(visit.get("status") or "").lower()
        if visit_status in {"completed", "cancelled"}:
            self.db.log_access(
                method="qr",
                success=False,
                person_type="guest",
                guest_visit_id=str(visit.get("id")),
                person_name=visit.get("visitor_name") or "Guest Visitor",
                direction=normalized_direction,
                gate_id=gate_id,
                failure_reason=f"Guest visit already {visit_status}",
            )
            return {
                "status": "invalid_qr",
                "access": False,
                "message": f"Guest visit already {visit_status}.",
                "guest_visit_id": visit.get("id"),
            }

        visitor_name = visit.get("visitor_name") or "Guest Visitor"
        self.db.update_guest_visit_event(
            str(visit.get("id")),
            normalized_direction,
            guard_id=guard_id,
            guard_name=guard_name,
            gate_id=gate_id,
        )
        log_id = self.db.log_access(
            method="qr",
            success=True,
            person_name=visitor_name,
            person_type="guest",
            guest_visit_id=str(visit.get("id")),
            direction=normalized_direction,
            confidence=1.0,
            gate_id=gate_id,
        )

        if self.gate:
            self.gate.open_gate()

        return {
            "status": "granted",
            "access": True,
            "message": f"Guest {normalized_direction} recorded for {visitor_name}.",
            "guest_visit_id": visit.get("id"),
            "person_name": visitor_name,
            "person_type": "guest",
            "direction": normalized_direction,
            "log_id": log_id,
            "gate_triggered": bool(self.gate),
        }

    def manual_override(
        self,
        direction: str = "entry",
        operator_id: Optional[str] = None,
        operator_name: Optional[str] = None,
        reason: Optional[str] = None,
        source: str = "brain_api",
        gate_id: str = "GATE-01",
    ) -> Dict[str, Any]:
        """Record a guard/manual gate opening event."""
        normalized_direction = str(direction or "entry").strip().lower()
        if normalized_direction not in {"entry", "exit"}:
            normalized_direction = "entry"

        log_id = self.db.log_access(
            method="manual",
            success=True,
            person_type="manual",
            direction=normalized_direction,
            gate_id=gate_id,
            failure_reason=reason,
            override_operator_id=operator_id,
            override_operator_name=operator_name,
            override_reason=reason,
            override_source=source,
        )

        if self.gate:
            self.gate.open_gate()

        return {
            "status": "manual_override_logged",
            "access": True,
            "message": "Manual override recorded.",
            "direction": normalized_direction,
            "log_id": log_id,
            "gate_triggered": bool(self.gate),
        }

    def close(self) -> None:
        self.face.cleanup()
        self.uniform.cleanup()
        if self.gate:
            self.gate.cleanup()
        self.db.close()


BRAIN = SmartGateBrain()


class BrainRequestHandler(BaseHTTPRequestHandler):
    @staticmethod
    def _to_verify_payload(result: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize analyze-style result into verify endpoint shape."""
        status = str(result.get("status", "error"))
        face_conf = float(result.get("face_confidence", 0.0) or 0.0)
        uniform_conf = float(result.get("uniform_confidence", 0.0) or 0.0)
        confidence = (
            uniform_conf if status in {"granted", "denied_uniform"} else face_conf
        )
        if confidence <= 0.0:
            confidence = float(result.get("confidence", 0.0) or 0.0)
        return {
            "access": status == "granted",
            "confidence": confidence,
            "message": str(result.get("message", "")),
            "status": status,
            "person_id": result.get("person_id"),
            "person_name": result.get("person_name"),
            "person_type": result.get("person_type"),
            "photo_url": result.get("photo_url"),
            "face_confidence": face_conf,
            "uniform_confidence": uniform_conf,
            "uniform_detail": str(result.get("uniform_detail", "")),
        }

    @staticmethod
    def _to_face_payload(result: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize face-stage result payload."""
        status = str(result.get("status", "error"))
        confidence = float(
            result.get("face_confidence", result.get("confidence", 0.0)) or 0.0
        )
        return {
            "face_ok": status == "face_verified",
            "confidence": confidence,
            "message": str(result.get("message", "")),
            "status": status,
            "person_id": result.get("person_id"),
            "person_name": result.get("person_name"),
            "person_type": result.get("person_type"),
        }

    def _json_response(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json_response(
                200,
                {
                    "ok": True,
                    "service": "smart-gate-brain",
                    "face_engine_available": bool(FACE_RECOGNITION_AVAILABLE),
                    "known_face_embeddings": len(BRAIN.face.known_encodings),
                    "photo_profiles": len(BRAIN.photo_profiles),
                    "last_sync_epoch": BRAIN._last_sync_ts,
                    "gate_control_enabled": bool(BRAIN.gate),
                    "simulation_hint": 'POST /analyze or /fingerprint-verify with {"simulate": true}',
                },
            )
            return
        self._json_response(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length > 0 else b"{}"

            try:
                data = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._json_response(400, {"error": "Invalid JSON"})
                return

            if self.path == "/analyze":
                if bool(data.get("simulate", False)):
                    scenario = str(data.get("scenario", "granted")).strip().lower()
                    self._json_response(200, BRAIN.simulate_analyze(scenario))
                    return
                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return
                result = BRAIN.analyze_frame(frame)
                self._json_response(200, result)
                return

            if self.path == "/access-verify":
                if bool(data.get("simulate", False)):
                    scenario = str(data.get("scenario", "granted")).strip().lower()
                    result = BRAIN.simulate_analyze(scenario)
                    payload = self._to_verify_payload(result)
                    payload["direction"] = str(data.get("direction", "entry"))
                    self._json_response(200, payload)
                    return

                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return
                result = BRAIN.verify_registered_access(
                    frame,
                    direction=str(data.get("direction", "entry")),
                )
                payload = self._to_verify_payload(result)
                payload.update(
                    {
                        "direction": result.get("direction"),
                        "log_id": result.get("log_id"),
                        "gate_triggered": result.get("gate_triggered", False),
                    }
                )
                self._json_response(200, payload)
                return

            if self.path == "/verify":
                if bool(data.get("simulate", False)):
                    scenario = str(data.get("scenario", "granted")).strip().lower()
                    result = BRAIN.simulate_analyze(scenario)
                    self._json_response(200, self._to_verify_payload(result))
                    return

                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return

                result = BRAIN.analyze_frame(frame)
                self._json_response(200, self._to_verify_payload(result))
                return

            if self.path == "/verify-face":
                if bool(data.get("simulate", False)):
                    self._json_response(
                        200,
                        {
                            "face_ok": True,
                            "confidence": 0.99,
                            "message": "[SIM] Face verified. Please show uniform.",
                            "status": "face_verified",
                            "person_id": "sim-student-001",
                            "person_name": "Test Student",
                        },
                    )
                    return

                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return

                result = BRAIN.verify_face_only(frame)
                self._json_response(200, self._to_face_payload(result))
                return

            if self.path == "/verify-uniform":
                person_id = str(data.get("person_id", "")).strip()
                if not person_id:
                    self._json_response(400, {"error": "Missing person_id"})
                    return

                if bool(data.get("simulate", False)):
                    scenario = str(data.get("scenario", "granted")).strip().lower()
                    result = BRAIN.simulate_analyze(scenario)
                    self._json_response(200, self._to_verify_payload(result))
                    return

                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return

                result = BRAIN.verify_uniform_only(person_id, frame)
                self._json_response(200, self._to_verify_payload(result))
                return

            if self.path == "/fingerprint-verify":
                template_id = str(data.get("template_id", "")).strip()
                if bool(data.get("simulate", False)):
                    self._json_response(200, BRAIN.simulate_fingerprint(template_id))
                    return
                frame = None
                image_b64 = str(data.get("image_b64", "")).strip()
                if image_b64:
                    frame = BRAIN._decode_image(image_b64)
                result = BRAIN.verify_fingerprint(template_id, frame)
                self._json_response(200, result)
                return

            if self.path == "/sync-now":
                result = BRAIN.maybe_sync(force=True)
                self._json_response(200, result)
                return

            if self.path == "/qr-verify":
                result = BRAIN.verify_guest_qr(
                    qr_token=str(data.get("qr_token", "")),
                    direction=str(data.get("direction", "exit")),
                    guard_id=data.get("guard_id"),
                    guard_name=data.get("guard_name"),
                    gate_id=str(data.get("gate_id", "GATE-01") or "GATE-01"),
                )
                self._json_response(200, result)
                return

            if self.path == "/manual-override":
                result = BRAIN.manual_override(
                    direction=str(data.get("direction", "entry")),
                    operator_id=data.get("operator_id"),
                    operator_name=data.get("operator_name"),
                    reason=data.get("reason"),
                    source=str(data.get("source", "brain_api")),
                    gate_id=str(data.get("gate_id", "GATE-01") or "GATE-01"),
                )
                self._json_response(200, result)
                return

            if self.path == "/detect-uniform":
                image_b64 = str(data.get("image_b64", ""))
                frame = BRAIN._decode_image(image_b64)
                if frame is None:
                    self._json_response(400, {"error": "Invalid image_b64"})
                    return
                uniform_ok, uniform_conf, uniform_detail = BRAIN.uniform.check_uniform(
                    frame, "default", None
                )
                self._json_response(
                    200,
                    {
                        "status": "uniform_checked",
                        "uniform_ok": uniform_ok,
                        "uniform_confidence": float(uniform_conf),
                        "uniform_detail": uniform_detail,
                    },
                )
                return

            self._json_response(404, {"error": "Not found"})
        except Exception as e:
            logger.error(f"Error handling POST: {e}", exc_info=True)
            self._json_response(500, {"error": str(e)})

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("%s - %s", self.address_string(), format % args)


def main() -> None:
    host = os.getenv("BRAIN_API_HOST", "0.0.0.0")
    port = int(os.getenv("BRAIN_API_PORT", "8088"))
    server = ThreadingHTTPServer((host, port), BrainRequestHandler)
    logger.info("Brain API running at http://%s:%s", host, port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Brain API shutting down...")
    finally:
        server.server_close()
        BRAIN.close()


if __name__ == "__main__":
    main()
