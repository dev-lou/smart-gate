"""
Smart School Gate System - Face Recognition Utilities
======================================================
Handles face detection, embedding generation, and matching
using the face_recognition library. Optionally supports
MediaPipe as an alternative face detector.
"""

import logging
import base64
import json
import pickle
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

import config

logger = logging.getLogger(__name__)

# Try to import face_recognition
try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
    logger.info("face_recognition library loaded successfully.")
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    # FOR DEMO: Enable mock mode if missing
    logger.warning("face_recognition library not available. USING MOCK MODE FOR TESTING.")

# Try to import MediaPipe as fallback detector
try:
    import mediapipe as mp
    # Initialize the solutions modules explicitly to avoid AttributeError
    import mediapipe.python.solutions.face_detection as mp_face_detection
    import mediapipe.python.solutions.drawing_utils as mp_drawing
    MEDIAPIPE_AVAILABLE = True
    logger.info("MediaPipe loaded as alternative face detector.")
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    logger.info("MediaPipe not available. Using face_recognition for detection.")
except AttributeError:
    # Alternative import structure for some MediaPipe versions
    try:
        import mediapipe as mp
        mp_face_detection = mp.solutions.face_detection
        mp_drawing = mp.solutions.drawing_utils
        MEDIAPIPE_AVAILABLE = True
        logger.info("MediaPipe loaded as alternative face detector.")
    except Exception as e:
        MEDIAPIPE_AVAILABLE = False
        logger.info(f"MediaPipe not available ({e}).")

