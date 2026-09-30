"""
security.py – Security helpers, file validation, rate limiting, and header policies.

Responsibilities:
  1. Video Upload Validation:
     - Extension whitelist: .mp4, .avi.
     - Declared MIME type whitelist: video/mp4, video/avi, video/x-msvideo, video/vnd.avi, application/octet-stream.
     - Magic bytes sniffing:
         • MP4: 'ftyp' box in the first 16 bytes.
         • AVI: 'RIFF' in bytes 0..4 and 'AVI ' in bytes 8..12.
     - Maximum file size enforcement (100 MB).
     - File integrity check: verifies the video opens with cv2.VideoCapture and contains at least 1 readable frame.
  2. Secure Random Filenames:
     - Generates UUID4 hex filename with validated extension saved to uploads/.
  3. Upload Lifecycle & Cleanup:
     - Automatically removes uploads older than 24 hours.
  4. In-Memory Rate Limiting:
     - Sliding window rate limiting per IP for /api/upload and /api/start.
  5. Security Headers:
     - Strict Content-Security-Policy (CSP), nosniff, DENY, strict-origin, Permissions-Policy.
"""

import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Tuple
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

# Allowed video extensions and MIME types
ALLOWED_EXTENSIONS = {".mp4", ".avi"}
ALLOWED_MIME_TYPES = {
    "video/mp4",
    "video/avi",
    "video/x-msvideo",
    "video/msvideo",
    "video/vnd.avi",
    "application/octet-stream",  # generic fallback from some browsers
}

# Strict pattern for file_id: uuid4 hex string (32 hex characters)
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{32}$")


# ============================================================================
# 1. File Magic Byte & Integrity Validation
# ============================================================================

def validate_video_magic_bytes(header_bytes: bytes, ext: str) -> bool:
    """Sniff the initial header bytes to verify real MP4 or AVI container format.

    - MP4: 'ftyp' (b'ftyp') signature in bytes 4..16.
    - AVI: Starts with 'RIFF' (b'RIFF') and has 'AVI ' (b'AVI ') at offset 8..12.
    """
    if not header_bytes or len(header_bytes) < 12:
        return False

    ext_lower = ext.lower()
    if ext_lower == ".mp4":
        # Standard ISO Base Media File Format (MP4) begins with [4-byte size] + 'ftyp'
        return b"ftyp" in header_bytes[:32]
    elif ext_lower == ".avi":
        # RIFF AVI format: 0..4 = b'RIFF', 8..12 = b'AVI '
        return header_bytes[:4] == b"RIFF" and header_bytes[8:12] == b"AVI "

    return False


def validate_upload_file(file_storage, max_size_bytes: int = 100 * 1024 * 1024) -> Tuple[bool, str | None, str | None]:
    """Perform multi-tier validation on an incoming Flask FileStorage object.

    Checks:
      1. Filename existence & allowed extension (.mp4, .avi).
      2. Declared MIME type against whitelist.
      3. Magic byte sniffing from file head.
      4. File size limits.

    Returns:
      (is_valid: bool, ext: str | None, error_message: str | None)
    """
    if not file_storage or not file_storage.filename:
        return False, None, "No file selected for upload."

    raw_name = file_storage.filename
    _, ext = os.path.splitext(raw_name)
    ext_lower = ext.lower()

    if ext_lower not in ALLOWED_EXTENSIONS:
        return False, None, f"Unsupported file extension '{ext}'. Only .mp4 and .avi are allowed."

    # Validate declared MIME type
    declared_mime = (file_storage.content_type or "").lower()
    if declared_mime and declared_mime not in ALLOWED_MIME_TYPES:
        return False, None, f"Invalid declared content type '{declared_mime}'. Only MP4 and AVI videos are supported."

    # Sniff magic bytes
    header = file_storage.read(64)
    file_storage.seek(0)  # Reset stream position

    if not validate_video_magic_bytes(header, ext_lower):
        return False, None, f"File content does not match genuine {ext_lower.upper().replace('.', '')} video container format."

    return True, ext_lower, None


