import boto3
import s3fs
import re
from typing import List, Dict, Optional

class S3VideoManager:
    def __init__(self, bucket_name="matt3r-driving-footage-us-west-2"):
        self.bucket = bucket_name
        self.s3 = boto3.client("s3")
        self.fs = s3fs.S3FileSystem()

    def list_org_ids(self) -> List[str]:
        """列出所有org_id"""
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Delimiter="/")
        org_ids = []
        for page in pages:
            for prefix_obj in page.get("CommonPrefixes", []):
                org_id = prefix_obj["Prefix"].rstrip("/")
                org_ids.append(org_id)
        return org_ids

    def list_key_ids_by_org(self, org_id: str) -> List[str]:
        """根据org_id列出所有key_id"""
        prefix = f"{org_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix, Delimiter="/")
        key_ids = []
        for page in pages:
            for prefix_obj in page.get("CommonPrefixes", []):
                key_id = prefix_obj["Prefix"].replace(prefix, "").rstrip("/")
                key_ids.append(key_id)
        return key_ids

    def list_front_videos(self, org_id: str, key_id: str) -> List[Dict[str, str]]:
        """列出指定org_id和key_id下的所有front视频文件"""
        prefix = f"{org_id}/{key_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)
        
        front_videos = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]
                
                # 匹配front视频文件
                match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-front\.mp4", filename)
                if match:
                    timestamp = match.group(1)
                    front_videos.append({
                        "key": key,
                        "filename": filename,
                        "timestamp": timestamp,
                        "size": obj["Size"],
                        "last_modified": obj["LastModified"].isoformat()
                    })
        
        # 按时间戳排序
        front_videos.sort(key=lambda x: x["timestamp"])
        return front_videos

    def get_video_url(self, key: str, expires_in: int = 3600) -> str:
        """获取视频文件的预签名URL"""
        try:
            url = self.s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket, 'Key': key},
                ExpiresIn=expires_in
            )
            return url
        except Exception as e:
            print(f"Error generating presigned URL for {key}: {e}")
            return None

    def get_video_info(self, key: str) -> Optional[Dict]:
        """获取视频文件信息"""
        try:
            response = self.s3.head_object(Bucket=self.bucket, Key=key)
            return {
                "size": response["ContentLength"],
                "last_modified": response["LastModified"].isoformat(),
                "content_type": response.get("ContentType", "video/mp4")
            }
        except Exception as e:
            print(f"Error getting video info for {key}: {e}")
            return None

    def list_all_videos_by_org_key(self, org_id: str, key_id: str) -> Dict[str, List[Dict]]:
        """列出指定org_id和key_id下的所有视频文件，按类型分类"""
        prefix = f"{org_id}/{key_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)
        
        videos = {
            "front": [],
            "left": [],
            "right": [],
            "rear": [],
            "other": []
        }
        
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]
                
                # 匹配不同类型的视频文件
                front_match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-front\.mp4", filename)
                left_match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-left\.mp4", filename)
                right_match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-right\.mp4", filename)
                rear_match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-rear\.mp4", filename)
                
                video_info = {
                    "key": key,
                    "filename": filename,
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat()
                }
                
                if front_match:
                    video_info["timestamp"] = front_match.group(1)
                    videos["front"].append(video_info)
                elif left_match:
                    video_info["timestamp"] = left_match.group(1)
                    videos["left"].append(video_info)
                elif right_match:
                    video_info["timestamp"] = right_match.group(1)
                    videos["right"].append(video_info)
                elif rear_match:
                    video_info["timestamp"] = rear_match.group(1)
                    videos["rear"].append(video_info)
                elif filename.endswith(".mp4"):
                    video_info["timestamp"] = "unknown"
                    videos["other"].append(video_info)
        
        # 按时间戳排序
        for video_type in videos:
            videos[video_type].sort(key=lambda x: x["timestamp"])
        
        return videos 