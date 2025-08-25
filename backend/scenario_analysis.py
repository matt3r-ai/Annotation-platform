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
from fastapi.responses import FileResponse
import zipfile
from fastapi import Response
from io import BytesIO

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
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    days_back: int = 7  # Keep for backward compatibility
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

class AnnotationsData(BaseModel):
    annotations: dict  # {scenario_id: [annotation_objects]}

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
DOWNLOAD_DIR = "/app/data/downloads"
S3_BUCKET = "matt3r-driving-footage-us-west-2"

def ensure_download_dir():
    """确保下载目录存在"""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def get_s3_video_url(scenario_id: int, video_key: str = None) -> str:
    """从S3获取视频的预签名URL"""
    try:
        print(f"Attempting to get S3 URL for scenario {scenario_id}")
        s3_client = boto3.client('s3')
        
        # If video_key is not provided, use default path
        if not video_key:
            video_key = f"scenarios/scenario_{scenario_id}.mp4"
        
        print(f"Using S3 bucket: {S3_BUCKET}")
        print(f"Using video key: {video_key}")
        
        # First check if file exists
        try:
            s3_client.head_object(Bucket=S3_BUCKET, Key=video_key)
            print(f"✅ Video file exists in S3: {video_key}")
        except Exception as e:
            print(f"❌ Video file not found in S3: {video_key}")
            print(f"Error: {e}")
            return None
        
        # Generate presigned URL, valid for 1 hour
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
    """Download video from S3 to local"""
    try:
        ensure_download_dir()
        
        # Create local file path
        local_filename = f"scenario_{scenario_id}.mp4"
        local_path = os.path.join(DOWNLOAD_DIR, local_filename)
        
        # If file already exists, return path directly
        if os.path.exists(local_path):
            return local_path
        
        # Download video from S3
        s3_client = boto3.client('s3')
        s3_client.download_file(S3_BUCKET, video_key, local_path)
        
        print(f"Video downloaded: {local_path}")
        return local_path
        
    except Exception as e:
        print(f"Error downloading video for scenario {scenario_id}: {e}")
        return None

@router.post("/fetch")
async def fetch_scenarios(query: ScenarioQuery):
    """Get scenario data"""
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
        
        # Build SQL query
        # Handle date range
        date_condition = ""
        if query.start_date and query.end_date:
            # Use specified date range
            date_condition = f"AND created_at >= '{query.start_date}' AND created_at <= '{query.end_date} 23:59:59'"
        elif query.start_date:
            # Only start date
            date_condition = f"AND created_at >= '{query.start_date}'"
        elif query.end_date:
            # Only end date
            date_condition = f"AND created_at <= '{query.end_date} 23:59:59'"
        else:
            # Use default days_back (backward compatibility)
            date_condition = f"AND created_at >= NOW() - INTERVAL '{query.days_back} days'"
        
        if not event_conditions:
            # If no event types selected, only check dmp_status = 'SUCCESS'
            sql_query = f"""
            SELECT id, org_id, key_id, vin, created_at, data_links, dmp_status, start_time, end_time, data_source_status, updated_at, osm_tags
            FROM public.dmp
            WHERE dmp_status = 'SUCCESS'
              AND jsonb_path_exists(data_links, '$.trip.console_trip ? (@ != null && @ != "null")')
              {date_condition}
            ORDER BY id DESC
            LIMIT {query.limit};
            """
        else:
            # If event types are selected, use AND condition to ensure scenario contains all selected event types
            event_condition = " AND ".join(event_conditions)
            sql_query = f"""
            SELECT id, org_id, key_id, vin, created_at, data_links, dmp_status, start_time, end_time, data_source_status, updated_at, osm_tags
            FROM public.dmp
            WHERE dmp_status = 'SUCCESS'
              AND jsonb_path_exists(data_links, '$.trip.console_trip ? (@ != null && @ != "null")')
              AND ({event_condition})
              {date_condition}
            ORDER BY id DESC
            LIMIT {query.limit};
            """
        
        print(f"Executing SQL query: {sql_query}")
        cursor.execute(sql_query)
        rows = cursor.fetchall()
        
        scenarios = []
        for row in rows:
            scenario_id, org_id, key_id, vin, created_at, data_links, dmp_status, start_time, end_time, data_source_status, updated_at, osm_tags = row
            
            # Determine event type from data_links
            event_type = "unknown"
            if data_links and isinstance(data_links, dict):
                coreml_events = data_links.get("coreml", {})
                if isinstance(coreml_events, dict):
                    # Handle object format coreml data
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
                    # Compatible with array format
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
                
                # Check if there is a direct video path
                if 'video' in data_links and data_links['video']:
                    video_data = data_links['video']
                    print(f"  Found video data: {video_data}")
                    
                    if isinstance(video_data, dict) and 'front' in video_data:
                        # Directly use front video complete S3 URL
                        front_video_url = video_data['front']
                        print(f"  Front video URL: {front_video_url}")
                        
                        # Extract relative path from complete URL
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
                "org_id": org_id,
                "key_id": key_id,
                "vin": vin,
                "event_type": event_type,
                "timestamp": created_at.isoformat() if created_at else "unknown",
                "status": "pending",
                "dmp_status": dmp_status,
                "data_links": data_links,
                "video_path": video_path,
                "console_trip": data_links.get("trip", {}).get("console_trip") if data_links else None,
                "start_time": start_time,
                "end_time": end_time,
                "data_source_status": data_source_status,
                "created_at": created_at.isoformat() if created_at else "",
                "updated_at": updated_at.isoformat() if updated_at else "",
                "osm_tags": osm_tags
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

