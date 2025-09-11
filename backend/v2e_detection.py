import os
import uuid
import subprocess
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse


STATIC_DIR = "/app/data/saved_video"

router = APIRouter(prefix="/api/v2e", tags=["video2everything"])


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _extract_frames(input_video: str, out_dir: str, fps: int) -> None:
    _ensure_dir(out_dir)
    cmd = [
        "ffmpeg", "-y",
        "-i", input_video,
        "-vf", f"fps={fps}",
        os.path.join(out_dir, "frame_%05d.jpg"),
    ]
    subprocess.run(cmd, check=True)


def _frames_to_video(frames_dir: str, out_path: str, fps: int) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", os.path.join(frames_dir, "frame_%05d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        out_path,
    ]
    subprocess.run(cmd, check=True)


@router.post("/detect")
async def detect_yolov8(
    video: UploadFile = File(...),
    queries: Optional[str] = Form(None),  # kept for API compatibility, unused by YOLO
    fps: int = Form(1),
    score_threshold: float = Form(0.3),
):
    """Demo endpoint: run YOLOv8 detection on sampled frames (CPU-friendly).

    Returns URLs of the original-preview, detection-preview, and a side-by-side video.
    """
    session = str(uuid.uuid4())
    work_dir = os.path.join(STATIC_DIR, "detections", session)
    frames_dir = os.path.join(work_dir, "frames")
    out_frames_dir = os.path.join(work_dir, "det_frames")
    _ensure_dir(work_dir)
    _ensure_dir(frames_dir)
    _ensure_dir(out_frames_dir)

    # Save upload
    input_path = os.path.join(work_dir, "input.mp4")
    with open(input_path, "wb") as f:
        f.write(await video.read())

    # Extract frames
    try:
        _extract_frames(input_path, frames_dir, max(1, int(fps)))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg extract failed: {e}")

    # Run OWL-ViT detection per frame
    try:
        from PIL import Image
        import numpy as np
        from ultralytics import YOLO
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Missing dependencies for YOLO: {e}")

    # Load a small CPU-friendly model
    try:
        yolo = YOLO("yolov8n.pt")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Load YOLO model failed: {e}")

    frame_files = sorted([f for f in os.listdir(frames_dir) if f.lower().endswith('.jpg')])
    kept = 0
    for fname in frame_files:
        in_path = os.path.join(frames_dir, fname)
        image = Image.open(in_path).convert("RGB")
        # Run YOLO (results[0] corresponds to this image)
        res = yolo.predict(np.array(image), verbose=False, conf=float(score_threshold))
        r0 = res[0]
        # Draw boxes
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        if hasattr(r0, 'boxes') and r0.boxes is not None:
            for b in r0.boxes:
                x1, y1, x2, y2 = [int(v) for v in b.xyxy[0].tolist()]
                conf = float(b.conf[0].item()) if hasattr(b, 'conf') else 0.0
                cls_id = int(b.cls[0].item()) if hasattr(b, 'cls') else -1
                draw.rectangle([x1, y1, x2, y2], outline=(0,255,0), width=3)
                label = f"{cls_id if cls_id>=0 else 'obj'} {conf:.2f}"
                draw.text((x1+4, y1+4), label, fill=(0,255,0))
                kept += 1
        image.save(os.path.join(out_frames_dir, fname))

    # Build preview videos from frames (same fps used at extraction time)
    orig_preview = os.path.join(work_dir, "orig_preview.mp4")
    det_preview = os.path.join(work_dir, "det_preview.mp4")
    side_by_side = os.path.join(work_dir, "side_by_side.mp4")
    try:
        _frames_to_video(frames_dir, orig_preview, max(1, int(fps)))
        _frames_to_video(out_frames_dir, det_preview, max(1, int(fps)))
        # hstack two previews
        cmd = [
            "ffmpeg", "-y", "-i", orig_preview, "-i", det_preview,
            "-filter_complex", "hstack=inputs=2",
            side_by_side,
        ]
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg compose failed: {e}")

    rel = lambda p: p.replace(STATIC_DIR, "/static")
    # Echo back user queries (optional, YOLO ignores them)
    queries_out: List[str] = []
    if queries:
        queries_out = [s.strip() for s in str(queries).split(',') if s.strip()]
    return JSONResponse(
        {
            "success": True,
            "queries": queries_out,
            "frames": len(frame_files),
            "detections": kept,
            "original_preview": rel(orig_preview),
            "detected_preview": rel(det_preview),
            "side_by_side": rel(side_by_side),
        }
    )


