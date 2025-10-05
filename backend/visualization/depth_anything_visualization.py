from fastapi import APIRouter, HTTPException
import os
import uuid
import boto3
import subprocess
import shutil

router = APIRouter()

STATIC_DIR = "/app/data/saved_video"

@router.post("/api/viz/render-depth")
async def render_depth(req: dict):
    video_path = req.get("video_path")
    zip_path = req.get("result_zip_path") or req.get("zip_path") or req.get("result_dir_path")
    fps = int(req.get("fps") or 3)

    VIDEO_BUCKET = os.getenv("VIDEO_BUCKET", "matt3r-driving-footage-us-west-2")
    RESULT_BUCKET = os.getenv("RESULT_BUCKET", "matt3r-ce-inference-output")
    if not video_path or not zip_path:
        raise HTTPException(status_code=400, detail="missing video_path or result_zip_path")

    session_id = str(uuid.uuid4())
    work_dir = os.path.join(STATIC_DIR, "viz", session_id)
    images_dir = os.path.join(work_dir, "images")
    ann_dir = os.path.join(work_dir, "annotated")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(ann_dir, exist_ok=True)

    s3 = boto3.client("s3")
    try:
        # Normalize s3 paths
        def norm(p: str, default_bucket: str):
            q = p.strip()
            if q.startswith("s3://"):
                q = q[5:]
            if "/" in q:
                b, k = q.split("/", 1)
            else:
                b, k = default_bucket, q
            return b, k

        vb, vk = norm(video_path, VIDEO_BUCKET)
        rb, rk = norm(zip_path, RESULT_BUCKET)
        # Resolve zip in a folder
        if not rk.lower().endswith('.zip'):
            prefix = rk.rstrip('/') + '/'
            resp = s3.list_objects_v2(Bucket=rb, Prefix=prefix)
            found = None
            for it in resp.get('Contents', []):
                k = it.get('Key') or ''
                if k.lower().endswith('.zip'):
                    found = k
                    break
            if not found:
                raise HTTPException(status_code=404, detail=f"zip not found under {rb}/{rk}")
            rk = found

        local_video = os.path.join(work_dir, os.path.basename(vk))
        s3.download_file(vb, vk, local_video)
        local_zip = os.path.join(work_dir, "depth_anything.zip")
        s3.download_file(rb, rk, local_zip)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"s3 download failed: {e}")

    # extract frames
    try:
        cmd = ["ffmpeg", "-y", "-i", local_video, "-vf", f"fps={fps}", os.path.join(images_dir, "%d.jpg")]
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg extract failed: {e}")

    # unzip and render
    try:
        import zipfile, numpy as np, cv2
        npy_root = os.path.join(work_dir, "npy")
        os.makedirs(npy_root, exist_ok=True)
        with zipfile.ZipFile(local_zip, 'r') as zf:
            zf.extractall(npy_root)

        # collect npy recursively
        def npy_key(name: str) -> int:
            try:
                base = os.path.splitext(os.path.basename(name))[0]
                return int(base)
            except Exception:
                return 0
        npy_files = []
        for r, _d, files in os.walk(npy_root):
            for f in files:
                if f.lower().endswith('.npy'):
                    npy_files.append(os.path.join(r, f))
        npy_files.sort(key=npy_key)

        extracted = sorted([f for f in os.listdir(images_dir) if f.endswith('.jpg')], key=lambda x: int(os.path.splitext(x)[0]))
        if len(npy_files) == 0 or len(extracted) == 0:
            raise HTTPException(status_code=500, detail=f"no depth masks or frames (npy={len(npy_files)}, frames={len(extracted)})")

        # simple colormap (inferno-like) and normalization per-frame
        def colorize(depth: np.ndarray) -> np.ndarray:
            d = depth.astype('float32')
            # robust min/max to mitigate outliers
            lo = float(np.percentile(d, 1.0))
            hi = float(np.percentile(d, 99.0))
            if hi <= lo:
                lo, hi = float(np.min(d)), float(np.max(d))
            d = np.clip((d - lo) / max(1e-6, (hi - lo)), 0, 1)
            d8 = (d * 255).astype('uint8')
            return cv2.applyColorMap(d8, cv2.COLORMAP_MAGMA)

        written = 0
        alpha = 0.6
        for i, img_name in enumerate(extracted, start=1):
            if len(extracted) == 1:
                mi = 1
            else:
                mi = int(round((i - 1) * (len(npy_files) - 1) / (len(extracted) - 1))) + 1
            mi = max(1, min(len(npy_files), mi))
            mask_path = npy_files[mi - 1]
            img_path = os.path.join(images_dir, img_name)
            img = cv2.imread(img_path)
            depth = np.load(mask_path)
            color = colorize(depth)
            color = cv2.resize(color, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST)
            out = (img * (1 - alpha) + color * alpha).astype(img.dtype)
            cv2.imwrite(os.path.join(ann_dir, img_name), out)
            written += 1
    except Exception as e:
        try:
            shutil.rmtree(work_dir)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"render failed: {e}")

    # encode video
    out_video = os.path.join(work_dir, "depth_annotated.mp4")
    try:
        annotated = sorted([f for f in os.listdir(ann_dir) if f.endswith('.jpg')], key=lambda x: int(os.path.splitext(x)[0]))
        if not annotated:
            raise HTTPException(status_code=500, detail="no annotated frames")
        start_num = int(os.path.splitext(annotated[0])[0])
        pattern = os.path.join(ann_dir, "%d.jpg").replace("\\", "/")
        cmd = ["ffmpeg", "-y", "-framerate", str(fps), "-start_number", str(start_num), "-i", pattern, "-c:v", "libx264", "-pix_fmt", "yuv420p", out_video]
        subprocess.run(cmd, check=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg encode failed: {e}")

    rel = os.path.relpath(out_video, STATIC_DIR).replace("\\", "/")
    return {"success": True, "video_url": f"/static/{rel}"}



