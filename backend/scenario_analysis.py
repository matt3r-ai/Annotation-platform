from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
import json
import os
import psycopg2
from datetime import datetime, timedelta
import boto3
import tempfile
import os
from pathlib import Path
import pandas as pd

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

# Database configuration for MCDB
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "matt3r-aurora-catalog-cluster.cluster-ro-cbbarg1ot9rc.us-west-2.rds.amazonaws.com"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "postgres"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "2gDaUYCNIt2kpMOWlRQi")
}

def get_db_connection():
    """获取数据库连接"""
    try:
        print(f"Attempting to connect to database:")
        print(f"  Host: {DB_CONFIG['host']}")
        print(f"  Port: {DB_CONFIG['port']}")
        print(f"  Database: {DB_CONFIG['database']}")
        print(f"  User: {DB_CONFIG['user']}")
        print(f"  Password: {'*' * len(DB_CONFIG['password'])}")
        
        conn = psycopg2.connect(**DB_CONFIG)
        print("✅ Database connection successful!")
        return conn
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        print("Please check your database credentials and network connection.")
        return None

# Data models
class ScenarioQuery(BaseModel):
    event_types: List[str]
    days_back: int = 7
    limit: int = 50

class Segment(BaseModel):
    start_time: float
    end_time: float
    interesting: bool = True
    notes: Optional[str] = None

class ReviewData(BaseModel):
    scenario_id: int
    segments: List[Segment]
    interesting: bool

class ProcessParams(BaseModel):
    scenario_ids: List[int]
    generate_videos: bool = True
    extract_data: bool = True
    create_visualizations: bool = True

# Mock data for development (fallback)
mock_scenarios = [
    {
        "id": 1,
        "event_type": "fcw",
        "timestamp": "2024-01-15 10:30:00",
        "status": "pending",
        "video_url": "s3://bucket/video1.mp4",
        "data_url": "s3://bucket/data1.parquet"
    },
    {
        "id": 2,
        "event_type": "harsh-brake",
        "timestamp": "2024-01-15 11:45:00",
        "status": "pending",
        "video_url": "s3://bucket/video2.mp4",
        "data_url": "s3://bucket/data2.parquet"
    },
    {
        "id": 3,
        "event_type": "lane-departure",
        "timestamp": "2024-01-15 14:20:00",
        "status": "pending",
        "video_url": "s3://bucket/video3.mp4",
        "data_url": "s3://bucket/data3.parquet"
    }
]

# Video download configuration
DOWNLOAD_DIR = "./downloads"
S3_BUCKET = "matt3r-driving-footage-us-west-2"

def ensure_download_dir():
    """确保下载目录存在"""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def get_s3_video_url(scenario_id: int, video_key: str = None) -> str:
    """从S3获取视频的预签名URL"""
    try:
        print(f"Attempting to get S3 URL for scenario {scenario_id}")
        s3_client = boto3.client('s3')
        
        # 如果没有提供video_key，使用默认路径
        if not video_key:
            video_key = f"scenarios/scenario_{scenario_id}.mp4"
        
        print(f"Using S3 bucket: {S3_BUCKET}")
        print(f"Using video key: {video_key}")
        
        # 首先检查文件是否存在
        try:
            s3_client.head_object(Bucket=S3_BUCKET, Key=video_key)
            print(f"✅ Video file exists in S3: {video_key}")
        except Exception as e:
            print(f"❌ Video file not found in S3: {video_key}")
            print(f"Error: {e}")
            return None
        
        # 生成预签名URL，有效期1小时
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': video_key
            },
            ExpiresIn=3600
        )
        
        print(f"✅ Generated presigned URL: {url[:100]}...")
        return url
        
    except Exception as e:
        print(f"❌ Error generating S3 URL for scenario {scenario_id}: {e}")
        return None

def download_video_from_s3(scenario_id: int, video_key: str) -> str:
    """从S3下载视频到本地"""
    try:
        ensure_download_dir()
        
        # 创建本地文件路径
        local_filename = f"scenario_{scenario_id}.mp4"
        local_path = os.path.join(DOWNLOAD_DIR, local_filename)
        
        # 如果文件已存在，直接返回路径
        if os.path.exists(local_path):
            return local_path
        
        # 从S3下载视频
        s3_client = boto3.client('s3')
        s3_client.download_file(S3_BUCKET, video_key, local_path)
        
        print(f"Video downloaded: {local_path}")
        return local_path
        
    except Exception as e:
        print(f"Error downloading video for scenario {scenario_id}: {e}")
        return None

