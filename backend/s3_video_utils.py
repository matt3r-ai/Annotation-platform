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
        """List all org_ids"""
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Delimiter="/")
        org_ids = []
        for page in pages:
            for prefix_obj in page.get("CommonPrefixes", []):
                org_id = prefix_obj["Prefix"].rstrip("/")
                org_ids.append(org_id)
        return org_ids

    def list_key_ids_by_org(self, org_id: str) -> List[str]:
        """List all key_ids by org_id"""
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
        """List all front video files under specified org_id and key_id"""
        prefix = f"{org_id}/{key_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)
        
        front_videos = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]
                
                # Match front video files
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
        
        # Sort by timestamp
        front_videos.sort(key=lambda x: x["timestamp"])
        return front_videos

    def get_video_url(self, key: str, expires_in: int = 3600) -> str:
        """Get presigned URL for video file"""
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
        """Get video file information"""
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
        """List all video files under specified org_id and key_id, categorized by type"""
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
                
                # Match different types of video files
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
        
        # Sort by timestamp
        for video_type in videos:
            videos[video_type].sort(key=lambda x: x["timestamp"])
        
        return videos 