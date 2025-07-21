import boto3
import s3fs
import pandas as pd

class S3ParquetManager:
    def __init__(self, bucket_name="matt3r-dmp-us-west-2"):
        self.bucket = bucket_name
        self.s3 = boto3.client("s3")
        self.fs = s3fs.S3FileSystem()

    def list_org_ids(self):
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Delimiter="/")
        org_ids = []
        for page in pages:
            for prefix_obj in page.get("CommonPrefixes", []):
                org_id = prefix_obj["Prefix"].rstrip("/")
                org_ids.append(org_id)
        return org_ids

    def list_key_ids_by_org(self, org_id):
        prefix = f"{org_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix, Delimiter="/")
        key_ids = []
        for page in pages:
            for prefix_obj in page.get("CommonPrefixes", []):
                key_id = prefix_obj["Prefix"].replace(prefix, "").rstrip("/")
                key_ids.append(key_id)
        return key_ids

    def list_parquet_keys(self, org_id, key_id=None):
        prefix = f"{org_id}/"
        if key_id:
            prefix += f"{key_id}/"
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)
        parquet_keys = []
        for page in pages:
            for obj in page.get("Contents", []):
                if obj["Key"].endswith("processed_console_trip.parquet"):
                    parquet_keys.append(obj["Key"])
        return parquet_keys

    def load_parquet(self, key):
        s3_path = f"s3://{self.bucket}/{key}"
        return pd.read_parquet(s3_path, filesystem=self.fs) 