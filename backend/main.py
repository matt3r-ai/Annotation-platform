from fastapi import FastAPI, Body, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from s3_utils import S3ParquetManager
from s3_video_utils import S3VideoManager
from typing import Optional
import os
import boto3
import pandas as pd
from datetime import timedelta
import subprocess
from typing import List
import tempfile
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "../saved_video")
app = FastAPI(title="Annotation Platform API")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

s3_manager = S3ParquetManager()
s3_video_manager = S3VideoManager()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FileKeyRequest(BaseModel):
    file_key: str

@app.get("/")
async def root():
    return {"message": "Annotation Platform API", "status": "running"}

@app.get("/api/health")
async def health():
    return {"status": "healthy"}

@app.get("/api/s3/orgs")
def get_org_ids():
    return {"org_ids": s3_manager.list_org_ids()}

@app.get("/api/s3/orgs/{org_id}/keys")
def get_key_ids(org_id: str):
    return {"key_ids": s3_manager.list_key_ids_by_org(org_id)}

@app.get("/api/s3/orgs/{org_id}/keys/{key_id}/files")
def get_parquet_files(org_id: str, key_id: str):
    files = s3_manager.list_parquet_keys(org_id, key_id)
    return {"files": files}

class GPSLoadRequest(BaseModel):
    org_id: str
    key_id: str
    file_index: Optional[int] = 0

@app.post("/api/gps/load")
def load_gps_data(req: GPSLoadRequest):
    org_id = req.org_id
    key_id = req.key_id
    file_index = req.file_index or 0
    parquet_keys = s3_manager.list_parquet_keys(org_id, key_id)
    if not parquet_keys or file_index >= len(parquet_keys):
        return {"points": [], "total_points": 0, "message": "未找到数据文件", "file_index": file_index, "file_count": len(parquet_keys) if parquet_keys else 0}
    df = s3_manager.load_parquet(parquet_keys[file_index])
    points = [
        {"lat": float(row["lat"]), "lon": float(row["lon"]), "timestamp": row["timestamp"]}
        for _, row in df.iterrows()
    ]
    return {
        "points": points,
        "total_points": len(points),
        "file_index": file_index,
        "file_count": len(parquet_keys),
        "file_name": parquet_keys[file_index],
        "message": f"成功加载 {len(points)} 个点"
    }

class VideoClipRequest(BaseModel):
    org_id: str
    key_id: str
    start_ts: float
    end_ts: float
    preview_mode: bool = False  # 新增预览模式参数

# Helper to parse video start time from filename (assume format: ..._%Y-%m-%d_%H-%M-%S-front.mp4)
from datetime import datetime
import re

def parse_video_start_time(filename):
    # Example: 2024-05-01_12-00-00-front.mp4
    match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-front.mp4", filename)
    if match:
        try:
            return pd.to_datetime(match.group(1), format="%Y-%m-%d_%H-%M-%S", utc=True)
        except Exception:
            return None
    return None

def download_and_clip_videos_by_ranges(
    timestamp_ranges,
    s3_bucket,
    org_id,
    key_id,
    save_dir,
    preview_mode=False
):
    os.makedirs(save_dir, exist_ok=True)
    s3 = boto3.client("s3")
    prefix = f"{org_id}/{key_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=s3_bucket, Prefix=prefix)
    video_index = []
    for page in pages:

        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("-front.mp4") and key.startswith(prefix):
                start_time = parse_video_start_time(os.path.basename(key))
                if start_time is not None:
                    # Ensure start_time is a pandas.Timestamp and not NaTType
                    try:
                        ts = pd.to_datetime(start_time, utc=True)
                        if isinstance(ts, pd.Timestamp) and not pd.isna(ts):
                            end_time = ts + pd.Timedelta(seconds=60)
                            if not pd.isna(end_time):
                                video_index.append({
                                "key": key,
                                "start_time": ts,
                                "end_time": end_time
                            })
                        else:
                            continue
                    except Exception:
                        continue
    results = []
    for file_entry in timestamp_ranges:
        try:
            _, start_ts, end_ts = file_entry
        except ValueError:
            continue
        dt_start = pd.to_datetime(start_ts, unit="s", utc=True)
        dt_end = pd.to_datetime(end_ts, unit="s", utc=True)
        duration = (dt_end - dt_start).total_seconds()
        # if duration < 5 or duration > 20:
        #     continue
        matched_video = None
        for video in video_index:
            if video["start_time"] <= dt_start and dt_end <= video["end_time"]:
                matched_video = video
                break
        if not matched_video:
            continue
        offset_sec = (dt_start - matched_video["start_time"]).total_seconds()
        presigned_url = s3.generate_presigned_url(
            ClientMethod='get_object',
            Params={'Bucket': s3_bucket, 'Key': matched_video["key"]},
            ExpiresIn=3600
        )
        output_name = f"{dt_start:%Y-%m-%d_%H-%M-%S}_to_{dt_end:%H-%M-%S}.mp4"
        local_filename = os.path.join(save_dir, output_name)
        
        if preview_mode:
            print(f"Preview mode - returning URL without ffmpeg")  # 调试信息
            # 预览模式：返回视频URL和元数据，不保存文件
            results.append({
                "preview_url": presigned_url,
                "start_offset": offset_sec,
                "duration": duration,
                "success": True,
                "preview_mode": True
            })
            continue  # 跳过后续的ffmpeg处理
        
        # 保存模式：实际剪辑并保存文件
        cmd = [
            "ffmpeg",
            "-y",  # 自动覆盖输出文件
            "-ss", str(offset_sec),
            "-i", presigned_url,
            "-t", str(duration),
            "-c", "copy",
            local_filename
        ]
        try:
            subprocess.run(cmd, check=True)
            results.append({"file": local_filename, "success": True})
        except subprocess.CalledProcessError as e:
            results.append({"file": local_filename, "success": False, "error": str(e)})
    return results