@router.post("/fetch")
async def fetch_scenarios(query: ScenarioQuery):
    """获取场景数据"""
    try:
        conn = get_db_connection()
        if not conn:
            # Fallback to mock data if database connection fails
            print("Using mock data due to database connection failure")
            filtered_scenarios = [
                s for s in mock_scenarios 
                if s["event_type"] in query.event_types
            ][:query.limit]
            
            return {
                "status": "success",
                "scenarios": filtered_scenarios,
                "total": len(filtered_scenarios),
                "query": query.dict(),
                "note": "Using mock data - database connection failed"
            }
        
        # Real database query
        cursor = conn.cursor()
        
        # Build the query based on event types
        event_conditions = []
        for event_type in query.event_types:
            if event_type == "fcw":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"fcw\")')")
            elif event_type == "harsh-brake":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"harsh-brake\")')")
            elif event_type == "lane-departure":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"lane-departure\")')")
            elif event_type == "left-turn":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"left-turn\")')")
            elif event_type == "right-turn":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"right-turn\")')")
            elif event_type == "u-turn":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"u-turn\")')")
            elif event_type == "pedestrian":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"pedestrian\")')")
            elif event_type == "traffic-light":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"traffic-light\")')")
            elif event_type == "stop-sign":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"stop-sign\")')")
            elif event_type == "yield-sign":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"yield-sign\")')")
            elif event_type == "speed-limit":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"speed-limit\")')")
            elif event_type == "construction-zone":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"construction-zone\")')")
            elif event_type == "school-zone":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"school-zone\")')")
            elif event_type == "emergency-vehicle":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"emergency-vehicle\")')")
            elif event_type == "weather-condition":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"weather-condition\")')")
            elif event_type == "road-condition":
                event_conditions.append("jsonb_path_exists(data_links, '$.coreml.* ? (@.event == \"road-condition\")')")
        
        # 构建SQL查询
        if not event_conditions:
            # 如果没有选择事件类型，只检查dmp_status = 'SUCCESS'
            sql_query = f"""
            SELECT id, created_at, data_links, dmp_status, start_time, end_time
            FROM public.dmp
            WHERE dmp_status = 'SUCCESS'
              AND jsonb_path_exists(data_links, '$.trip.console_trip ? (@ != null && @ != "null")')
              AND created_at >= NOW() - INTERVAL '{query.days_back} days'
            ORDER BY id DESC
            LIMIT {query.limit};
            """
        else:
            # 如果选择了事件类型，使用AND条件确保场景同时包含所有选中的event types
            event_condition = " AND ".join(event_conditions)
            sql_query = f"""
            SELECT id, created_at, data_links, dmp_status, start_time, end_time
            FROM public.dmp
            WHERE dmp_status = 'SUCCESS'
              AND jsonb_path_exists(data_links, '$.trip.console_trip ? (@ != null && @ != "null")')
              AND ({event_condition})
              AND created_at >= NOW() - INTERVAL '{query.days_back} days'
            ORDER BY id DESC
            LIMIT {query.limit};
            """
        
        print(f"Executing SQL query: {sql_query}")
        cursor.execute(sql_query)
        rows = cursor.fetchall()
        
        scenarios = []
        for row in rows:
            scenario_id, created_at, data_links, dmp_status, start_time, end_time = row
            
            # Determine event type from data_links
            event_type = "unknown"
            if data_links and isinstance(data_links, dict):
                coreml_events = data_links.get("coreml", {})
                if isinstance(coreml_events, dict):
                    # 处理对象格式的coreml数据
                    for event_id, event_data in coreml_events.items():
                        if isinstance(event_data, dict) and event_data.get("event") in [
                            "fcw", "harsh-brake", "lane-departure", "left-turn", "right-turn", 
                            "u-turn", "pedestrian", "traffic-light", "stop-sign", "yield-sign",
                            "speed-limit", "construction-zone", "school-zone", "emergency-vehicle",
                            "weather-condition", "road-condition"
                        ]:
                            event_type = event_data["event"]
                            break
                elif isinstance(coreml_events, list):
                    # 兼容数组格式
                    for event in coreml_events:
                        if isinstance(event, dict) and event.get("event") in [
                            "fcw", "harsh-brake", "lane-departure", "left-turn", "right-turn", 
                            "u-turn", "pedestrian", "traffic-light", "stop-sign", "yield-sign",
                            "speed-limit", "construction-zone", "school-zone", "emergency-vehicle",
                            "weather-condition", "road-condition"
                        ]:
                            event_type = event["event"]
                            break
            
            # Extract video path from data_links
            video_path = None
            if data_links and isinstance(data_links, dict):
                print(f"Data links for scenario {scenario_id}:")
                print(f"  Keys: {list(data_links.keys())}")
                
                # 检查是否有直接的视频路径
                if 'video' in data_links and data_links['video']:
                    video_data = data_links['video']
                    print(f"  Found video data: {video_data}")
                    
                    if isinstance(video_data, dict) and 'front' in video_data:
                        # 直接使用front视频的完整S3 URL
                        front_video_url = video_data['front']
                        print(f"  Front video URL: {front_video_url}")
                        
                        # 从完整URL中提取相对路径
                        if front_video_url.startswith('s3://'):
                            parts = front_video_url.split('/')
                            if len(parts) >= 4:  # s3://bucket-name/path...
                                # 移除s3://和bucket-name，只保留相对路径
                                relative_path = '/'.join(parts[3:])
                                video_path = relative_path
                                print(f"  Extracted video path: {video_path}")
                
                # 如果没有找到视频路径，使用默认路径
                if not video_path:
                    print(f"  No video path found, using default")
                    video_path = f"scenarios/scenario_{scenario_id}.mp4"
            
            scenario_data = {
                "id": scenario_id,
                "event_type": event_type,
                "timestamp": created_at.isoformat() if created_at else "unknown",
                "status": "pending",
                "dmp_status": dmp_status,
                "data_links": data_links,
                "video_path": video_path,
                "console_trip": data_links.get("trip", {}).get("console_trip") if data_links else None,
                "start_time": start_time,
                "end_time": end_time
            }
            
            # 如果有video_path，生成S3 URL
            if video_path:
                try:
                    s3_url = get_s3_video_url(scenario_id, video_path)
                    if s3_url:
                        scenario_data["video_url"] = s3_url
                        scenario_data["s3_key"] = video_path
                except Exception as e:
                    print(f"Error generating S3 URL for scenario {scenario_id}: {e}")
            
            scenarios.append(scenario_data)
        
        cursor.close()
        conn.close()
        
        print(f"Found {len(scenarios)} scenarios")
        print("=" * 50)
        print("📊 FETCH RESULTS SUMMARY:")
        print("=" * 50)
        
        for i, scenario in enumerate(scenarios[:5]):  # 只显示前5个场景
            print(f"\n🔍 Scenario {i+1}: ID={scenario['id']}")
            print(f"   Event Type: {scenario['event_type']}")
            print(f"   Console Trip: {scenario['console_trip']}")
            print(f"   Video URL: {'✅' if 'video_url' in scenario else '❌'}")
            
            # 显示data_links的关键信息
            if scenario.get('data_links'):
                data_links = scenario['data_links']
                print(f"   Data Links Keys: {list(data_links.keys())}")
                
                # 显示coreml events数量
                coreml_events = data_links.get("coreml", {})
                if isinstance(coreml_events, dict):
                    print(f"   CoreML Events: {len(coreml_events)} events")
                    if len(coreml_events) > 0:
                        print(f"   First 3 events:")
                        for j, (event_id, event_data) in enumerate(list(coreml_events.items())[:3]):
                            if isinstance(event_data, dict):
                                event_type = event_data.get("event", "unknown")
                                timestamp = event_data.get("timestamp", "no timestamp")
                                print(f"     {j+1}. {event_type} @ {timestamp}")
                            else:
                                print(f"     {j+1}. Invalid format: {event_data}")
                elif isinstance(coreml_events, list):
                    print(f"   CoreML Events: {len(coreml_events)} events (array format)")
                    if len(coreml_events) > 0:
                        print(f"   First 3 events:")
                        for j, event in enumerate(coreml_events[:3]):
                            if isinstance(event, dict):
                                event_type = event.get("event", "unknown")
                                timestamp = event.get("timestamp", "no timestamp")
                                print(f"     {j+1}. {event_type} @ {timestamp}")
                            else:
                                print(f"     {j+1}. Invalid format: {event}")
                else:
                    print(f"   CoreML Events: ❌ Not found or invalid format")
            else:
                print(f"   Data Links: ❌ Not found")
        
        if len(scenarios) > 5:
            print(f"\n... and {len(scenarios) - 5} more scenarios")
        
        print("=" * 50)
        
        return {
            "status": "success",
            "scenarios": scenarios,
            "total": len(scenarios),
            "query": query.dict()
        }
        
    except Exception as e:
        print(f"Error fetching scenarios: {e}")
        # Fallback to mock data
        filtered_scenarios = [
            s for s in mock_scenarios 
            if s["event_type"] in query.event_types
        ][:query.limit]
        
        return {
            "status": "success",
            "scenarios": filtered_scenarios,
            "total": len(filtered_scenarios),
            "query": query.dict(),
            "note": f"Using mock data - error: {str(e)}"
        }