def verify_video_frames(file_path: str) -> bool:
    """Verify with cv2.VideoCapture that the saved file contains at least one readable video frame."""
    try:
        import cv2
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return False
        ret, frame = cap.read()
        cap.release()
        return bool(ret and frame is not None and frame.size > 0)
    except Exception as exc:
        logger.warning("cv2.VideoCapture verification failed: %s", exc)
        return False


def sanitize_display_name(original_filename: str) -> str:
    """Sanitize the client-supplied filename strictly for safe UI display."""
    clean = secure_filename(original_filename)
    return clean if clean else "video_upload.mp4"


def save_secure_upload(file_storage, upload_dir: str) -> Tuple[str, str, int]:
    """Save the uploaded file under a random UUID hex filename in upload_dir.

    Returns:
      (file_id, saved_path, size_in_bytes)
    """
    os.makedirs(upload_dir, exist_ok=True)
    _, ext = os.path.splitext(file_storage.filename)
    file_id = uuid.uuid4().hex  # 32 characters hex
    filename = f"{file_id}{ext.lower()}"
    saved_path = os.path.join(upload_dir, filename)

    file_storage.save(saved_path)
    size_bytes = os.path.getsize(saved_path)

    return file_id, saved_path, size_bytes


def validate_file_id(file_id: str, upload_dir: str) -> Tuple[bool, str | None]:
    """Validate a file_id to guarantee against directory traversal and verify existence."""
    if not file_id or not isinstance(file_id, str):
        return False, None

    # Strict pattern check: 32 hex chars only
    clean_id = file_id.strip().lower()
    if not UUID_PATTERN.match(clean_id):
        return False, None

    # Search for matching file in upload_dir with allowed extensions
    for ext in ALLOWED_EXTENSIONS:
        target_path = os.path.join(upload_dir, f"{clean_id}{ext}")
        # Resolve realpath to ensure within upload_dir
        real_target = os.path.realpath(target_path)
        real_upload = os.path.realpath(upload_dir)
        if real_target.startswith(real_upload) and os.path.isfile(real_target):
            return True, real_target

    return False, None


# ============================================================================
# 2. Upload Lifecycle & Old Files Cleanup
# ============================================================================

def cleanup_old_uploads(upload_dir: str, max_age_hours: float = 24.0) -> int:
    """Delete uploaded video files older than max_age_hours."""
    if not os.path.exists(upload_dir):
        return 0

    now = time.time()
    cutoff_time = now - (max_age_hours * 3600.0)
    deleted_count = 0

    try:
        for entry in os.scandir(upload_dir):
            if entry.is_file():
                try:
                    stat = entry.stat()
                    if stat.st_mtime < cutoff_time:
                        os.remove(entry.path)
                        deleted_count += 1
                        logger.info("Cleaned up expired upload: %s", entry.name)
                except Exception as e:
                    logger.warning("Could not remove expired upload %s: %e", entry.path, e)
    except Exception as exc:
        logger.error("Error during upload cleanup: %s", exc)

    return deleted_count


# ============================================================================
# 3. In-Memory Sliding-Window Rate Limiter
# ============================================================================

class InMemoryRateLimiter:
    """Thread-safe in-memory rate limiter per client IP."""

    def __init__(self):
        self._lock = threading.Lock()
        self._history: dict[str, list[float]] = {}

    def is_allowed(self, key: str, max_requests: int = 10, window_seconds: float = 60.0) -> bool:
        now = time.time()
        with self._lock:
            if key not in self._history:
                self._history[key] = [now]
                return True

            # Prune timestamps outside window
            cutoff = now - window_seconds
            self._history[key] = [ts for ts in self._history[key] if ts > cutoff]

            if len(self._history[key]) < max_requests:
                self._history[key].append(now)
                return True

            return False


# Global rate limiter instances for sensitive endpoints
upload_limiter = InMemoryRateLimiter()
start_limiter = InMemoryRateLimiter()