@app.post("/api/video/clip")
def clip_video(req: VideoClipRequest):
    print(f"Received request - preview_mode: {req.preview_mode}")  # 调试信息
    # Only one range, as per frontend usage
    timestamp_ranges = [(None, req.start_ts, req.end_ts)]
    save_dir = "C:/Users/75672/Downloads/annotation-platform/saved_video"  # 保存到指定目录
    results = download_and_clip_videos_by_ranges(
        timestamp_ranges,
        s3_bucket="matt3r-driving-footage-us-west-2",  # 使用视频数据的bucket
        org_id=req.org_id,
        key_id=req.key_id,
        save_dir=save_dir,
        preview_mode=req.preview_mode
    )
    # Return the first result (if any)
    if results and results[0]["success"]:
        if req.preview_mode:
            return {
                "status": "ok", 
                "preview_url": results[0]["preview_url"],
                "start_offset": results[0]["start_offset"],
                "duration": results[0]["duration"],
                "preview_mode": True
            }
        else:
            return {"status": "ok", "file": results[0]["file"]}
    else:
        return {"status": "error", "error": results[0].get("error", "Unknown error") if results else "No result"}

@app.post("/api/local/load")
async def load_local_parquet(file: UploadFile = File(...)):
    """处理本地parquet文件上传"""
    try:
        # 检查文件类型
        if not file.filename or not file.filename.endswith('.parquet'):
            return {"error": "Only parquet files are supported"}
        
        # 保存上传的文件到临时目录
        with tempfile.NamedTemporaryFile(delete=False, suffix='.parquet') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        # 读取parquet文件
        df = pd.read_parquet(tmp_file_path)
        
        # 清理临时文件
        os.unlink(tmp_file_path)
        
        # 提取GPS点数据
        points = []
        for _, row in df.iterrows():
            if 'lat' in row and 'lon' in row and 'timestamp' in row:
                points.append({
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "timestamp": row["timestamp"]
                })
        
        return {
            "points": points,
            "total_points": len(points),
            "message": f"Successfully loaded {len(points)} points from local file"
        }
        
    except Exception as e:
        return {"error": f"Failed to process file: {str(e)}"}

class LocalVideoClipRequest(BaseModel):
    file_path: str
    start_ts: float
    end_ts: float
    preview_mode: bool = False

@app.post("/api/local/clip")
def clip_local_video(req: LocalVideoClipRequest):
    """处理本地文件的视频剪辑"""
    print(f"Local clip request - preview_mode: {req.preview_mode}")
    
    # 从文件路径中提取信息
    file_path = req.file_path
    file_name = os.path.basename(file_path)
    
    # 从路径中提取org_id和key_id
    # 路径格式: hamid_beta/U32K294123008/8598/processed_console_trip.parquet
    path_parts = file_path.split('/')
    org_id = path_parts[0] if len(path_parts) > 0 else "local_unknown"
    key_id = path_parts[1] if len(path_parts) > 1 else "local_unknown"
    
    print(f"Extracted org_id: {org_id}, key_id: {key_id} from path: {file_path}")
    
    # 为本地文件创建临时保存目录
    save_dir = "C:/Users/75672/Downloads/annotation-platform/saved_video/local"
    os.makedirs(save_dir, exist_ok=True)
    
    # 使用现有的剪辑函数，传入从路径提取的org_id和key_id
    timestamp_ranges = [(None, req.start_ts, req.end_ts)]
    
    # 调用现有的视频剪辑函数，就像S3版本一样
    results = download_and_clip_videos_by_ranges(
        timestamp_ranges,
        s3_bucket="matt3r-driving-footage-us-west-2",  # 使用视频数据的bucket
        org_id=org_id,  # 使用从路径提取的org_id
        key_id=key_id,  # 使用从路径提取的key_id
        save_dir=save_dir,
        preview_mode=req.preview_mode
    )
    
    # Return the first result (if any)
    if results and results[0]["success"]:
        if req.preview_mode:
            return {
                "status": "ok", 
                "preview_url": results[0]["preview_url"],
                "start_offset": results[0]["start_offset"],
                "duration": results[0]["duration"],
                "preview_mode": True,
                "org_id": org_id,
                "key_id": key_id
            }
        else:
            return {
                "status": "ok", 
                "file": results[0]["file"],
                "org_id": org_id,
                "key_id": key_id
            }
    else:
        return {
            "status": "error", 
            "error": results[0].get("error", "Unknown error") if results else "No result",
            "org_id": org_id,
            "key_id": key_id
        }