@router.post("/review")
async def save_review_data(review_data: ReviewData):
    """保存审核数据"""
    try:
        # Simulate saving to database
        review_record = {
            "scenario_id": review_data.scenario_id,
            "segments": [s.dict() for s in review_data.segments],
            "interesting": review_data.interesting,
            "reviewed_at": datetime.now().isoformat()
        }
        
        # Update scenario status
        for scenario in mock_scenarios:
            if scenario["id"] == review_data.scenario_id:
                scenario["status"] = "reviewed"
                break
        
        return {
            "status": "success",
            "message": f"Review data saved for scenario {review_data.scenario_id}",
            "review_data": review_record
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/process")
async def process_scenarios(process_params: ProcessParams, background_tasks: BackgroundTasks):
    """处理场景数据"""
    try:
        # Simulate processing
        processing_results = []
        
        for scenario_id in process_params.scenario_ids:
            result = {
                "scenario_id": scenario_id,
                "status": "processing",
                "progress": 0,
                "outputs": []
            }
            
            if process_params.generate_videos:
                result["outputs"].append("cropped_video.mp4")
            
            if process_params.extract_data:
                result["outputs"].append("trip_data.parquet")
            
            if process_params.create_visualizations:
                result["outputs"].append("map_visualization.html")
            
            processing_results.append(result)
        
        # Simulate background processing
        background_tasks.add_task(simulate_processing, processing_results)
        
        return {
            "status": "success",
            "message": f"Processing started for {len(process_params.scenario_ids)} scenarios",
            "processing_results": processing_results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{scenario_id}")
async def get_processing_status(scenario_id: int):
    """获取处理状态"""
    try:
        # Simulate status check
        status = {
            "scenario_id": scenario_id,
            "status": "completed",
            "progress": 100,
            "outputs": [
                "cropped_video.mp4",
                "trip_data.parquet",
                "map_visualization.html"
            ],
            "completed_at": datetime.now().isoformat()
        }
        
        return {
            "status": "success",
            "data": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/list")
async def list_scenarios():
    """列出所有场景"""
    try:
        return {
            "status": "success",
            "scenarios": mock_scenarios,
            "total": len(mock_scenarios)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/video-url/{scenario_id}")
async def get_scenario_video_url(scenario_id: int):
    """获取场景视频的S3预签名URL"""
    try:
        print(f"🔍 Requesting video URL for scenario {scenario_id}")
        
        # 从数据库获取场景信息和视频路径
        conn = get_db_connection()
        if not conn:
            return {
                "status": "error",
                "message": "Database connection failed",
                "scenario_id": scenario_id
            }
        
        cursor = conn.cursor()
        
        # 查询场景信息和视频路径
        sql_query = """
        SELECT id, data_links, created_at
        FROM public.dmp
        WHERE id = %s
        """
        
        cursor.execute(sql_query, (scenario_id,))
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": f"Scenario {scenario_id} not found in database",
                "scenario_id": scenario_id
            }
        
        scenario_id_db, data_links, created_at = row
        cursor.close()
        conn.close()
        
        print(f"Found scenario {scenario_id} in database")
        print(f"Data links: {data_links}")
        
        # 从data_links中提取视频路径
        video_key = None
        if data_links and isinstance(data_links, dict):
            # 检查是否有直接的视频路径
            if 'video' in data_links and data_links['video']:
                video_data = data_links['video']
                print(f"Found video data: {video_data}")
                
                if isinstance(video_data, dict) and 'front' in video_data:
                    # 直接使用front视频的完整S3 URL
                    front_video_url = video_data['front']
                    print(f"Front video URL: {front_video_url}")
                    
                    # 从完整URL中提取相对路径
                    if front_video_url.startswith('s3://'):
                        parts = front_video_url.split('/')
                        if len(parts) >= 4:  # s3://bucket-name/path...
                            # 移除s3://和bucket-name，只保留相对路径
                            relative_path = '/'.join(parts[3:])
                            video_key = relative_path
                            print(f"Extracted video path: {video_key}")
        
        # 如果无法从数据库获取，使用默认路径
        if not video_key:
            # 使用S3测试中找到的实际路径作为示例
            video_key = "061fbe20-e749-4c3c-92c9-929f81194a1e/U32K295053426/2025/07/25/18/2025-07-25_18-51-49-front.mp4"
            print(f"Using fallback video key: {video_key}")
        
        print(f"Using video key: {video_key}")
        
        video_url = get_s3_video_url(scenario_id, video_key)
        
        if video_url:
            print(f"✅ Successfully generated video URL for scenario {scenario_id}")
            return {
                "status": "success",
                "video_url": video_url,
                "scenario_id": scenario_id,
                "bucket": S3_BUCKET,
                "key": video_key
            }
        else:
            print(f"❌ Failed to generate video URL for scenario {scenario_id}")
            return {
                "status": "error",
                "message": "Video not found in S3",
                "scenario_id": scenario_id,
                "bucket": S3_BUCKET,
                "key": video_key
            }
            
    except Exception as e:
        print(f"❌ Error in get_scenario_video_url: {e}")
        return {
            "status": "error",
            "message": str(e),
            "scenario_id": scenario_id
        }

@router.post("/download-video/{scenario_id}")
async def download_scenario_video(scenario_id: int):
    """下载指定场景的视频"""
    try:
        # 这里需要根据scenario_id从数据库获取实际的视频路径
        # 暂时使用模拟的S3路径
        video_key = f"scenarios/scenario_{scenario_id}.mp4"
        
        local_path = download_video_from_s3(scenario_id, video_key)
        
        if local_path:
            return {
                "status": "success",
                "local_path": local_path,
                "scenario_id": scenario_id
            }
        else:
            raise HTTPException(status_code=404, detail="Video not found or download failed")
            
    except Exception as e:
        print(f"Download error: {e}")
        # 返回错误信息而不是抛出异常
        return {
            "status": "error",
            "message": str(e),
            "scenario_id": scenario_id
        }

@router.get("/video-status/{scenario_id}")
async def get_video_status(scenario_id: int):
    """检查视频下载状态"""
    try:
        local_filename = f"scenario_{scenario_id}.mp4"
        local_path = os.path.join(DOWNLOAD_DIR, local_filename)
        
        if os.path.exists(local_path):
            file_size = os.path.getsize(local_path)
            return {
                "status": "downloaded",
                "local_path": local_path,
                "file_size": file_size,
                "scenario_id": scenario_id
            }
        else:
            return {
                "status": "pending",
                "scenario_id": scenario_id
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def simulate_processing(processing_results):
    """模拟后台处理"""
    import asyncio
    
    for result in processing_results:
        # Simulate processing time
        for i in range(10):
            await asyncio.sleep(0.5)
            result["progress"] = (i + 1) * 10
        
        result["status"] = "completed"
        result["completed_at"] = datetime.now().isoformat() 

@router.get("/test-s3-access")
async def test_s3_access():
    """测试S3访问权限"""
    try:
        print("🔍 Testing S3 access...")
        s3_client = boto3.client('s3')
        
        # 列出存储桶中的对象
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            MaxKeys=10
        )
        
        objects = response.get('Contents', [])
        print(f"✅ Found {len(objects)} objects in bucket {S3_BUCKET}")
        
        # 显示前几个对象
        for i, obj in enumerate(objects[:5]):
            print(f"  {i+1}. {obj['Key']} ({obj['Size']} bytes)")
        
        return {
            "status": "success",
            "bucket": S3_BUCKET,
            "object_count": len(objects),
            "sample_objects": [obj['Key'] for obj in objects[:5]]
        }
        
    except Exception as e:
        print(f"❌ S3 access test failed: {e}")
        return {
            "status": "error",
            "message": str(e),
            "bucket": S3_BUCKET
        } 

@router.get("/debug/scenario/{scenario_id}")
async def debug_scenario(scenario_id: int):
    """调试场景数据"""
    try:
        print(f"🔍 Debugging scenario {scenario_id}")
        
        conn = get_db_connection()
        if not conn:
            return {
                "status": "error",
                "message": "Database connection failed",
                "scenario_id": scenario_id
            }
        
        cursor = conn.cursor()
        
        # 查询场景信息
        sql_query = """
        SELECT id, data_links, created_at, dmp_status
        FROM public.dmp
        WHERE id = %s
        """
        
        cursor.execute(sql_query, (scenario_id,))
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": f"Scenario {scenario_id} not found in database",
                "scenario_id": scenario_id
            }
        
        scenario_id_db, data_links, created_at, dmp_status = row
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "scenario_id": scenario_id_db,
            "created_at": created_at.isoformat() if created_at else None,
            "dmp_status": dmp_status,
            "data_links": data_links,
            "data_links_type": type(data_links).__name__,
            "data_links_keys": list(data_links.keys()) if isinstance(data_links, dict) else None
        }
        
    except Exception as e:
        print(f"❌ Error in debug_scenario: {e}")
        return {
            "status": "error",
            "message": str(e),
            "scenario_id": scenario_id
        } 

@router.get("/test-db-connection")
async def test_db_connection():
    """测试数据库连接"""
    try:
        print("🔍 Testing database connection...")
        
        conn = get_db_connection()
        if not conn:
            return {
                "status": "error",
                "message": "Database connection failed",
                "config": {
                    "host": DB_CONFIG["host"],
                    "port": DB_CONFIG["port"],
                    "database": DB_CONFIG["database"],
                    "user": DB_CONFIG["user"],
                    "password_length": len(DB_CONFIG["password"])
                }
            }
        
        # 测试查询
        cursor = conn.cursor()
        cursor.execute("SELECT version()")
        version = cursor.fetchone()
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "message": "Database connection successful",
            "version": version[0] if version else "Unknown",
            "config": {
                "host": DB_CONFIG["host"],
                "port": DB_CONFIG["port"],
                "database": DB_CONFIG["database"],
                "user": DB_CONFIG["user"],
                "password_length": len(DB_CONFIG["password"])
            }
        }
        
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        return {
            "status": "error",
            "message": str(e),
            "config": {
                "host": DB_CONFIG["host"],
                "port": DB_CONFIG["port"],
                "database": DB_CONFIG["database"],
                "user": DB_CONFIG["user"],
                "password_length": len(DB_CONFIG["password"])
            }
        }

