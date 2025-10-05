from fastapi import APIRouter, HTTPException
import os
import uuid
import boto3
import json
import subprocess
import shutil
from typing import Tuple

router = APIRouter()

# Paths shared with main
STATIC_DIR = "/app/data/saved_video"


def _normalize_s3_path(s3_path: str, default_bucket: str = None) -> Tuple[str, str]:
    if not isinstance(s3_path, str) or not s3_path:
        return (default_bucket, None)
    p = s3_path.strip()
    if p.startswith("s3://"):
        p = p[5:]
    if "/" in p:
        b, k = p.split("/", 1)
        if default_bucket and b == default_bucket:
            return (default_bucket, k)
        return (b, k)
    return (default_bucket, p)


@router.post("/api/viz/render-yolo")
async def render_yolov10(req: dict):
    video_path = req.get("video_path") or req.get("video_key") or req.get("video_s3")
    json_path = req.get("result_json_path") or req.get("json_path") or req.get("result_s3_path")
    # 统一按 3fps 抽帧，提高处理速度
    fps = 3

    VIDEO_BUCKET = os.getenv("VIDEO_BUCKET", "matt3r-driving-footage-us-west-2")
    RESULT_BUCKET = os.getenv("RESULT_BUCKET", "matt3r-ce-inference-output")

    if not video_path or not json_path:
        raise HTTPException(status_code=400, detail="missing video_path or result_json_path")

    session_id = str(uuid.uuid4())
    work_dir = os.path.join(STATIC_DIR, "viz", session_id)
    images_dir = os.path.join(work_dir, "images")
    ann_dir = os.path.join(work_dir, "annotated")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(ann_dir, exist_ok=True)

    s3 = boto3.client("s3")
    try:
        vb, vk = _normalize_s3_path(video_path, default_bucket=VIDEO_BUCKET)
        rb, rk = _normalize_s3_path(json_path, default_bucket=RESULT_BUCKET)
        if not vb or not vk or not rb or not rk:
            raise HTTPException(status_code=400, detail="failed to normalize s3 paths")
        local_video = os.path.join(work_dir, os.path.basename(vk))
        s3.download_file(vb, vk, local_video)
        obj = s3.get_object(Bucket=rb, Key=rk)
        payload = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"s3 download failed: {e}")

    # 注：如果后续结果 JSON 明确携带 fps，可在此读取覆盖。但当前版本固定使用 6fps，避免时间轴偏差。

    try:
        cmd = [
            "ffmpeg", "-y", "-i", local_video, "-vf", f"fps={fps}",
            os.path.join(images_dir, "%d.jpg")
        ]
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg extract failed: {e}")

    try:
        import cv2  # noqa
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"opencv missing: {e}")

    try:
        def to_int(s, default=0):
            try:
                return int(s)
            except Exception:
                return default

        def parse_frames(obj):
            frames = []
            if not obj:
                return frames
            if isinstance(obj, list):
                for idx, item in enumerate(obj):
                    if isinstance(item, dict):
                        if "detections" in item or "boxes" in item:
                            item = dict(item)
                            item.setdefault("frame_index", item.get("frame", idx))
                            frames.append(item)
                        else:
                            if "detections" in item:
                                frames.append({"frame_index": idx, "detections": item["detections"]})
                    elif isinstance(item, list):
                        frames.append({"frame_index": idx, "detections": item})
                return frames
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if isinstance(v, dict) and ("detections" in v or "boxes" in v):
                        fr = dict(v)
                        fr["frame_index"] = to_int(k, 0)
                        frames.append(fr)
                if not frames and "frames" in obj:
                    inner = obj.get("frames")
                    frames = parse_frames(inner)
                frames.sort(key=lambda x: x.get("frame_index", 0))
                return frames
            return frames

        yolo_frames = []
        for key in ("yolov10", "yolo", "YOLO"):
            yolo_frames = parse_frames(payload.get(key))
            if yolo_frames:
                break

        total_written = 0
        total_boxes = 0

        # 提前统计抽帧结果数量，用比例映射解决 360 vs 362 等边界差异
        extracted_files = sorted([f for f in os.listdir(images_dir) if f.endswith('.jpg')])
        extracted_count = len(extracted_files)

        def find_frame_path(idx: int) -> str:
            # idx 为 0 基；映射到 1 基的抽帧编号
            if extracted_count <= 0:
                return None
            yolo_count = max(1, len(yolo_frames))
            mapped = int(round((idx) * (extracted_count - 1) / (yolo_count - 1))) + 1 if yolo_count > 1 else 1
            mapped = max(1, min(extracted_count, mapped))
            p = os.path.join(images_dir, f"{mapped}.jpg")
            if os.path.exists(p):
                return p
            # 兜底：就近搜索
            for delta in (1, 2, 3):
                for cand in (mapped - delta, mapped + delta):
                    if 1 <= cand <= extracted_count:
                        q = os.path.join(images_dir, f"{cand}.jpg")
                        if os.path.exists(q):
                            return q
            return None

        def compute_offsets(img):
            return 0, 0

        for frame in yolo_frames:
            fi = int(frame.get("frame_index") or frame.get("frame") or 0)
            img_path = find_frame_path(fi)
            if not img_path:
                continue
            img = cv2.imread(img_path)
            offx, offy = compute_offsets(img)
            det_list = frame.get("detections") or frame.get("boxes") or (frame if isinstance(frame, list) else [])
            for det in det_list:
                box = det.get("box") or det.get("bbox") or [0, 0, 0, 0]
                x, y, w, h = [int(v) for v in box]
                x = x - offx
                y = y - offy
                x = max(0, min(x, img.shape[1] - 1))
                y = max(0, min(y, img.shape[0] - 1))
                cls = det.get("class_id") or 0
                conf = float(det.get("confidence") or det.get("score") or 0)
                color = (0, 224, 255)
                cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)
                label = f"{cls}:{conf:.2f}"
                cv2.putText(img, label, (max(0, x), max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                total_boxes += 1
            out_name = os.path.basename(img_path)
            out_path = os.path.join(ann_dir, out_name)
            cv2.imwrite(out_path, img)
            total_written += 1

    except Exception as e:
        try:
            shutil.rmtree(work_dir)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"draw failed: {e}")

    if total_written == 0:
        try:
            for fname in sorted(os.listdir(images_dir)):
                if fname.endswith('.jpg'):
                    src = os.path.join(images_dir, fname)
                    dst = os.path.join(ann_dir, fname)
                    shutil.copyfile(src, dst)
            total_written = len([f for f in os.listdir(ann_dir) if f.endswith('.jpg')])
        except Exception:
            total_written = 0
        if total_written == 0:
            raise HTTPException(status_code=500, detail="no annotated frames generated")

    out_video = os.path.join(work_dir, "annotated.mp4")
    try:
        annotated_files = sorted([f for f in os.listdir(ann_dir) if f.endswith('.jpg')], key=lambda x: int(os.path.splitext(x)[0]))
        if not annotated_files:
            raise HTTPException(status_code=500, detail="no annotated frames to encode")
        start_num = int(os.path.splitext(annotated_files[0])[0])
        pattern = os.path.join(ann_dir, "%d.jpg").replace("\\", "/")
        cmd = [
            "ffmpeg", "-y", "-framerate", str(fps), "-start_number", str(start_num), "-i", pattern,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", out_video
        ]
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg encode failed: {e}")

    rel = os.path.relpath(out_video, STATIC_DIR).replace("\\", "/")
    return {"success": True, "video_url": f"/static/{rel}", "written": total_written, "fps": fps, "boxes": total_boxes}