class FaceRecognizer:
    """Handles face detection, encoding, and matching."""

    def __init__(self) -> None:
        """Initialize the face recognizer with known face encodings."""
        self.known_encodings: List[np.ndarray] = []
        self.known_ids: List[str] = []
        self.known_names: List[str] = []
        self.threshold: float = config.FACE_RECOGNITION_THRESHOLD
        self.model: str = config.FACE_DETECTION_MODEL
        self.resize_factor: float = config.FRAME_RESIZE_FACTOR

        # Initialize MediaPipe face detector if available and needed
        self._mp_detector = None
        self._haar_detector = None
        if MEDIAPIPE_AVAILABLE:
            self._mp_detector = mp_face_detection.FaceDetection(
                model_selection=0,
                min_detection_confidence=0.5
            )
        if not FACE_RECOGNITION_AVAILABLE:
            haar_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            self._haar_detector = cv2.CascadeClassifier(haar_path)

        logger.info(
            f"FaceRecognizer initialized (threshold={self.threshold}, "
            f"model={self.model})"
        )

    def _decode_embedding_blob(self, embedding_blob: Any) -> Optional[np.ndarray]:
        """Decode stored embedding formats into a normalized numpy vector."""
        if embedding_blob is None:
            return None

        # Primary format: pickled numpy array from local enrollment/sync.
        if isinstance(embedding_blob, (bytes, bytearray, memoryview)):
            raw = bytes(embedding_blob)
            try:
                encoding = pickle.loads(raw)
                if isinstance(encoding, np.ndarray) and encoding.size == 128:
                    return encoding.astype(np.float64)
            except Exception:
                pass

            # Fallback for raw binary vectors (float64 or float32).
            for dtype in (np.float64, np.float32):
                try:
                    encoding = np.frombuffer(raw, dtype=dtype)
                    if encoding.size == 128:
                        return encoding.astype(np.float64)
                except Exception:
                    continue

        # Fallback for JSON/base64 text formats.
        if isinstance(embedding_blob, str):
            try:
                parsed = json.loads(embedding_blob)
                if isinstance(parsed, list):
                    encoding = np.array(parsed, dtype=np.float64)
                    if encoding.size == 128:
                        return encoding
            except Exception:
                pass

            try:
                decoded = base64.b64decode(embedding_blob)
                return self._decode_embedding_blob(decoded)
            except Exception:
                pass

        return None

    def load_known_faces(self, students: List[Dict[str, Any]]) -> int:
        """
        Load face encodings from student records.

        Args:
            students: List of student dicts with 'face_embedding' as pickled numpy array.

        Returns:
            Number of faces loaded.
        """
        self.known_encodings.clear()
        self.known_ids.clear()
        self.known_names.clear()
        loaded = 0

        for student in students:
            embedding_blob = student.get('face_embedding')
            if embedding_blob is None:
                # No stored embedding — try generating one from photo_url
                if student.get("photo_url"):
                    fallback = self._embedding_from_photo_url(str(student["photo_url"]))
                    if fallback is not None:
                        self.known_encodings.append(fallback)
                        self.known_ids.append(student['id'])
                        self.known_names.append(student.get('name', 'Unknown'))
                        loaded += 1
                continue

            try:
                # Deserialize embedding from supported transport/storage formats.
                encoding = self._decode_embedding_blob(embedding_blob)
                if isinstance(encoding, np.ndarray):
                    self.known_encodings.append(encoding)
                    self.known_ids.append(student['id'])
                    self.known_names.append(student.get('name', 'Unknown'))
                    loaded += 1
                else:
                    # Fallback path: build embedding from photo_url
                    if student.get("photo_url"):
                        fallback = self._embedding_from_photo_url(str(student.get("photo_url")))
                        if fallback is not None:
                            self.known_encodings.append(fallback)
                            self.known_ids.append(student['id'])
                            self.known_names.append(student.get('name', 'Unknown'))
                            loaded += 1
                            continue
                    logger.warning(
                        f"Unrecognized embedding format for student "
                        f"{student.get('name', 'unknown')}"
                    )
            except (pickle.UnpicklingError, Exception) as e:
                logger.error(
                    f"Failed to load face embedding for student "
                    f"{student.get('name', 'unknown')}: {e}"
                )

        logger.info(f"Loaded {loaded} face encodings from database.")
        return loaded

    def detect_faces(self, frame: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """
        Detect faces in a video frame.

        Args:
            frame: BGR image from OpenCV.

        Returns:
            List of face locations as (top, right, bottom, left) tuples.
        """
        if not FACE_RECOGNITION_AVAILABLE:
            if frame is None:
                return []
            fh, fw = frame.shape[:2]
            # Try Haar cascade first for real face region detection.
            # Guard: image must be large enough for the cascade scale pyramid.
            # detectMultiScale asserts scaleIdx bounds when image < minSize * ~1.5.
            if (
                self._haar_detector is not None
                and not self._haar_detector.empty()
                and fw >= 100
                and fh >= 100
            ):
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                try:
                    faces = self._haar_detector.detectMultiScale(
                        gray,
                        scaleFactor=1.1,
                        minNeighbors=5,
                        minSize=(60, 60),
                    )
                except Exception as haar_err:
                    logger.warning(f"Haar cascade failed ({haar_err}); using centered fallback.")
                    faces = []
                if len(faces) > 0:
                    locations: List[Tuple[int, int, int, int]] = []
                    for (x, y, w, h) in faces:
                        locations.append((int(y), int(x + w), int(y + h), int(x)))
                    return locations
            # Final fallback: centered box so flow still works.
            h, w = fh, fw
            return [(int(0.15 * h), int(0.85 * w), int(0.90 * h), int(0.15 * w))]

        # Resize frame for faster processing
        small_frame = cv2.resize(
            frame, (0, 0),
            fx=self.resize_factor,
            fy=self.resize_factor
        )
        # Convert BGR to RGB for face_recognition
        rgb_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        # Detect face locations
        face_locations = face_recognition.face_locations(
            rgb_frame, model=self.model
        )

        # Scale back to original frame size
        scale = 1.0 / self.resize_factor
        scaled_locations = [
            (
                int(top * scale),
                int(right * scale),
                int(bottom * scale),
                int(left * scale)
            )
            for top, right, bottom, left in face_locations
        ]

        return scaled_locations

    def detect_faces_mediapipe(self, frame: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """
        Detect faces using MediaPipe as an alternative.

        Args:
            frame: BGR image from OpenCV.

        Returns:
            List of face locations as (top, right, bottom, left) tuples.
        """
        if not MEDIAPIPE_AVAILABLE or self._mp_detector is None:
            return []

        h, w, _ = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._mp_detector.process(rgb_frame)

        locations = []
        if results.detections:
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                x = int(bbox.xmin * w)
                y = int(bbox.ymin * h)
                bw = int(bbox.width * w)
                bh = int(bbox.height * h)
                # Convert to (top, right, bottom, left) format
                locations.append((y, x + bw, y + bh, x))

        return locations

    def generate_encoding(self, frame: np.ndarray,
                          face_location: Optional[Tuple[int, int, int, int]] = None
                          ) -> Optional[np.ndarray]:
        """
        Generate a face encoding from a frame.

        Args:
            frame: BGR image from OpenCV.
            face_location: Optional known face location (top, right, bottom, left).

        Returns:
            128-dimensional face encoding or None if no face found.
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return self._lightweight_embedding(frame, face_location)

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        known_locations = [face_location] if face_location else None
        encodings = face_recognition.face_encodings(
            rgb_frame,
            known_face_locations=known_locations
        )

        if encodings:
            return encodings[0]
        return None

    def find_match(self, face_encoding: np.ndarray
                   ) -> Tuple[Optional[str], Optional[str], float]:
        """
        Find the best matching student for a given face encoding.

        Args:
            face_encoding: 128-dimensional face encoding.

        Returns:
            Tuple of (student_id, student_name, confidence).
            Returns (None, None, 0.0) if no match found.
        """
        if not self.known_encodings:
            logger.debug("No known faces loaded.")
            return None, None, 0.0
            
        if not FACE_RECOGNITION_AVAILABLE:
            known = np.array(self.known_encodings, dtype=np.float32)
            query = np.array(face_encoding, dtype=np.float32)
            distances = np.linalg.norm(known - query, axis=1)
            best_idx = int(np.argmin(distances))
            best_distance = float(distances[best_idx])
            confidence = max(0.0, 1.0 - (best_distance / 6.0))
            if confidence >= 0.45:
                student_id = self.known_ids[best_idx]
                student_name = self.known_names[best_idx]
                logger.info(
                    f"OpenCV fallback match: {student_name} "
                    f"(distance={best_distance:.3f}, confidence={confidence:.3f})"
                )
                return student_id, student_name, confidence
            logger.info(
                f"OpenCV fallback no match (distance={best_distance:.3f}, confidence={confidence:.3f})"
            )
            return None, None, confidence

        # Compute face distances (lower = more similar)
        distances = face_recognition.face_distance(
            self.known_encodings, face_encoding
        )

        # Find the best match
        best_idx = int(np.argmin(distances))
        best_distance = float(distances[best_idx])

        # Convert distance to similarity (confidence)
        # face_recognition distance is Euclidean; 0 = perfect match
        confidence = max(0.0, 1.0 - best_distance)

        if confidence >= self.threshold:
            student_id = self.known_ids[best_idx]
            student_name = self.known_names[best_idx]
            logger.info(
                f"Face match: {student_name} (confidence={confidence:.3f})"
            )
            return student_id, student_name, confidence
        else:
            logger.info(
                f"No face match (best confidence={confidence:.3f}, "
                f"threshold={self.threshold})"
            )
            return None, None, confidence

    def identify_face(self, frame: np.ndarray
                      ) -> Tuple[Optional[str], Optional[str], float,
                                 Optional[Tuple[int, int, int, int]]]:
        """
        Full pipeline: detect face, generate encoding, find match.

        Args:
            frame: BGR image from OpenCV.

        Returns:
            Tuple of (student_id, student_name, confidence, face_location).
        """
        # Detect faces
        face_locations = self.detect_faces(frame)
        if not face_locations:
            # Try MediaPipe as fallback
            face_locations = self.detect_faces_mediapipe(frame)

        if not face_locations:
            return None, None, 0.0, None

        # Use the first (largest/closest) detected face
        face_location = face_locations[0]

        # Generate encoding
        encoding = self.generate_encoding(frame, face_location)
        if encoding is None:
            return None, None, 0.0, face_location

        # Find match
        student_id, student_name, confidence = self.find_match(encoding)
        return student_id, student_name, confidence, face_location

    @staticmethod
    def encoding_to_blob(encoding: np.ndarray) -> bytes:
        """Serialize a face encoding to bytes for database storage."""
        return pickle.dumps(encoding)

    @staticmethod
    def blob_to_encoding(blob: bytes) -> np.ndarray:
        """Deserialize a face encoding from database BLOB."""
        return pickle.loads(blob)

    def draw_face_box(self, frame: np.ndarray,
                      face_location: Tuple[int, int, int, int],
                      name: str = "Unknown",
                      color: Tuple[int, int, int] = (0, 255, 0)) -> np.ndarray:
        """
        Draw a bounding box and label on a face in the frame.

        Args:
            frame: BGR image from OpenCV.
            face_location: (top, right, bottom, left) tuple.
            name: Label text.
            color: BGR color for the box.

        Returns:
            Frame with drawn annotations.
        """
        top, right, bottom, left = face_location
        cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
        cv2.rectangle(
            frame, (left, bottom - 30), (right, bottom), color, cv2.FILLED
        )
        cv2.putText(
            frame, name, (left + 6, bottom - 8),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1
        )
        return frame

    def cleanup(self) -> None:
        """Release resources."""
        if self._mp_detector:
            self._mp_detector.close()
        logger.info("FaceRecognizer resources released.")

    def _embedding_from_photo_url(self, photo_url: str) -> Optional[np.ndarray]:
        try:
            with urllib.request.urlopen(photo_url, timeout=10) as resp:
                raw = resp.read()
            arr = np.frombuffer(raw, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                return None

            if FACE_RECOGNITION_AVAILABLE:
                # Use dlib's 128-dim face encoding for high accuracy
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                encodings = face_recognition.face_encodings(rgb)
                if encodings:
                    return encodings[0]
                logger.warning("face_recognition found no face in photo_url: %s", photo_url)
                return None

            # Lightweight fallback when dlib is not installed
            faces = self.detect_faces(frame)
            loc = faces[0] if faces else None
            return self._lightweight_embedding(frame, loc)
        except Exception as e:
            logger.warning(f"Failed building fallback embedding from photo_url: {e}")
            return None

    @staticmethod
    def _safe_face_crop(frame: np.ndarray,
                        face_location: Optional[Tuple[int, int, int, int]]) -> np.ndarray:
        h, w = frame.shape[:2]
        if not face_location:
            y1, y2 = int(h * 0.15), int(h * 0.90)
            x1, x2 = int(w * 0.15), int(w * 0.85)
            return frame[y1:y2, x1:x2]
        top, right, bottom, left = face_location
        top = max(0, min(h - 1, int(top)))
        bottom = max(top + 1, min(h, int(bottom)))
        left = max(0, min(w - 1, int(left)))
        right = max(left + 1, min(w, int(right)))
        return frame[top:bottom, left:right]

    def _lightweight_embedding(self,
                               frame: np.ndarray,
                               face_location: Optional[Tuple[int, int, int, int]]) -> Optional[np.ndarray]:
        if frame is None:
            return None
        face = self._safe_face_crop(frame, face_location)
        if face is None or face.size == 0:
            return None
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        # Deterministic 128-dim descriptor (16x8)
        small = cv2.resize(gray, (16, 8), interpolation=cv2.INTER_AREA)
        emb = small.astype(np.float32).flatten() / 255.0
        return emb