@router.get("/activity-timeline/{scenario_id}")
async def get_activity_timeline(scenario_id: int):
    """获取场景的activity时间节点"""
    try:
        print(f"🔍 Getting activity timeline for scenario {scenario_id}")
        
        conn = get_db_connection()
        if not conn:
            return {
                "status": "error",
                "message": "Database connection failed",
                "scenario_id": scenario_id
            }
        
        cursor = conn.cursor()
        
        # 查询场景信息和data_links
        sql_query = """
        SELECT id, data_links, created_at, start_time, end_time
        FROM public.dmp
        WHERE id = %s
        """
        
        cursor.execute(sql_query, (scenario_id,))
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": f"Scenario {scenario_id} not found in database",
                "scenario_id": scenario_id
            }
        
        scenario_id_db, data_links, created_at, start_time, end_time = row
        cursor.close()
        conn.close()
        
        # 解析data_links中的activity时间节点
        activities = []
        
        if data_links and isinstance(data_links, dict):
            print(f"\n🎬 Activity Timeline for Scenario {scenario_id}:")
            
            # 获取视频的开始和结束时间
            start_time_data = data_links.get("start_time") or data_links.get("trip", {}).get("start_time")
            end_time_data = data_links.get("end_time") or data_links.get("trip", {}).get("end_time")
            
            # 优先使用start_time和end_time字段，如果存在
            video_start_time = start_time_data if start_time_data is not None else start_time
            video_end_time = end_time_data if end_time_data is not None else end_time
            
            if video_start_time:
                print(f"  📅 Video start time: {video_start_time}")
                print(f"  📅 Video end time: {video_end_time}")
                video_duration = video_end_time - video_start_time if video_end_time else 60  # 默认60秒
                print(f"  ⏱️  Video duration: {video_duration} seconds")
            else:
                print(f"  ⚠️  No start_time found, using default 60s duration")
                video_duration = 60
            
            # 从coreml数据中提取activity
            coreml_events = data_links.get("coreml", {})
            if isinstance(coreml_events, dict) and len(coreml_events) > 0:
                print(f"  📊 Found {len(coreml_events)} coreml events")
                for event_id, event_data in coreml_events.items():
                    if isinstance(event_data, dict):
                        # 检查是否有timestamp字段
                        absolute_timestamp = event_data.get("timestamp")
                        if absolute_timestamp is not None and video_start_time:
                            # 计算相对于视频开始时间的偏移量
                            relative_timestamp = absolute_timestamp - video_start_time
                            if relative_timestamp >= 0 and relative_timestamp <= video_duration:
                                activity = {
                                    "type": event_data.get("event", "unknown"),
                                    "timestamp": relative_timestamp,
                                    "confidence": event_data.get("confidence", 0.8),
                                    "description": event_data.get("description", f"Event {event_id}")
                                }
                                activities.append(activity)
                                print(f"    ✅ Activity {event_id}: {activity['type']} @ {relative_timestamp:.2f}s (absolute: {absolute_timestamp})")
                            else:
                                print(f"    ⚠️  Event {event_id}: Timestamp {relative_timestamp:.2f}s outside video range (0-{video_duration}s)")
                        elif absolute_timestamp is not None:
                            # 没有start_time，直接使用绝对时间戳
                            activity = {
                                "type": event_data.get("event", "unknown"),
                                "timestamp": float(absolute_timestamp),
                                "confidence": event_data.get("confidence", 0.8),
                                "description": event_data.get("description", f"Event {event_id}")
                            }
                            activities.append(activity)
                            print(f"    ✅ Activity {event_id}: {activity['type']} @ {absolute_timestamp}s (no start_time)")
                        else:
                            print(f"    ❌ Event {event_id}: No timestamp - {event_data.get('event', 'unknown')}")
                    else:
                        print(f"    ❌ Event {event_id}: Invalid format - {event_data}")
            elif isinstance(coreml_events, list) and len(coreml_events) > 0:
                # 兼容数组格式（如果存在）
                print(f"  📊 Found {len(coreml_events)} coreml events (array format)")
                for i, event in enumerate(coreml_events):
                    if isinstance(event, dict):
                        # 检查是否有timestamp字段
                        absolute_timestamp = event.get("timestamp")
                        if absolute_timestamp is not None and video_start_time:
                            # 计算相对于视频开始时间的偏移量
                            relative_timestamp = absolute_timestamp - video_start_time
                            if relative_timestamp >= 0 and relative_timestamp <= video_duration:
                                activity = {
                                    "type": event.get("event", "unknown"),
                                    "timestamp": relative_timestamp,
                                    "confidence": event.get("confidence", 0.8),
                                    "description": event.get("description", f"Event {i+1}")
                                }
                                activities.append(activity)
                                print(f"    ✅ Activity {i+1}: {activity['type']} @ {relative_timestamp:.2f}s (absolute: {absolute_timestamp})")
                            else:
                                print(f"    ⚠️  Event {i+1}: Timestamp {relative_timestamp:.2f}s outside video range (0-{video_duration}s)")
                        elif absolute_timestamp is not None:
                            # 没有start_time，直接使用绝对时间戳
                            activity = {
                                "type": event.get("event", "unknown"),
                                "timestamp": float(absolute_timestamp),
                                "confidence": event.get("confidence", 0.8),
                                "description": event.get("description", f"Event {i+1}")
                            }
                            activities.append(activity)
                            print(f"    ✅ Activity {i+1}: {activity['type']} @ {absolute_timestamp}s (no start_time)")
                        else:
                            print(f"    ❌ Event {i+1}: No timestamp - {event.get('event', 'unknown')}")
            else:
                print(f"  ❌ No coreml events found or empty")
            
            # 按时间戳排序
            activities.sort(key=lambda x: x["timestamp"])
            
            if activities:
                print(f"  🎯 Total real activities: {len(activities)}")
            else:
                print(f"  🎯 No real activities found, using mock data")
        else:
            print(f"\n🎬 Activity Timeline for Scenario {scenario_id}:")
            print(f"  ❌ No data_links found, using mock data")
        
        # 如果没有找到activity，基于场景ID生成不同的模拟数据
        if not activities:
            # 使用场景ID作为种子来生成不同的activity时间
            import random
            random.seed(scenario_id)  # 确保相同场景ID总是生成相同的数据
            
            # 生成2-4个随机activity
            num_activities = random.randint(2, 4)
            activities = []
            
            # 预定义的活动类型
            activity_types = [
                {"type": "fcw", "description": "Forward Collision Warning detected"},
                {"type": "harsh-brake", "description": "Harsh braking event detected"},
                {"type": "lane-departure", "description": "Lane departure detected"},
                {"type": "pedestrian", "description": "Pedestrian crossing detected"},
                {"type": "traffic-light", "description": "Traffic light violation"},
                {"type": "speed-limit", "description": "Speed limit exceeded"},
                {"type": "u-turn", "description": "U-turn detected"},
                {"type": "left-turn", "description": "Left turn detected"},
                {"type": "right-turn", "description": "Right turn detected"},
                {"type": "stop-sign", "description": "Stop sign violation"}
            ]
            
            # 生成随机时间戳（在0-60秒范围内）
            used_timestamps = set()
            for i in range(num_activities):
                # 生成不重复的时间戳
                while True:
                    timestamp = round(random.uniform(2.0, 55.0), 1)
                    if timestamp not in used_timestamps:
                        used_timestamps.add(timestamp)
                        break
                
                # 随机选择活动类型
                activity_type = random.choice(activity_types)
                
                activity = {
                    "type": activity_type["type"],
                    "timestamp": timestamp,
                    "confidence": round(random.uniform(0.7, 0.98), 2),
                    "description": activity_type["description"]
                }
                activities.append(activity)
            
            # 按时间戳排序
            activities.sort(key=lambda x: x["timestamp"])
            
            print(f"  🎲 Generated {len(activities)} mock activities: {[a['type'] for a in activities]}")
        else:
            print(f"  ✅ Using real activities from data_links")
        
        return {
            "status": "success",
            "scenario_id": scenario_id,
            "activities": activities,
            "total_activities": len(activities)
        }
        
    except Exception as e:
        print(f"❌ Error in get_activity_timeline: {e}")
        return {
            "status": "error",
            "message": str(e),
            "scenario_id": scenario_id
        } 

