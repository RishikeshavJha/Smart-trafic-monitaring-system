"""
routes/stream.py – Video Feed MJPEG streaming and Server-Sent Events for Smart Traffic Monitoring System.

Endpoints:
  GET /video_feed     – Multipart MJPEG video stream (multipart/x-mixed-replace; boundary=frame).
                        Streams real-time annotated detection frames from the active VideoSource.
                        Returns a friendly placeholder graphic if no video source is active or engine is idle.
  GET /stream/events  – SSE endpoint emitting JSON telemetry events.
"""

import time
from typing import Generator
from flask import Blueprint, Response, current_app, stream_with_context

from engine import get_engine

stream_bp = Blueprint("stream", __name__)


def _generate_no_video_placeholder_jpeg() -> bytes:
    """Generate a clean, high-contrast dark control-room placeholder JPEG when no real video is active."""
    try:
        import cv2
        import numpy as np

        width, height = 640, 360
        # Create dark surface canvas (RGB #121C30 -> BGR 48, 28, 18)
        canvas = np.full((height, width, 3), (48, 28, 18), dtype=np.uint8)

        # Grid background lines
        grid_color = (64, 39, 26)
        for x in range(0, width, 40):
            cv2.line(canvas, (x, 0), (x, height), grid_color, 1)
        for y in range(0, height, 40):
            cv2.line(canvas, (0, y), (width, y), grid_color, 1)

        # Text overlays
        title = "NO ACTIVE VIDEO FEED"
        subtitle = "Start Video Mode or select Sample / Webcam in controls"
        cv2.putText(
            canvas,
            title,
            (width // 2 - 160, height // 2 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (247, 248, 251),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            subtitle,
            (width // 2 - 210, height // 2 + 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (200, 176, 159),
            1,
            cv2.LINE_AA,
        )

        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 75]
        _, enc = cv2.imencode(".jpg", canvas, encode_param)
        return enc.tobytes()
    except ImportError:
        # Fallback 1x1 JPEG when OpenCV is not installed (e.g. Vercel serverless)
        return (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
            b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
            b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
            b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00"
            b"\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00"
            b"\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00"
            b"\x08\x01\x01\x00\x00?\x00\xfb\xff\xd9"
        )


@stream_bp.route("/video_feed")
def video_feed():
    """Multipart MJPEG video stream route."""
    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    placeholder_jpeg = _generate_no_video_placeholder_jpeg()

    def mjpeg_generator() -> Generator[bytes, None, None]:
        try:
            while True:
                active_source = engine.active_source
                frame_bytes = None

                # Fetch latest annotated frame if active source has one
                if active_source and hasattr(active_source, "get_latest_jpeg"):
                    frame_bytes = active_source.get_latest_jpeg()

                # Fallback to placeholder JPEG if none available
                if not frame_bytes:
                    frame_bytes = placeholder_jpeg

                # Format MJPEG frame payload
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )

                # Stream around 25-30 FPS or idle delay
                time.sleep(0.033)
        except GeneratorExit:
            pass
        except Exception:
            pass

    response = Response(
        stream_with_context(mjpeg_generator()),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@stream_bp.route("/events")
def events():
    """Server-Sent Events endpoint for telemetry."""
    engine = get_engine(current_app.config.get("DATABASE_PATH"))

    def sse_generator():
        sub_q = engine.subscribe()
        try:
            while True:
                snap = sub_q.get(timeout=2.0)
                import json
                yield f"data: {json.dumps(snap)}\n\n"
        except Exception:
            engine.unsubscribe(sub_q)

    return Response(
        stream_with_context(sse_generator()),
        mimetype="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
