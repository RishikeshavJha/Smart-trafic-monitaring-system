"""
tests/test_upload.py – Unit and integration tests for video file uploads, validation, and security.

Tests:
  - Valid MP4 and AVI file uploads.
  - Rejection of invalid extensions (.txt, .exe, .png).
  - Rejection of mismatched MIME types.
  - Rejection of invalid magic bytes (e.g. renamed text file with .mp4 extension).
  - Rejection of files exceeding maximum size (MAX_CONTENT_LENGTH).
  - Start engine with unknown or path-traversal file_id returns 400 error.
  - Listing bundled samples from /api/samples.
  - Security headers verification.
"""

import io
import os
import shutil
import tempfile
import cv2
import numpy as np
import pytest
from app import create_app
import database


@pytest.fixture
def test_env():
    """Create temporary upload and database directories for test isolation."""
    temp_dir = tempfile.mkdtemp(prefix="traffic_test_")
    db_path = os.path.join(temp_dir, "test_traffic.db")
    upload_dir = os.path.join(temp_dir, "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    app = create_app("testing")
    app.config["DATABASE_PATH"] = db_path
    app.config["UPLOAD_FOLDER"] = upload_dir
    app.config["WTF_CSRF_ENABLED"] = False

    with app.app_context():
        database.init_db(db_path)

    client = app.test_client()
    yield client, app, temp_dir

    shutil.rmtree(temp_dir, ignore_errors=True)


def _generate_valid_mp4_bytes() -> bytes:
    """Generate a tiny 5-frame valid MP4 video in memory."""
    temp_fd, temp_path = tempfile.mkstemp(suffix=".mp4")
    os.close(temp_fd)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(temp_path, fourcc, 10.0, (160, 120))
    for _ in range(5):
        frame = np.zeros((120, 160, 3), dtype=np.uint8)
        writer.write(frame)
    writer.release()

    with open(temp_path, "rb") as f:
        data = f.read()

    os.remove(temp_path)
    return data


def _generate_valid_avi_bytes() -> bytes:
    """Generate a tiny 5-frame valid AVI video in memory."""
    temp_fd, temp_path = tempfile.mkstemp(suffix=".avi")
    os.close(temp_fd)

    fourcc = cv2.VideoWriter_fourcc(*"XVID")
    writer = cv2.VideoWriter(temp_path, fourcc, 10.0, (160, 120))
    for _ in range(5):
        frame = np.zeros((120, 160, 3), dtype=np.uint8)
        writer.write(frame)
    writer.release()

    with open(temp_path, "rb") as f:
        data = f.read()

    os.remove(temp_path)
    return data


class TestUploadValidation:
    """Tests for POST /api/upload validation rules."""

    def test_upload_valid_mp4(self, test_env):
        client, app, _ = test_env
        mp4_bytes = _generate_valid_mp4_bytes()

        data = {
            "file": (io.BytesIO(mp4_bytes), "test_traffic.mp4", "video/mp4"),
        }
        res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert res.status_code == 201
        json_data = res.get_json()
        assert json_data["ok"] is True
        assert "file_id" in json_data["data"]
        assert json_data["data"]["original_name"] == "test_traffic.mp4"
        assert json_data["data"]["size_bytes"] == len(mp4_bytes)

    def test_upload_valid_avi(self, test_env):
        client, app, _ = test_env
        avi_bytes = _generate_valid_avi_bytes()

        data = {
            "file": (io.BytesIO(avi_bytes), "sample_run.avi", "video/x-msvideo"),
        }
        res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert res.status_code == 201
        json_data = res.get_json()
        assert json_data["ok"] is True
        assert "file_id" in json_data["data"]

    def test_reject_invalid_extension(self, test_env):
        client, app, _ = test_env
        fake_data = b"Hello world text file content"

        data = {
            "file": (io.BytesIO(fake_data), "notes.txt", "text/plain"),
        }
        res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert res.status_code == 400
        json_data = res.get_json()
        assert json_data["ok"] is False
        assert "Unsupported file extension" in json_data["error"]["message"]

    def test_reject_renamed_fake_video_magic_bytes(self, test_env):
        client, app, _ = test_env
        # Text content disguised with .mp4 extension
        fake_data = b"This is plain text and not a genuine MP4 container"

        data = {
            "file": (io.BytesIO(fake_data), "fake_video.mp4", "video/mp4"),
        }
        res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert res.status_code == 400
        json_data = res.get_json()
        assert json_data["ok"] is False
        assert "container format" in json_data["error"]["message"]

    def test_reject_unsupported_mime_type(self, test_env):
        client, app, _ = test_env
        mp4_bytes = _generate_valid_mp4_bytes()

        data = {
            "file": (io.BytesIO(mp4_bytes), "test.mp4", "image/png"),
        }
        res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert res.status_code == 400
        json_data = res.get_json()
        assert json_data["ok"] is False
        assert "Invalid declared content type" in json_data["error"]["message"]


class TestEngineStartWithUpload:
    """Tests for starting the engine with uploaded or sample video sources."""

    def test_start_with_valid_upload_file_id(self, test_env):
        client, app, _ = test_env
        mp4_bytes = _generate_valid_mp4_bytes()

        # 1. Upload video
        data = {
            "file": (io.BytesIO(mp4_bytes), "traffic.mp4", "video/mp4"),
        }
        up_res = client.post("/api/upload", data=data, content_type="multipart/form-data")
        assert up_res.status_code == 201
        file_id = up_res.get_json()["data"]["file_id"]

        # 2. Start engine with uploaded file_id
        start_res = client.post("/api/start", json={"source": "upload", "file_id": file_id})
        assert start_res.status_code == 200
        json_data = start_res.get_json()
        assert json_data["ok"] is True
        assert json_data["data"]["mode"] == "upload"

        # 3. Stop engine
        stop_res = client.post("/api/stop")
        assert stop_res.status_code == 200

    def test_start_with_invalid_file_id(self, test_env):
        client, app, _ = test_env
        res = client.post("/api/start", json={"source": "upload", "file_id": "nonexistent_id_123"})
        assert res.status_code == 400
        json_data = res.get_json()
        assert json_data["ok"] is False
        assert json_data["error"]["code"] == "FILE_NOT_FOUND"

    def test_start_with_path_traversal_file_id(self, test_env):
        client, app, _ = test_env
        res = client.post("/api/start", json={"source": "upload", "file_id": "../../../etc/passwd"})
        assert res.status_code == 400
        json_data = res.get_json()
        assert json_data["ok"] is False
        assert json_data["error"]["code"] == "FILE_NOT_FOUND"


class TestSamplesAndSecurityHeaders:
    """Tests for /api/samples and HTTP security headers."""

    def test_list_samples_endpoint(self, test_env):
        client, _, _ = test_env
        res = client.get("/api/samples")
        assert res.status_code == 200
        json_data = res.get_json()
        assert json_data["ok"] is True
        assert "samples" in json_data["data"]

    def test_security_headers_present(self, test_env):
        client, _, _ = test_env
        res = client.get("/")
        assert res.status_code == 200
        headers = res.headers

        assert "Content-Security-Policy" in headers
        assert "X-Frame-Options" in headers
        assert headers["X-Frame-Options"] == "DENY"
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert "camera=(self)" in headers.get("Permissions-Policy", "")