@app.get("/api/local/file-info")
def get_local_file_info():
    """获取当前本地文件信息"""
    return {
        "file_path": "local_upload",  # 这里需要从前端传递实际的文件路径
        "file_name": "processed_console_trip.parquet",
        "org_id": "local_upload",
        "key_id": "local_files"
    }

# Video-related API endpoints
@app.get("/api/video/orgs")
def get_video_org_ids():
    """获取视频数据的org_ids"""
    return {"org_ids": s3_video_manager.list_org_ids()}

@app.get("/api/video/orgs/{org_id}/keys")
def get_video_key_ids(org_id: str):
    """获取指定org_id下的key_ids"""
    return {"key_ids": s3_video_manager.list_key_ids_by_org(org_id)}

@app.get("/api/video/orgs/{org_id}/keys/{key_id}/videos")
def get_front_videos(org_id: str, key_id: str):
    """获取指定org_id和key_id下的所有front视频文件"""
    videos = s3_video_manager.list_front_videos(org_id, key_id)
    return {"videos": videos}

@app.get("/api/video/orgs/{org_id}/keys/{key_id}/videos/all")
def get_all_videos(org_id: str, key_id: str):
    """获取指定org_id和key_id下的所有视频文件，按类型分类"""
    videos = s3_video_manager.list_all_videos_by_org_key(org_id, key_id)
    return {"videos": videos}

@app.get("/api/video/url/{key:path}")
def get_video_url(key: str):
    """获取视频文件的预签名URL"""
    url = s3_video_manager.get_video_url(key)
    if url:
        return {"url": url, "success": True}
    else:
        return {"success": False, "error": "Failed to generate URL"}

@app.post("/api/video/download-to-local")
def download_video_to_local(data: dict):
    """下载S3视频到本地并返回本地静态URL"""
    key = data.get("key")
    if not key:
        return {"success": False, "error": "Missing key"}
    key = unquote(key)
    local_dir = "../saved_video"
    os.makedirs(local_dir, exist_ok=True)
    filename = os.path.basename(key)
    local_path = os.path.join(local_dir, filename)
    # 如果本地已存在则不重复下载
    if not os.path.exists(local_path):
        s3 = boto3.client("s3")
        try:
            s3.download_file("matt3r-driving-footage-us-west-2", key, local_path)
        except Exception as e:
            return {"success": False, "error": str(e)}
    return {"success": True, "local_url": f"/static/{filename}"}

@app.post("/api/video/extract-frames")
def extract_frames_from_s3(
    s3_key: str = Body(...),
    filename: str = Body(...),
    fps: int = Body(3)
):
    print(f"Extracting frames from {s3_key} with fps {fps}")
    # 1. 直接使用完整的S3 key
    # 2. 获取presigned URL
    s3_url = s3_video_manager.get_video_url(s3_key)
    if not s3_url:
        return {"error": "Failed to generate presigned URL"}
    # 3. 生成唯一输出目录
    session_id = str(uuid.uuid4())
    output_dir = os.path.join(STATIC_DIR, "frames", session_id)
    os.makedirs(output_dir, exist_ok=True)
    # 4. ffmpeg抽帧
    cmd = [
        "ffmpeg", "-y", "-i", s3_url, "-vf", f"fps={fps}",
        os.path.join(output_dir, "frame_%05d.jpg")
    ]
    try:
        subprocess.run(cmd, check=True)
    except Exception as e:
        return {"error": f"ffmpeg failed: {str(e)}"}
    # 5. 返回图片URL
    rel_dir = f"frames/{session_id}"
    urls = [f"/static/{rel_dir}/{f}" for f in sorted(os.listdir(output_dir)) if f.endswith('.jpg')]
    return {"frames": urls}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 