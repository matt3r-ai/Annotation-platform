import os
import uuid
import subprocess
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse


STATIC_DIR = "/app/data/saved_video"

router = APIRouter(prefix="/api/vlm", tags=["vlm_analysis"])


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


@router.post("/extract-frames")
async def extract_frames(
    video: UploadFile = File(...),
    fps: int = Form(1),
):
    session = str(uuid.uuid4())
    work_dir = os.path.join(STATIC_DIR, "vlm", session)
    frames_dir = os.path.join(work_dir, "frames")
    _ensure_dir(frames_dir)

    input_path = os.path.join(work_dir, "input.mp4")
    with open(input_path, "wb") as f:
        f.write(await video.read())

    cmd = [
        "ffmpeg", "-y", "-i", input_path, "-vf", f"fps={max(1,int(fps))}",
        os.path.join(frames_dir, "frame_%05d.jpg"),
    ]
    try:
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {e}")

    rel_dir = f"vlm/{session}/frames"
    urls = [f"/static/{rel_dir}/{f}" for f in sorted(os.listdir(frames_dir)) if f.endswith('.jpg')]
    return {"success": True, "session": session, "frames": urls}


@router.post("/infer")
async def run_inference(
    session: str = Form(...),
    question: Optional[str] = Form(None),
):
    # Demo: call a placeholder VLM API; here we mock results to keep the tool self-contained.
    # Replace this with a real provider (OpenAI, Gemini, etc.) server-side.
    work_dir = os.path.join(STATIC_DIR, "vlm", session, "frames")
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=400, detail="invalid session")

    frames = sorted([f for f in os.listdir(work_dir) if f.lower().endswith('.jpg')])
    results = []
    ts = 0.0
    for f in frames:
        results.append({
            "segment_id": len(results),
            "timestamp_s": round(ts, 2),
            "answer": "car_following" if (len(results) % 2 == 0) else "straight_driving"
        })
        ts += 1.0

    return JSONResponse({
        "success": True,
        "question": question or "What driving maneuver is happening?",
        "maneuver": "demo_prediction",
        "frames": results,
        "meta": {"provider": "mock", "session": session}
    })






















