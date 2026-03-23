import asyncio
import json
import re
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


class SeaweedS3Storage:
    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str,
        secure: bool,
        create_bucket_if_missing: bool,
    ) -> None:
        self._bucket = bucket
        self._create_bucket_if_missing = create_bucket_if_missing
        self._bucket_checked = False
        self._bucket_lock = asyncio.Lock()

        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            use_ssl=secure,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=5,
                read_timeout=20,
                retries={"max_attempts": 2, "mode": "standard"},
            ),
        )

    async def save(
        self,
        stored_filename: str,
        content: bytes,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self._ensure_bucket_exists()
        normalized_metadata = self._normalize_metadata(metadata or {})

        def _put() -> None:
            payload: dict[str, Any] = {
                "Bucket": self._bucket,
                "Key": stored_filename,
                "Body": content,
            }
            if normalized_metadata:
                payload["Metadata"] = normalized_metadata

            self._client.put_object(**payload)

        await asyncio.to_thread(_put)

    async def read(self, stored_filename: str) -> bytes:
        await self._ensure_bucket_exists()

        def _get() -> bytes:
            response = self._client.get_object(Bucket=self._bucket, Key=stored_filename)
            return response["Body"].read()

        try:
            return await asyncio.to_thread(_get)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"NoSuchKey", "404"}:
                raise FileNotFoundError("Stored feed file content was not found.") from exc
            raise

    async def delete(self, stored_filename: str) -> None:
        await self._ensure_bucket_exists()

        def _delete() -> None:
            self._client.delete_object(Bucket=self._bucket, Key=stored_filename)

        await asyncio.to_thread(_delete)

    async def move(self, source_stored_filename: str, target_stored_filename: str) -> None:
        await self._ensure_bucket_exists()

        def _move() -> None:
            self._client.copy_object(
                Bucket=self._bucket,
                CopySource={"Bucket": self._bucket, "Key": source_stored_filename},
                Key=target_stored_filename,
            )
            self._client.delete_object(Bucket=self._bucket, Key=source_stored_filename)

        try:
            await asyncio.to_thread(_move)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"NoSuchKey", "404"}:
                raise FileNotFoundError("Stored feed file content was not found.") from exc
            raise

    async def delete_folder(self, folder_path: str) -> None:
        await self._ensure_bucket_exists()
        prefix = folder_path.rstrip("/") + "/"

        def _delete_all() -> None:
            continuation_token: str | None = None
            while True:
                kwargs: dict[str, Any] = {
                    "Bucket": self._bucket,
                    "Prefix": prefix,
                    "MaxKeys": 1000,
                }
                if continuation_token:
                    kwargs["ContinuationToken"] = continuation_token

                response = self._client.list_objects_v2(**kwargs)
                objects = [{"Key": obj["Key"]} for obj in response.get("Contents", [])]
                if objects:
                    self._client.delete_objects(
                        Bucket=self._bucket,
                        Delete={"Objects": objects},
                    )

                if not response.get("IsTruncated"):
                    break
                continuation_token = response.get("NextContinuationToken")

        await asyncio.to_thread(_delete_all)

    async def create_folder(self, folder_path: str) -> None:
        await self._ensure_bucket_exists()
        marker_key = f"{folder_path.rstrip('/')}/.folder"

        def _create_marker() -> None:
            self._client.put_object(Bucket=self._bucket, Key=marker_key, Body=b"")

        await asyncio.to_thread(_create_marker)

    async def list_folders(self) -> list[str]:
        await self._ensure_bucket_exists()

        def _list() -> list[str]:
            folders: list[str] = []
            continuation_token: str | None = None
            while True:
                kwargs: dict[str, Any] = {"Bucket": self._bucket, "MaxKeys": 1000}
                if continuation_token:
                    kwargs["ContinuationToken"] = continuation_token

                response = self._client.list_objects_v2(**kwargs)
                for item in response.get("Contents", []):
                    key = item.get("Key", "")
                    if key.endswith("/.folder"):
                        folder = key[: -len("/.folder")]
                        if folder:
                            folders.append(folder)

                if not response.get("IsTruncated"):
                    break

                continuation_token = response.get("NextContinuationToken")

            return folders

        return await asyncio.to_thread(_list)

    async def _ensure_bucket_exists(self) -> None:
        if self._bucket_checked:
            return

        async with self._bucket_lock:
            if self._bucket_checked:
                return

            def _ensure() -> None:
                try:
                    self._client.head_bucket(Bucket=self._bucket)
                except ClientError as exc:
                    if not self._create_bucket_if_missing:
                        raise RuntimeError(
                            f"Seaweed bucket {self._bucket!r} does not exist."
                        ) from exc

                    self._client.create_bucket(Bucket=self._bucket)

            await asyncio.to_thread(_ensure)
            self._bucket_checked = True

    @staticmethod
    def _normalize_metadata(metadata: dict[str, Any]) -> dict[str, str]:
        normalized: dict[str, str] = {}
        for key, value in metadata.items():
            cleaned_key = re.sub(r"[^a-zA-Z0-9-]", "-", str(key).strip().lower())
            cleaned_key = re.sub(r"-{2,}", "-", cleaned_key).strip("-")
            if not cleaned_key:
                continue

            if isinstance(value, (str, int, float, bool)):
                cleaned_value = str(value)
            elif value is None:
                cleaned_value = ""
            else:
                cleaned_value = json.dumps(value, ensure_ascii=True, separators=(",", ":"))

            normalized[cleaned_key] = cleaned_value

        return normalized