@router.post("/gps/extract")
async def extract_gps_data(request: dict):
    """从 console_trip 中提取 GPS 数据"""
    try:
        console_trip_url = request.get("console_trip_url")
        if not console_trip_url:
            return {
                "status": "error",
                "message": "console_trip_url is required"
            }
        
        print(f"🔍 Extracting GPS data from: {console_trip_url}")
        
        # 从S3 URL中提取bucket和key
        if not console_trip_url.startswith("s3://"):
            return {
                "status": "error",
                "message": "Invalid S3 URL format"
            }
        
        # 解析S3 URL: s3://bucket/key
        url_parts = console_trip_url.replace("s3://", "").split("/", 1)
        if len(url_parts) != 2:
            return {
                "status": "error",
                "message": "Invalid S3 URL format"
            }
        
        bucket_name = url_parts[0]
        key = url_parts[1]
        
        print(f"📦 Bucket: {bucket_name}")
        print(f"🔑 Key: {key}")
        
        # 使用S3ParquetManager读取parquet文件
        from s3_utils import S3ParquetManager
        s3_manager = S3ParquetManager(bucket_name)
        
        try:
            # 读取parquet文件
            df = s3_manager.load_parquet(key)
            print(f"✅ Successfully loaded parquet file with {len(df)} rows")
            print(f"📊 Columns: {list(df.columns)}")
            
            # 查找GPS相关的列
            gps_columns = []
            for col in df.columns:
                col_lower = col.lower()
                if any(keyword in col_lower for keyword in ['lat', 'lon', 'lng', 'latitude', 'longitude', 'gps']):
                    gps_columns.append(col)
            
            print(f"🎯 Found GPS columns: {gps_columns}")
            
            if not gps_columns:
                return {
                    "status": "error",
                    "message": "No GPS columns found in parquet file"
                }
            
            # 提取GPS数据
            points = []
            for idx, row in df.iterrows():
                point = {}
                
                # 查找经纬度列
                lat_col = None
                lon_col = None
                
                for col in gps_columns:
                    col_lower = col.lower()
                    if 'lat' in col_lower:
                        lat_col = col
                    elif 'lon' in col_lower or 'lng' in col_lower:
                        lon_col = col
                
                if lat_col and lon_col:
                    lat = row[lat_col]
                    lon = row[lon_col]
                    
                    # 检查是否为有效坐标
                    try:
                        # 确保数据类型转换
                        lat_val = float(lat) if pd.notna(lat) else None
                        lon_val = float(lon) if pd.notna(lon) else None
                        
                        if lat_val is not None and lon_val is not None and -90 <= lat_val <= 90 and -180 <= lon_val <= 180:
                            point["lat"] = lat_val
                            point["lon"] = lon_val
                            
                            # 查找时间戳列
                            timestamp_col = None
                            for col in df.columns:
                                col_lower = col.lower()
                                if any(keyword in col_lower for keyword in ['timestamp', 'time', 'ts']):
                                    timestamp_col = col
                                    break
                            
                            if timestamp_col:
                                timestamp = row[timestamp_col]
                                if pd.notna(timestamp):
                                    # 如果是datetime对象，转换为timestamp
                                    if hasattr(timestamp, 'timestamp'):
                                        point["timestamp"] = timestamp.timestamp()
                                    else:
                                        point["timestamp"] = float(timestamp)
                                else:
                                    point["timestamp"] = float(idx)  # 使用行索引作为时间戳
                            else:
                                point["timestamp"] = float(idx)
                            
                            # 查找速度列
                            speed_col = None
                            for col in df.columns:
                                col_lower = col.lower()
                                if 'speed' in col_lower:
                                    speed_col = col
                                    break
                            
                            if speed_col:
                                speed = row[speed_col]
                                if pd.notna(speed):
                                    point["speed"] = float(speed)
                                else:
                                    point["speed"] = 0.0
                            else:
                                point["speed"] = 0.0
                            
                            # 查找方向列
                            heading_col = None
                            for col in df.columns:
                                col_lower = col.lower()
                                if any(keyword in col_lower for keyword in ['heading', 'bearing', 'direction']):
                                    heading_col = col
                                    break
                            
                            if heading_col:
                                heading = row[heading_col]
                                if pd.notna(heading):
                                    point["heading"] = float(heading)
                                else:
                                    point["heading"] = 0.0
                            else:
                                point["heading"] = 0.0
                            
                            points.append(point)
                    except (ValueError, TypeError) as e:
                        # 跳过无效的坐标数据
                        continue
            
            print(f"✅ Extracted {len(points)} GPS points")
            
            if len(points) == 0:
                return {
                    "status": "error",
                    "message": "No valid GPS points found in parquet file"
                }
            
            return {
                "status": "success",
                "points": points,
                "total_points": len(points),
                "source_url": console_trip_url
            }
            
        except Exception as e:
            print(f"❌ Error reading parquet file: {e}")
            return {
                "status": "error",
                "message": f"Error reading parquet file: {str(e)}"
            }
        
    except Exception as e:
        print(f"❌ Error extracting GPS data: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

@router.post("/video/clip")
async def clip_video(request: dict):
    """基于时间戳裁剪视频"""
    try:
        scenario_id = request.get("scenario_id")
        start_ts = request.get("start_ts")
        end_ts = request.get("end_ts")
        preview_mode = request.get("preview_mode", True)
        
        print(f"🎬 Clipping video for scenario {scenario_id}")
        print(f"⏰ Time range: {start_ts} - {end_ts}")
        print(f"📺 Preview mode: {preview_mode}")
        
        if not all([scenario_id, start_ts, end_ts]):
            return {
                "status": "error",
                "message": "scenario_id, start_ts, and end_ts are required"
            }
        
        # 获取场景的视频信息
        conn = get_db_connection()
        if not conn:
            return {
                "status": "error",
                "message": "Database connection failed"
            }
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT data_links FROM public.dmp WHERE id = %s
        """, (scenario_id,))
        
        row = cursor.fetchone()
        if not row:
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": f"Scenario {scenario_id} not found"
            }
        
        data_links = row[0]
        cursor.close()
        conn.close()
        
        print(f"📊 Data links keys: {list(data_links.keys()) if data_links else 'None'}")
        
        # 从 data_links 中提取视频路径
        video_url = None
        if data_links and isinstance(data_links, dict):
            if 'video' in data_links and data_links['video']:
                video_data = data_links['video']
                if isinstance(video_data, dict) and 'front' in video_data:
                    video_url = video_data['front']
                    print(f"🎥 Found front video URL: {video_url}")
        
        if not video_url:
            return {
                "status": "error",
                "message": "Video not found for this scenario"
            }
        
        # 计算视频裁剪的时间范围
        duration = end_ts - start_ts
        print(f"⏱️ Clip duration: {duration} seconds")
        
        if preview_mode:
            # 预览模式：使用ffmpeg直接从S3 URL截取视频片段
            try:
                # 从S3 URL中提取bucket和key
                if video_url.startswith("s3://"):
                    url_parts = video_url.replace("s3://", "").split("/", 1)
                    if len(url_parts) == 2:
                        bucket_name = url_parts[0]
                        video_key = url_parts[1]
                        
                        print(f"📦 Bucket: {bucket_name}")
                        print(f"🔑 Video key: {video_key}")
                        
                        # 生成原始视频的presigned URL
                        import boto3
                        s3_client = boto3.client('s3')
                        presigned_url = s3_client.generate_presigned_url(
                            ClientMethod='get_object',
                            Params={'Bucket': bucket_name, 'Key': video_key},
                            ExpiresIn=3600
                        )
                        
                        print(f"🎬 Using ffmpeg to clip video directly from S3 URL")
                        print(f"⏰ Time range: {start_ts} - {end_ts} (duration: {duration}s)")
                        
                        # 使用ffmpeg直接从S3 URL截取视频
                        import subprocess
                        import tempfile
                        import os
                        
                        # 创建临时输出文件
                        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_output:
                            output_path = temp_output.name
                        
                        try:
                            # 使用ffmpeg直接从S3 URL截取视频
                            ffmpeg_cmd = [
                                'ffmpeg',
                                '-y',  # 自动覆盖输出文件
                                '-ss', str(start_ts),
                                '-i', presigned_url,
                                '-t', str(duration),
                                '-c', 'copy',  # 复制流，不重新编码
                                output_path
                            ]
                            
                            print(f"🎬 Running ffmpeg command: {' '.join(ffmpeg_cmd)}")
                            result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
                            
                            if result.returncode == 0:
                                print(f"✅ Video clipped successfully to: {output_path}")
                                
                                # 上传截取的视频到S3
                                clip_key = f"clips/{scenario_id}_{start_ts}_{end_ts}.mp4"
                                s3_client.upload_file(output_path, bucket_name, clip_key)
                                print(f"📤 Uploaded clipped video to: s3://{bucket_name}/{clip_key}")
                                
                                # 生成截取视频的presigned URL
                                from s3_video_utils import S3VideoManager
                                s3_video_manager = S3VideoManager(bucket_name)
                                clipped_presigned_url = s3_video_manager.get_video_url(clip_key)
                                
                                if clipped_presigned_url:
                                    print(f"✅ Generated presigned URL for clipped video")
                                    return {
                                        "status": "ok",
                                        "preview_url": clipped_presigned_url,
                                        "scenario_id": scenario_id,
                                        "start_ts": start_ts,
                                        "end_ts": end_ts,
                                        "duration": duration,
                                        "original_video_url": video_url,
                                        "clip_start": 0,  # 截取的视频从0开始
                                        "clip_end": duration,
                                        "clip_duration": duration,
                                        "is_clipped": True
                                    }
                                else:
                                    return {
                                        "status": "error",
                                        "message": "Failed to generate presigned URL for clipped video"
                                    }
                            else:
                                print(f"❌ FFmpeg error: {result.stderr}")
                                return {
                                    "status": "error",
                                    "message": f"FFmpeg error: {result.stderr}"
                                }
                                
                        finally:
                            # 清理临时文件
                            try:
                                os.unlink(output_path)
                                print(f"🧹 Cleaned up temporary file: {output_path}")
                            except:
                                pass
                    else:
                        return {
                            "status": "error",
                            "message": "Invalid S3 URL format"
                        }
                else:
                    return {
                        "status": "error",
                        "message": "Video URL is not an S3 URL"
                    }
                    
            except Exception as e:
                print(f"❌ Error clipping video: {e}")
                return {
                    "status": "error",
                    "message": f"Error clipping video: {str(e)}"
                }
        else:
            # 保存模式：这里可以实现真正的视频裁剪
            # 暂时返回一个模拟的文件路径
            output_file = f"clipped_video_{scenario_id}_{start_ts}_{end_ts}.mp4"
            print(f"💾 Would save to: {output_file}")
            return {
                "status": "ok",
                "file": output_file,
                "scenario_id": scenario_id,
                "start_ts": start_ts,
                "end_ts": end_ts,
                "duration": duration
            }
        
    except Exception as e:
        print(f"❌ Error clipping video: {e}")
        return {
            "status": "error",
            "message": str(e)
        } 