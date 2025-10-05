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


def _decode_any_mask(det: dict):
    """Decode a detection dict into a binary mask.
    Supports COCO RLE at key 'mask' or polygon at key 'segmentation'.
    Returns a numpy array with shape (H, W) containing 0/1, or None if unavailable.
    """
    try:
        from pycocotools import mask as maskUtils  # type: ignore
        import numpy as np  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"pycocotools/numpy missing: {e}")

    rle = det.get("mask") or det.get("rle")
    if rle is not None:
        try:
            m = maskUtils.decode(rle)
            if m is None:
                return None
            return m[:, :] if m.ndim == 3 else m
        except Exception:
            # fall through to try polygon
            pass

    seg = det.get("segmentation")
    if seg is not None:
        try:
            # seg can be list of polygons; need image size. We cannot know HxW here
            # Let caller resize to current frame after decoding at provided size if available
            h = det.get("height") or det.get("img_height")
            w = det.get("width") or det.get("img_width")
            if not h or not w:
                return None
            rles = maskUtils.frPyObjects(seg, int(h), int(w))
            rle_merged = maskUtils.merge(rles)
            m = maskUtils.decode(rle_merged)
            return m
        except Exception:
            return None
    return None


@router.post("/api/viz/render-ego-lane")
async def render_ego_lane(req: dict):
    video_path = req.get("video_path") or req.get("video_key") or req.get("video_s3")
    # ZIP directory/file containing per-frame NPY masks (single source of truth)
    zip_path = req.get("result_zip_path") or req.get("zip_path") or req.get("result_dir_path")
    # Keep fps aligned with inference default (3)
    fps = int(req.get("fps") or 3)

    VIDEO_BUCKET = os.getenv("VIDEO_BUCKET", "matt3r-driving-footage-us-west-2")
    RESULT_BUCKET = os.getenv("RESULT_BUCKET", "matt3r-ce-inference-output")

    if not video_path:
        raise HTTPException(status_code=400, detail="missing video_path")

    session_id = str(uuid.uuid4())
    work_dir = os.path.join(STATIC_DIR, "viz", session_id)
    images_dir = os.path.join(work_dir, "images")
    ann_dir = os.path.join(work_dir, "annotated")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(ann_dir, exist_ok=True)

    s3 = boto3.client("s3")
    debug_meta = {}
    try:
        vb, vk = _normalize_s3_path(video_path, default_bucket=VIDEO_BUCKET)
        if not zip_path:
            raise HTTPException(status_code=400, detail="missing result_zip_path")
        rb, rk = _normalize_s3_path(zip_path, default_bucket=RESULT_BUCKET)
        result_bucket = rb
        result_key = rk
        if not vb or not vk or not rb or not rk:
            raise HTTPException(status_code=400, detail="failed to normalize s3 paths")
        local_video = os.path.join(work_dir, os.path.basename(vk))
        s3.download_file(vb, vk, local_video)

        debug_meta.update({"video_bucket": vb, "video_key": vk})

        # Resolve ZIP (file or inside a folder)
        key_candidate = result_key
        if not result_key.lower().endswith('.zip'):
            prefix = result_key.rstrip('/') + '/'
            resp = s3.list_objects_v2(Bucket=result_bucket, Prefix=prefix)
            found = None
            for it in resp.get('Contents', []):
                k = it.get('Key') or ''
                if k.lower().endswith('.zip'):
                    found = k
                    break
            if not found:
                raise HTTPException(status_code=404, detail=f"zip not found under {result_bucket}/{result_key}")
            key_candidate = found

        # Download and extract zip containing NPY masks
        local_zip = os.path.join(work_dir, "ego_lane_plus.zip")
        s3.download_file(result_bucket, key_candidate, local_zip)
        import zipfile
        npy_dir = os.path.join(work_dir, "npy")
        os.makedirs(npy_dir, exist_ok=True)
        with zipfile.ZipFile(local_zip, 'r') as zf:
            zf.extractall(npy_dir)
        debug_meta.update({"zip_bucket": result_bucket, "zip_key": key_candidate})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"s3 download failed: {e}")

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
        import numpy as np  # noqa
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"opencv/numpy missing: {e}")

    try:
        def parse_frames(obj):
            frames = []
            if not obj:
                return frames
            if isinstance(obj, list):
                for idx, item in enumerate(obj):
                    if isinstance(item, dict):
                        # Expect keys: frame_index, detections(list of {mask: RLE})
                        item = dict(item)
                        item.setdefault("frame_index", item.get("frame", idx))
                        frames.append(item)
                return frames
            if isinstance(obj, dict):
                # Support {frames:[...]} or {index: {...}}
                if "frames" in obj:
                    return parse_frames(obj.get("frames"))
                for k, v in obj.items():
                    if isinstance(v, dict):
                        fr = dict(v)
                        fr.setdefault("frame_index", int(k) if str(k).isdigit() else 0)
                        frames.append(fr)
                frames.sort(key=lambda x: x.get("frame_index", 0))
                return frames
            return frames

        # Build mapping from extracted frames to npy files.
        if npy_dir is not None:
            # Build list of npy files sorted by natural order
            def npy_key(name: str) -> int:
                try:
                    base = os.path.splitext(os.path.basename(name))[0]
                    return int(base)
                except Exception:
                    return 0
            # Collect .npy files recursively; some zips contain nested folders
            npy_files = []
            for r, _d, files in os.walk(npy_dir):
                for f in files:
                    if f.lower().endswith('.npy'):
                        npy_files.append(os.path.join(r, f))
            npy_files.sort(key=npy_key)
            extracted_files = sorted([f for f in os.listdir(images_dir) if f.endswith('.jpg')], key=lambda x: int(os.path.splitext(x)[0]))
            n_mask = len(npy_files)
            n_img = len(extracted_files)
            debug_meta.update({"npy_count": n_mask, "extracted_count": n_img})
            if n_mask == 0 or n_img == 0:
                raise HTTPException(status_code=500, detail=f"no masks or frames to render (npy={n_mask}, frames={n_img})")

            written = 0
            import numpy as np
            color = (0, 165, 255)  # orange
            alpha = 0.5
            for i, img_name in enumerate(extracted_files, start=1):
                # Map current image index to mask index (1-based)
                if n_img == 1:
                    mi = 1
                else:
                    mi = int(round((i - 1) * (n_mask - 1) / (n_img - 1))) + 1
                mi = max(1, min(n_mask, mi))
                mask_path = npy_files[mi - 1]
                img_path = os.path.join(images_dir, img_name)
                img = cv2.imread(img_path)
                mask = np.load(mask_path)
                # Resize mask to image size and binarize (>0 treated as lane)
                mask_resized = cv2.resize(mask.astype('uint8'), (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST)
                m = mask_resized > 0
                out = img.copy()
                out[m] = (out[m] * (1 - alpha) + np.array(color, dtype=out.dtype) * alpha).astype(out.dtype)
                out_path = os.path.join(ann_dir, img_name)
                cv2.imwrite(out_path, out)
                written += 1

        else:
            raise HTTPException(status_code=500, detail="internal error: npy_dir not prepared")

        # JSON legacy branch removed per user request

    except Exception as e:
        try:
            shutil.rmtree(work_dir)
        except Exception:
            pass
        print(f"render failed: {e}")
        raise HTTPException(status_code=500, detail=f"render failed: {e}")

    # Fallback: if nothing annotated (e.g., empty detections), copy raw frames so we can still encode
    if written == 0:
        try:
            for fname in sorted(os.listdir(images_dir)):
                if fname.endswith('.jpg'):
                    src = os.path.join(images_dir, fname)
                    dst = os.path.join(ann_dir, fname)
                    shutil.copyfile(src, dst)
            written = len([f for f in os.listdir(ann_dir) if f.endswith('.jpg')])
        except Exception:
            written = 0
        if written == 0:
            raise HTTPException(status_code=500, detail="no annotated frames generated (npy)")

    out_video = os.path.join(work_dir, "ego_lane_annotated.mp4")
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
    return {"success": True, "video_url": f"/static/{rel}", "written": written, "fps": fps, "debug": debug_meta}