@router.post("/imu/extract")
async def extract_imu_data(request: dict):
    """提取IMU数据（gyro和accel）"""
    try:
        scenario_id = request.get('scenario_id')
        if not scenario_id:
            return {"status": "error", "message": "Missing scenario_id"}
        
        conn = get_db_connection()
        if not conn:
            return {"status": "error", "message": "Database connection failed"}
        
        cursor = conn.cursor()
        cursor.execute("SELECT data_links FROM public.dmp WHERE id = %s", (scenario_id,))
        row = cursor.fetchone()
        
        if not row:
            return {"status": "error", "message": "Scenario not found"}
        
        data_links = row[0]
        print(f"📊 Extracting IMU data for scenario {scenario_id}")
        print(f"📊 Data links keys: {list(data_links.keys()) if data_links else 'None'}")
        
        imu_data = {"gyro": [], "accel": []}
        
        if data_links and isinstance(data_links, dict):
            # 提取IMU数据
            if 'imu' in data_links and data_links['imu']:
                imu_links = data_links['imu']
                print(f"📊 IMU links: {imu_links}")
                
                # 处理gyro数据
                if 'gyro' in imu_links and imu_links['gyro']:
                    try:
                        gyro_url = imu_links['gyro']
                        print(f"📊 Loading gyro data from: {gyro_url}")
                        
                        # 这里需要根据实际的IMU数据格式来解析
                        # 假设是parquet格式，包含timestamp, x, y, z列
                        # 实际实现需要根据您的数据格式调整
                        gyro_data = load_imu_data_from_s3(gyro_url)
                        imu_data["gyro"] = gyro_data
                        print(f"✅ Loaded {len(gyro_data)} gyro data points")
                    except Exception as e:
                        print(f"❌ Error loading gyro data: {e}")
                
                # 处理accel数据
                if 'accel' in imu_links and imu_links['accel']:
                    try:
                        accel_url = imu_links['accel']
                        print(f"📊 Loading accel data from: {accel_url}")
                        
                        accel_data = load_imu_data_from_s3(accel_url)
                        imu_data["accel"] = accel_data
                        print(f"✅ Loaded {len(accel_data)} accel data points")
                    except Exception as e:
                        print(f"❌ Error loading accel data: {e}")
        
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "imu_data": imu_data,
            "scenario_id": scenario_id
        }
        
    except Exception as e:
        print(f"❌ Error extracting IMU data: {e}")
        return {"status": "error", "message": str(e)}

def load_imu_data_from_s3(s3_url):
    """从S3加载IMU数据"""
    try:
        # 解析S3 URL
        if s3_url.startswith('s3://'):
            parts = s3_url.split('/')
            bucket = parts[2]
            key = '/'.join(parts[3:])
        else:
            return []
        
        print(f"📊 Loading IMU data from S3: bucket={bucket}, key={key}")
        
        # 使用boto3从S3读取parquet文件
        import boto3
        import pandas as pd
        from io import BytesIO
        
        s3_client = boto3.client('s3')
        response = s3_client.get_object(Bucket=bucket, Key=key)
        
        # 读取parquet数据
        df = pd.read_parquet(BytesIO(response['Body'].read()))
        
        print(f"📊 IMU data shape: {df.shape}")
        print(f"📊 IMU data columns: {list(df.columns)}")
        print(f"📊 First few rows:")
        print(df.head())
        
        # 查找可能的列名
        timestamp_col = None
        x_col = None
        y_col = None
        z_col = None
        
        # 查找时间戳列
        for col in df.columns:
            col_lower = col.lower()
            if any(keyword in col_lower for keyword in ['timestamp', 'time', 'ts']):
                timestamp_col = col
                break
        
        # 查找x, y, z列 - 支持多种命名格式
        for col in df.columns:
            col_lower = col.lower()
            # 标准格式
            if col_lower in ['x', 'gyro_x', 'accel_x']:
                x_col = col
            elif col_lower in ['y', 'gyro_y', 'accel_y']:
                y_col = col
            elif col_lower in ['z', 'gyro_z', 'accel_z']:
                z_col = col
            # 车辆坐标系格式 (lr=left-right, bf=back-front, vert=vertical)
            elif col_lower in ['lr_w', 'lr_acc', 'lr']:
                x_col = col
            elif col_lower in ['bf_w', 'bf_acc', 'bf']:
                y_col = col
            elif col_lower in ['vert_w', 'vert_acc', 'vert']:
                z_col = col
        
        print(f"📊 Found columns: timestamp={timestamp_col}, x={x_col}, y={y_col}, z={z_col}")
        
        # 转换为前端需要的格式
        data_points = []
        for _, row in df.iterrows():
            data_point = {
                "timestamp": float(row.get(timestamp_col, 0)) if timestamp_col else 0,
                "x": float(row.get(x_col, 0)) if x_col else 0,
                "y": float(row.get(y_col, 0)) if y_col else 0,
                "z": float(row.get(z_col, 0)) if z_col else 0
            }
            data_points.append(data_point)
        
        print(f"📊 Converted {len(data_points)} data points")
        if data_points:
            print(f"📊 Sample data point: {data_points[0]}")
        
        return data_points
        
    except Exception as e:
        print(f"❌ Error loading IMU data from S3: {e}")
        import traceback
        traceback.print_exc()
        return []



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

@router.post("/annotations/write-back")
async def write_annotations_to_db(annotations_data: AnnotationsData):
    """将标注数据写回到dmp table"""
    try:
        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="Database connection failed")
        
        cursor = conn.cursor()
        
        # 首先检查annotations列是否存在，如果不存在则添加
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'dmp' AND column_name = 'annotations'
        """)
        
        if not cursor.fetchone():
            print("Adding annotations column to dmp table...")
            cursor.execute("""
                ALTER TABLE dmp 
                ADD COLUMN annotations JSONB
            """)
            conn.commit()
            print("✅ Annotations column added successfully")
        
        # 更新每个scenario的annotations
        updated_count = 0
        for scenario_id, annotations_list in annotations_data.annotations.items():
            if annotations_list:  # 只更新有标注的scenario
                annotations_json = json.dumps(annotations_list)
                
                cursor.execute("""
                    UPDATE dmp 
                    SET annotations = %s 
                    WHERE id = %s
                """, (annotations_json, int(scenario_id)))
                
                if cursor.rowcount > 0:
                    updated_count += 1
                    print(f"✅ Updated scenario {scenario_id} with {len(annotations_list)} annotations")
                else:
                    print(f"⚠️  Scenario {scenario_id} not found in dmp table")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Successfully updated {updated_count} scenarios with annotations",
            "updated_count": updated_count
        }
        
    except Exception as e:
        print(f"❌ Error writing annotations to database: {e}")
        if 'conn' in locals() and conn:
            conn.rollback()
            conn.close()
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

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

class CropDataRequest(BaseModel):
    scenario_id: int
    start_time: float
    end_time: float
    data_links: dict
    # Optional: absolute start time of the scenario/video timeline (epoch seconds)
    scenario_start_time: Optional[float] = None

# --- Multi-segment cropping support ---
from typing import List

class SegmentTimeRange(BaseModel):
    start_time: float
    end_time: float

class CropSegmentsRequest(BaseModel):
    scenario_id: int
    segments: List[SegmentTimeRange]
    data_links: dict
    # Optional: absolute start time of the scenario/video timeline (epoch seconds)
    scenario_start_time: Optional[float] = None


# === VLM/Gemini description generation ===
class AutoDescribeRequest(BaseModel):
    scenario_id: int
    start_time: float
    end_time: float
    # Optional context text to improve generation
    context: Optional[str] = None

class AutoDescribeResponse(BaseModel):
    text: str

def _generate_description_with_gemini(prompt: str) -> str:
    """Call Gemini (or other VLM) to generate a description text.
    This uses google-generativeai as an example. Requires env var GOOGLE_API_KEY.
    """
    try:
        import os
        import google.generativeai as genai
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            # Fallback dummy text when key is not set
            return "Automatic summary: " + prompt[:120]
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        res = model.generate_content(prompt)
        return (res.text or "").strip() if res else ""
    except Exception as e:
        return f"Automatic summary unavailable: {e}"

@router.post("/auto-describe", response_model=AutoDescribeResponse)
async def auto_describe(req: AutoDescribeRequest) -> AutoDescribeResponse:
    """Generate a short description for a selected time range.

    The current implementation does not extract video frames; it composes a
    concise prompt using the time range, scenario id and optional context, and
    calls Gemini for text-only generation. You can later extend this to send
    video frames or keyframes to a VLM for richer results.
    """
    try:
        duration = max(0.0, req.end_time - req.start_time)
        base_prompt = (
            "You are describing a short driving video segment for annotation.\n"
            "Follow these strict rules:\n"
            "- Use ONLY the provided times and context; do not invent details.\n"
            "- If context lists events, mention them; if events=[none], explicitly state no significant events.\n"
            "- Avoid generic phrases like 'smoothly navigates a curve' unless context indicates a turn.\n"
            "- If label or context suggests 'stop/stopped/parking/idle', prefer stationary phrasing.\n"
            "- Keep it to 1–2 short sentences.\n"
            f"Scenario ID: {req.scenario_id}.\n"
            f"Segment start: {req.start_time:.2f}s, end: {req.end_time:.2f}s, duration: {duration:.2f}s.\n"
        )
        # Optional: enrich with telemetry (avg speed) by reading console_trip around the window
        telemetry_context = ""
        try:
            conn = get_db_connection()
            if conn:
                cur = conn.cursor()
                cur.execute("SELECT data_links, start_time FROM public.dmp WHERE id = %s", (req.scenario_id,))
                row = cur.fetchone()
                cur.close()
                conn.close()
                if row:
                    data_links, scenario_start = row
                    console_trip_url = None
                    if isinstance(data_links, dict):
                        console_trip_url = data_links.get("trip", {}).get("console_trip")
                    if console_trip_url and scenario_start is not None:
                        # Compute absolute timestamps for the selection window
                        abs_start = float(scenario_start) + float(req.start_time)
                        abs_end = float(scenario_start) + float(req.end_time)
                        # Load parquet and compute average speed in window
                        import s3fs
                        import pandas as pd
                        fs = s3fs.S3FileSystem()
                        df = pd.read_parquet(console_trip_url, filesystem=fs)
                        ts_col = None
                        for col in df.columns:
                            if str(col).lower() in ("timestamp",) or any(k in str(col).lower() for k in ["timestamp", "time", "ts"]):
                                ts_col = col
                                break
                        if ts_col is not None:
                            # ensure numeric
                            if df[ts_col].dtype == object:
                                df[ts_col] = pd.to_numeric(df[ts_col], errors='coerce')
                            window = df[(df[ts_col] >= abs_start) & (df[ts_col] <= abs_end)].copy()
                            speed_col = None
                            for col in window.columns:
                                if "speed" in str(col).lower():
                                    speed_col = col
                                    break
                            if speed_col is not None and len(window) > 0:
                                try:
                                    avg_speed = float(window[speed_col].astype(float).mean())
                                    telemetry_context = f"telemetry: avg_speed={avg_speed:.2f} (units as stored), samples={len(window)}"
                                except Exception:
                                    pass
        except Exception:
            # Non-fatal; continue without telemetry
            pass

        if req.context or telemetry_context:
            merged_context = "; ".join([c for c in [req.context or "", telemetry_context] if c])
            base_prompt += f"Context: {merged_context}\n"
        base_prompt += ("Now output the description only, without prefixes.")

        text = _generate_description_with_gemini(base_prompt)
        if not text:
            text = "Automatic summary could not be generated."
        return AutoDescribeResponse(text=text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"auto-describe failed: {e}")

# === Save segment as NPZ ===
class SaveNpzRequest(BaseModel):
    scenario_id: int
    start_time: float
    end_time: float
    label: Optional[str] = None
    description: Optional[str] = None
    data_links: dict

@router.post("/save-npz")
async def save_segment_as_npz(req: SaveNpzRequest):
    """Create a NumPy .npz file with our schema.

    Arrays in the archive:
    - maneuver_type: 0-D unicode string (e.g., "right-lane-change")
    - start: 0-D float64 (epoch seconds, segment start)
    - end: 0-D float64 (epoch seconds, segment end)
    - imu_data: 0-D object → a dict of plain Python lists
    - gps_data: 0-D object → a dict of plain Python lists
    - metadata: 0-D object → a dict with strings/URIs (also包含字符串格式 start/end)
    """
    try:
        # 1) Fetch basic identifiers (org_id, key_id, vin)
        conn = get_db_connection()
        org_id = None
        key_id = None
        vin = None
        if conn:
            cur = conn.cursor()
            cur.execute("SELECT org_id, key_id, vin FROM public.dmp WHERE id = %s", (req.scenario_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if row:
                org_id, key_id, vin = row

        # 2) Resolve URIs from data_links
        imu_accel_uri = None
        imu_gyro_uri = None
        gps_uri = None
        video_uri_list = []
        if isinstance(req.data_links, dict):
            imu_links = req.data_links.get("imu") or {}
            if isinstance(imu_links, dict):
                imu_accel_uri = imu_links.get("accel")
                imu_gyro_uri = imu_links.get("gyro")
            trip_links = req.data_links.get("trip") or {}
            if isinstance(trip_links, dict):
                gps_uri = trip_links.get("console_trip") or trip_links.get("fleet_trip")
            video_links = req.data_links.get("video") or {}
            if isinstance(video_links, dict):
                for _, v in video_links.items():
                    if v:
                        video_uri_list.append(v)

        # 3) Format start/end as strings and compute maneuver_time (midpoint)
        try:
            start_fmt = pd.to_datetime(req.start_time, unit='s', utc=True).tz_convert('UTC').strftime('%Y-%m-%d_%H-%M-%S')
        except Exception:
            start_fmt = str(req.start_time)
        try:
            end_fmt = pd.to_datetime(req.end_time, unit='s', utc=True).tz_convert('UTC').strftime('%Y-%m-%d_%H-%M-%S')
        except Exception:
            end_fmt = str(req.end_time)
        start_epoch = float(req.start_time)
        end_epoch = float(req.end_time)
        maneuver_type = (req.label or 'maneuver').strip().replace(' ', '-').lower()

        # 4) Collect IMU arrays (best-effort; empty if unavailable)
        import numpy as np
        def to_array(lst, key, dtype=float):
            try:
                return np.array([float(p.get(key, 0)) for p in lst], dtype=dtype)
            except Exception:
                return np.array([], dtype=dtype)

        lr_acc = np.array([]); bf_acc = np.array([]); vert_acc = np.array([])
        lr_w = np.array([]); bf_w = np.array([]); vert_w = np.array([])
        imu_ts = np.array([])
        try:
            if imu_accel_uri:
                accel_points = load_imu_data_from_s3(imu_accel_uri)  # list of {timestamp,x,y,z}
                # Crop by selected time window
                accel_points = [p for p in accel_points if start_epoch <= float(p.get('timestamp', 0)) <= end_epoch]
                if accel_points:
                    imu_ts = to_array(accel_points, 'timestamp')
                    lr_acc = to_array(accel_points, 'x')
                    bf_acc = to_array(accel_points, 'y')
                    vert_acc = to_array(accel_points, 'z')
        except Exception:
            pass
        try:
            if imu_gyro_uri:
                gyro_points = load_imu_data_from_s3(imu_gyro_uri)
                # Crop by selected time window
                gyro_points = [p for p in gyro_points if start_epoch <= float(p.get('timestamp', 0)) <= end_epoch]
                if gyro_points and imu_ts.size == 0:
                    imu_ts = to_array(gyro_points, 'timestamp')
                if gyro_points:
                    lr_w = to_array(gyro_points, 'x')
                    bf_w = to_array(gyro_points, 'y')
                    vert_w = to_array(gyro_points, 'z')
        except Exception:
            pass

        # Align lengths rudimentarily to the smallest non-zero length
        lengths = [arr.size for arr in [imu_ts, lr_acc, bf_acc, vert_acc, lr_w, bf_w, vert_w] if arr.size > 0]
        if lengths:
            n = min(lengths)
            def trim(a):
                return a[:n] if a.size >= n and n > 0 else a
            imu_ts, lr_acc, bf_acc, vert_acc, lr_w, bf_w, vert_w = [trim(a) for a in [imu_ts, lr_acc, bf_acc, vert_acc, lr_w, bf_w, vert_w]]

        # Convert to plain Python lists to avoid pickling NumPy internals
        imu_obj = {
            'timestamp': imu_ts.tolist(),
            'lr_acc': lr_acc.tolist(), 'bf_acc': bf_acc.tolist(), 'vert_acc': vert_acc.tolist(),
            'lr_w': lr_w.tolist(), 'bf_w': bf_w.tolist(), 'vert_w': vert_w.tolist(),
        }

        # 5) Collect GPS arrays (best-effort)
        gps_obj = { 'timestamp': [],
                    'latitude': [],
                    'longitude': [],
                    'speed': [],
                    'course': [] }
        try:
            if gps_uri and gps_uri.startswith('s3://'):
                # Use S3ParquetManager for convenience
                from s3_utils import S3ParquetManager
                parts = gps_uri.replace('s3://','').split('/',1)
                if len(parts) == 2:
                    bucket, key = parts
                    s3mgr = S3ParquetManager(bucket)
                    df = s3mgr.load_parquet(key)
                    # Identify columns
                    ts_col = None; lat_col=None; lon_col=None; spd_col=None; crs_col=None
                    for c in df.columns:
                        lc = str(c).lower()
                        if ts_col is None and any(k in lc for k in ['timestamp','time','ts']): ts_col=c
                        if lat_col is None and 'lat' in lc: lat_col=c
                        if lon_col is None and ('lon' in lc or 'lng' in lc): lon_col=c
                        if spd_col is None and 'speed' in lc: spd_col=c
                        if crs_col is None and ('course' in lc or 'heading' in lc or 'yaw' in lc): crs_col=c
                    if ts_col is not None:
                        # Crop by selected time window
                        ts_series = pd.to_numeric(df[ts_col], errors='coerce').astype(float)
                        window = df[(ts_series >= start_epoch) & (ts_series <= end_epoch)].copy()
                        ts_vals = ts_series[(ts_series >= start_epoch) & (ts_series <= end_epoch)].tolist()
                        gps_obj['timestamp'] = ts_vals
                    else:
                        window = df
                    if lat_col is not None:
                        gps_obj['latitude'] = window[lat_col].astype(str).tolist()
                    if lon_col is not None:
                        gps_obj['longitude'] = window[lon_col].astype(str).tolist()
                    if spd_col is not None:
                        gps_obj['speed'] = pd.to_numeric(window[spd_col], errors='coerce').astype(float).tolist()
                    if crs_col is not None:
                        gps_obj['course'] = pd.to_numeric(window[crs_col], errors='coerce').astype(float).tolist()
        except Exception:
            pass

        # 6) Compose metadata dictionary
        metadata = {
            'imu_org_id': org_id or '',
            'imu_k3y_id': key_id or '',
            'tesla_org_id': org_id or '',
            'tesla_vehicle_id': vin,
            'gps_source': 'console_trip' if gps_uri else '',
            'start': start_fmt,
            'end': end_fmt,
            'imu_accel_uri': imu_accel_uri or '',
            'imu_gyro_uri': imu_gyro_uri or '',
            'gps_uri': gps_uri or '',
            'video_uri': list(video_uri_list),
            'notes': (req.description or ''),
            'location': '',
        }

        # 7) Build NPZ payload in the requested structure
        import numpy as np
        def box0(obj):
            arr = np.empty((), dtype=object)
            arr[()] = obj
            return arr
        payload = {
            'maneuver_type': np.array(maneuver_type),
            'maneuver_time': box0({'start': float(start_epoch), 'end': float(end_epoch)}),
            'imu_data': box0(imu_obj),
            'gps_data': box0(gps_obj),
            'metadata': box0(metadata),
        }

        # 8) Save to buffer and return
        buffer = BytesIO()
        np.savez_compressed(buffer, **payload)
        buffer.seek(0)

        filename = f"segment_{req.scenario_id}_{start_fmt}_{end_fmt}.npz"
        headers = { 'Content-Disposition': f'attachment; filename="{filename}"' }
        return Response(content=buffer.read(), media_type='application/octet-stream', headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"save-npz failed: {e}")

@router.post("/crop-data")
async def crop_data_by_time_range(request: CropDataRequest):
    """
    Crop video, GPS, and IMU data based on time range and package as zip file
    """
    try:
        print(f"🎬 Starting data cropping for scenario {request.scenario_id}")
        print(f"⏰ Time range: {request.start_time} - {request.end_time}")
        print(f"📁 Data links received: {request.data_links}")
        print(f"🔍 Data links keys: {list(request.data_links.keys()) if request.data_links else 'None'}")
        
        # Debug: Print detailed data structure
        if request.data_links:
            for key, value in request.data_links.items():
                print(f"🔍 Key: {key}, Value: {value}")
                if isinstance(value, dict):
                    for subkey, subvalue in value.items():
                        print(f"  🔍 SubKey: {subkey}, SubValue: {subvalue}")
        
        # Create temporary directory for processing
        import tempfile
        import zipfile
        import shutil
        from pathlib import Path
        
        temp_dir = tempfile.mkdtemp()
        crop_dir = Path(temp_dir) / f"cropped_data_{request.scenario_id}"
        crop_dir.mkdir(exist_ok=True)
        
        results = {
            "scenario_id": request.scenario_id,
            "start_time": request.start_time,
            "end_time": request.end_time,
            "files": [],
            "zip_path": None,
            "success": True
        }
        
        try:
            # 1. Crop video files
            if 'video' in request.data_links:
                print("🎬 Processing video files...")
                print(f"📹 Video links: {request.data_links['video']}")
                video_results = await crop_video_files(
                    request.data_links['video'], 
                    request.start_time, 
                    request.end_time, 
                    crop_dir,
                    request.scenario_start_time
                )
                print(f"🎬 Video results: {video_results}")
                results["files"].extend(video_results)
            else:
                print("⚠️ No video links found in data_links")
            
            # 2. Crop GPS data
            if 'trip' in request.data_links and request.data_links['trip'].get('console_trip'):
                print("📍 Processing GPS data...")
                print(f"📍 GPS console_trip: {request.data_links['trip']['console_trip']}")
                gps_result = await crop_gps_data(
                    request.data_links['trip']['console_trip'],
                    request.start_time,
                    request.end_time,
                    crop_dir
                )
                print(f"📍 GPS result: {gps_result}")
                if gps_result:
                    results["files"].append(gps_result)
            else:
                print("⚠️ No GPS console_trip found in data_links")
            
            # 3. Crop IMU data
            if 'imu' in request.data_links:
                print("📊 Processing IMU data...")
                print(f"📊 IMU links: {request.data_links['imu']}")
                imu_results = await crop_imu_data(
                    request.data_links['imu'],
                    request.start_time,
                    request.end_time,
                    crop_dir
                )
                print(f"📊 IMU results: {imu_results}")
                results["files"].extend(imu_results)
            else:
                print("⚠️ No IMU links found in data_links")
            
            # 4. Create zip file
            print("📦 Creating zip file...")
            print(f"📁 Files to add to zip: {results['files']}")
            print(f"📊 Total files count: {len(results['files'])}")
            
            # Debug: Check each file before adding to zip
            for i, file_info in enumerate(results["files"]):
                print(f"🔍 File {i+1}: {file_info}")
                if file_info.get("local_path"):
                    file_path = Path(file_info["local_path"])
                    print(f"  📁 Local path: {file_path}")
                    print(f"  📁 File exists: {file_path.exists()}")
                    if file_path.exists():
                        print(f"  📁 File size: {file_path.stat().st_size} bytes")
                    else:
                        print(f"  ❌ File does not exist!")
                else:
                    print(f"  ❌ No local_path in file_info")
            
            zip_path = crop_dir.parent / f"cropped_data_{request.scenario_id}_{int(request.start_time)}_{int(request.end_time)}.zip"
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for file_info in results["files"]:
                    print(f"🔍 Processing file_info: {file_info}")
                    if file_info.get("local_path") and Path(file_info["local_path"]).exists():
                        arcname = Path(file_info["local_path"]).name
                        zipf.write(file_info["local_path"], arcname)
                        print(f"📁 Added to zip: {arcname}")
                    else:
                        print(f"⚠️ File not found or no local_path: {file_info}")
            
            print(f"📦 Zip file created with {len(results['files'])} files")
            print(f"📦 Zip file size: {zip_path.stat().st_size} bytes")
            results["zip_path"] = str(zip_path)
            print(f"✅ Zip file created: {zip_path}")
            
            # Store the zip file info for download
            zip_filename = zip_path.name
            zip_temp_dir = zip_path.parent.name
            
            # Return results with file info for download
            results["zip_filename"] = zip_filename
            results["zip_temp_dir"] = zip_temp_dir
            
            return results
            
        except Exception as e:
            print(f"❌ Error during cropping: {e}")
            results["success"] = False
            results["error"] = str(e)
            return results
            
        finally:
            # Clean up temporary files (keep zip file for download)
            try:
                if crop_dir.exists():
                    shutil.rmtree(crop_dir)
                print("🧹 Cleaned up temporary files")
            except Exception as e:
                print(f"⚠️ Warning: Could not clean up temp files: {e}")
                
    except Exception as e:
        print(f"❌ Error in crop_data_by_time_range: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to crop data: {str(e)}")

@router.post("/crop-data-multi")
async def crop_data_by_time_ranges(request: CropSegmentsRequest):
    """
    Crop multiple time ranges. For each segment, create a separate folder containing
    the cropped video/GPS/IMU files, then package all segment folders into a single zip.
    """
    try:
        import tempfile
        import zipfile
        import shutil
        from pathlib import Path

        if not request.segments or len(request.segments) == 0:
            raise HTTPException(status_code=400, detail="segments is required and must be non-empty")

        temp_dir = tempfile.mkdtemp()
        base_dir = Path(temp_dir) / f"cropped_data_{request.scenario_id}"
        base_dir.mkdir(exist_ok=True)

        overall_results = {
            "scenario_id": request.scenario_id,
            "segments": [
                {"start_time": seg.start_time, "end_time": seg.end_time} for seg in request.segments
            ],
            "segment_results": [],
            "zip_path": None,
            "success": True,
        }

        # Process each segment into its own subdirectory
        for idx, seg in enumerate(request.segments):
            segment_dir = base_dir / f"segment_{idx + 1}_{int(seg.start_time)}_{int(seg.end_time)}"
            segment_dir.mkdir(exist_ok=True)

            segment_result = {
                "index": idx + 1,
                "start_time": seg.start_time,
                "end_time": seg.end_time,
                "files": [],
                "success": True,
            }

            try:
                # 1) Videos
                if 'video' in request.data_links:
                    video_results = await crop_video_files(
                        request.data_links['video'],
                        seg.start_time,
                        seg.end_time,
                        segment_dir,
                        request.scenario_start_time
                    )
                    segment_result["files"].extend(video_results)

                # 2) GPS
                if 'trip' in request.data_links and request.data_links['trip'].get('console_trip'):
                    gps_result = await crop_gps_data(
                        request.data_links['trip']['console_trip'],
                        seg.start_time,
                        seg.end_time,
                        segment_dir
                    )
                    if gps_result:
                        segment_result["files"].append(gps_result)

                # 3) IMU
                if 'imu' in request.data_links:
                    imu_results = await crop_imu_data(
                        request.data_links['imu'],
                        seg.start_time,
                        seg.end_time,
                        segment_dir
                    )
                    segment_result["files"].extend(imu_results)

            except Exception as e:
                segment_result["success"] = False
                segment_result["error"] = str(e)

            overall_results["segment_results"].append(segment_result)

        # Create a single zip that keeps folder structure
        zip_path = base_dir.parent / (
            f"cropped_data_{request.scenario_id}_{len(request.segments)}segments.zip"
        )
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for seg in overall_results["segment_results"]:
                for file_info in seg.get("files", []):
                    try:
                        local_path = file_info.get("local_path")
                        if not local_path:
                            continue
                        lp = Path(local_path)
                        if not lp.exists():
                            continue
                        # Put files under their segment folder name
                        segment_folder = f"segment_{seg['index']}_{int(seg['start_time'])}_{int(seg['end_time'])}"
                        arcname = f"{segment_folder}/{lp.name}"
                        zipf.write(str(lp), arcname)
                    except Exception:
                        # Skip problematic files silently in zip phase
                        pass

        overall_results["zip_path"] = str(zip_path)
        overall_results["zip_filename"] = zip_path.name
        overall_results["zip_temp_dir"] = zip_path.parent.name

        # Cleanup segment directories but keep the zip for download
        try:
            if base_dir.exists():
                shutil.rmtree(base_dir)
        except Exception:
            pass

        return overall_results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to crop data (multi): {str(e)}")

async def crop_video_files(video_links: dict, start_time: float, end_time: float, output_dir: Path, scenario_start_time: Optional[float] = None):
    """Crop video files based on time range.
    If scenario_start_time is provided, treat start_time/end_time as absolute (e.g., GPS epoch seconds)
    and compute relative offsets against the actual video start extracted from filename when possible.
    Otherwise assume start_time/end_time are already relative to the beginning of the video.
    """
    results = []
    
    for video_type, s3_url in video_links.items():
        if not s3_url:
            continue
            
        try:
            print(f"🎬 Cropping {video_type} video...")
            
            # Extract bucket and key from S3 URL
            if s3_url.startswith('s3://'):
                parts = s3_url.replace('s3://', '').split('/', 1)
                bucket = parts[0]
                key = parts[1]
            else:
                continue
            
            # Download video to temp location
            import boto3
            s3_client = boto3.client('s3')
            
            temp_video = output_dir / f"temp_{video_type}.mp4"
            s3_client.download_file(bucket, key, str(temp_video))
            
            # Get video duration first
            import subprocess
            duration_cmd = [
                'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                '-of', 'csv=p=0', str(temp_video)
            ]
            
            duration_result = subprocess.run(duration_cmd, capture_output=True, text=True)
            if duration_result.returncode != 0:
                print(f"❌ Failed to get video duration for {video_type}: {duration_result.stderr}")
                continue
                
            video_duration = float(duration_result.stdout.strip())
            print(f"📹 {video_type} video duration: {video_duration} seconds")
            
            # Compute relative start and duration
            if scenario_start_time is not None:
                # start_time/end_time given in absolute seconds; align to video start by filename timestamp if available
                from datetime import datetime
                import re
                filename = key.split('/')[-1]
                match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater)\.mp4$", filename)
                if match:
                    try:
                        video_start_dt = pd.to_datetime(match.group(1), format="%Y-%m-%d_%H-%M-%S", utc=True)
                        scenario_start_dt = pd.to_datetime(scenario_start_time, unit='s', utc=True)
                        # relative offset between segment start and video start
                        segment_start_dt = pd.to_datetime(start_time, unit='s', utc=True)
                        relative_start = max(0.0, (segment_start_dt - video_start_dt).total_seconds())
                    except Exception:
                        relative_start = max(0.0, start_time)
                else:
                    # Fallback: assume start_time already relative
                    relative_start = max(0.0, start_time)
                crop_duration = max(0.0, min(end_time - start_time, video_duration - relative_start))
            else:
                # Assume provided times are relative already
                relative_start = max(0.0, start_time)
                crop_duration = max(0.0, min(end_time - start_time, video_duration - relative_start))
            
            print(f"🎬 Cropping {video_type} from {relative_start}s to {relative_start + crop_duration}s")
            
            # Crop video using ffmpeg
            output_video = output_dir / f"{video_type}_cropped.mp4"
            
            cmd = [
                'ffmpeg', '-ss', str(relative_start), '-i', str(temp_video),
                '-t', str(crop_duration),
                '-c', 'copy',
                '-y',
                str(output_video)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                # Remove temp file
                temp_video.unlink()
                
                results.append({
                    "type": "video",
                    "video_type": video_type,
                    "original_s3_url": s3_url,
                    "local_path": str(output_video),
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration": crop_duration,
                    "success": True
                })
                print(f"✅ {video_type} video cropped successfully")
            else:
                print(f"❌ Failed to crop {video_type} video: {result.stderr}")
                results.append({
                    "type": "video",
                    "video_type": video_type,
                    "original_s3_url": s3_url,
                    "error": result.stderr,
                    "success": False
                })
                
        except Exception as e:
            print(f"❌ Error cropping {video_type} video: {e}")
            results.append({
                "type": "video",
                "video_type": video_type,
                "original_s3_url": s3_url,
                "error": str(e),
                "success": False
            })
    
    return results

async def crop_gps_data(gps_s3_url: str, start_time: float, end_time: float, output_dir: Path):
    """Crop GPS data based on time range"""
    try:
        print(f"📍 Cropping GPS data from {gps_s3_url}")
        
        # Extract bucket and key from S3 URL
        if gps_s3_url.startswith('s3://'):
            parts = gps_s3_url.replace('s3://', '').split('/', 1)
            bucket = parts[0]
            key = parts[1]
        else:
            return None
        
        # Load GPS data from S3
        import boto3
        import pandas as pd
        import s3fs
        
        fs = s3fs.S3FileSystem()
        df = pd.read_parquet(f"s3://{bucket}/{key}", filesystem=fs)
        
        # Filter data by timestamp range
        if 'timestamp' in df.columns:
            # Convert timestamp to numeric if needed
            if df['timestamp'].dtype == 'object':
                df['timestamp'] = pd.to_numeric(df['timestamp'], errors='coerce')
            
            # Filter by time range
            mask = (df['timestamp'] >= start_time) & (df['timestamp'] <= end_time)
            cropped_df = df[mask].copy()
            
            # Save cropped data
            output_file = output_dir / "gps_cropped.parquet"
            cropped_df.to_parquet(output_file, index=False)
            
            print(f"✅ GPS data cropped: {len(cropped_df)} points")
            
            return {
                "type": "gps",
                "original_s3_url": gps_s3_url,
                "local_path": str(output_file),
                "start_time": start_time,
                "end_time": end_time,
                "points_count": len(cropped_df),
                "success": True
            }
        else:
            print(f"⚠️ No timestamp column found in GPS data")
            return None
            
    except Exception as e:
        print(f"❌ Error cropping GPS data: {e}")
        return None

async def crop_imu_data(imu_links: dict, start_time: float, end_time: float, output_dir: Path):
    """Crop IMU data based on time range"""
    results = []
    
    for imu_type, s3_url in imu_links.items():
        if not s3_url:
            continue
            
        try:
            print(f"📊 Cropping {imu_type} IMU data...")
            
            # Extract bucket and key from S3 URL
            if s3_url.startswith('s3://'):
                parts = s3_url.replace('s3://', '').split('/', 1)
                bucket = parts[0]
                key = parts[1]
            else:
                continue
            
            # Load IMU data from S3
            import boto3
            import pandas as pd
            import s3fs
            
            fs = s3fs.S3FileSystem()
            df = pd.read_parquet(f"s3://{bucket}/{key}", filesystem=fs)
            
            # Filter data by timestamp range
            if 'timestamp' in df.columns:
                # Convert timestamp to numeric if needed
                if df['timestamp'].dtype == 'object':
                    df['timestamp'] = pd.to_numeric(df['timestamp'], errors='coerce')
                
                # Filter by time range
                mask = (df['timestamp'] >= start_time) & (df['timestamp'] <= end_time)
                cropped_df = df[mask].copy()
                
                # Save cropped data
                output_file = output_dir / f"imu_{imu_type}_cropped.parquet"
                cropped_df.to_parquet(output_file, index=False)
                
                print(f"✅ {imu_type} IMU data cropped: {len(cropped_df)} points")
                
                results.append({
                    "type": "imu",
                    "imu_type": imu_type,
                    "original_s3_url": s3_url,
                    "local_path": str(output_file),
                    "start_time": start_time,
                    "end_time": end_time,
                    "points_count": len(cropped_df),
                    "success": True
                })
            else:
                print(f"⚠️ No timestamp column found in {imu_type} IMU data")
                results.append({
                    "type": "imu",
                    "imu_type": imu_type,
                    "original_s3_url": s3_url,
                    "error": "No timestamp column found",
                    "success": False
                })
                
        except Exception as e:
            print(f"❌ Error cropping {imu_type} IMU data: {e}")
            results.append({
                "type": "imu",
                "imu_type": imu_type,
                "original_s3_url": s3_url,
                "error": str(e),
                "success": False
            })
    
    return results 

@router.get("/download-cropped-data/{zip_filename}")
async def download_cropped_data(zip_filename: str):
    """
    Download the cropped data zip file
    """
    try:
        import tempfile
        from pathlib import Path
        from fastapi.responses import FileResponse
        
        print(f"🔍 Looking for zip file: {zip_filename}")
        
        # Look for the zip file in temp directories
        temp_dir = Path(tempfile.gettempdir())
        print(f"📁 Searching in temp directory: {temp_dir}")
        
        zip_path = None
        
        # Search for the zip file in all temp subdirectories
        for temp_subdir in temp_dir.iterdir():
            if temp_subdir.is_dir():
                print(f"🔍 Checking directory: {temp_subdir.name}")
                potential_zip = temp_subdir / zip_filename
                if potential_zip.exists():
                    zip_path = potential_zip
                    print(f"✅ Found zip file: {zip_path}")
                    break
                else:
                    print(f"❌ File not found: {potential_zip}")
        
        if not zip_path or not zip_path.exists():
            print(f"❌ Zip file not found after searching all temp directories")
            print(f"📁 Searched directories: {[d.name for d in temp_dir.iterdir() if d.is_dir()]}")
            raise HTTPException(status_code=404, detail=f"Zip file '{zip_filename}' not found")
        
        print(f"📥 Serving zip file: {zip_path}")
        
        # Return the file for download
        return FileResponse(
            path=str(zip_path),
            filename=zip_filename,
            media_type='application/zip'
        )
        
    except Exception as e:
        print(f"❌ Error downloading zip file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")