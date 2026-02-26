import json
import hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from uuid import uuid4
from typing import Optional
from pathlib import Path
from botocore.exceptions import ClientError
import redis.asyncio as redis
from .. import main as app_main
from ..main import S3_BUCKET
from ..settings import settings
from ..db import IngestEvent, SessionLocal

router = APIRouter()
redis_client = redis.from_url(settings.redis_url, decode_responses=True)


class IngestResponse(BaseModel):
    job_id: str
    object_key: str
    source: str
    size_bytes: int
    queue_length: int


@router.post("/upload", response_model=IngestResponse)
async def upload_receipt(
    file: UploadFile = File(...),
    source: str = Form("manual"),
    external_id: Optional[str] = Form(None),
):
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file upload")

    file_hash = hashlib.sha256(contents).hexdigest()
    suffix = Path(file.filename).suffix or ".bin"
    job_id = str(uuid4())
    object_key = f"raw/{source}/{job_id}{suffix}"

    try:
        if app_main.s3_client is None:
            app_main.ensure_bucket()
        app_main.s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=object_key,
            Body=contents,
            Metadata={
                "external_id": external_id or "",
                "filename": file.filename,
                "source_hint": source,
            },
            ContentType=file.content_type or "application/octet-stream",
        )
    except ClientError as exc:
        raise HTTPException(status_code=502, detail=f"MinIO error: {exc}") from exc

    job_payload = {
        "job_id": job_id,
        "object_key": object_key,
        "source": source,
        "external_id": external_id,
        "file_hash": file_hash,
        "content_type": file.content_type,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        queue_length = await redis_client.lpush("ingest:queue", json.dumps(job_payload))
    except redis.RedisError as exc:
        raise HTTPException(status_code=502, detail=f"Queue error: {exc}") from exc

    try:
        async with SessionLocal() as session:
            session.add(
                IngestEvent(
                    id=str(uuid4()),
                    artifact_id=None,
                    event_type="ingest_enqueued",
                    message=f"object_key={object_key} source={source}",
                )
            )
            await session.commit()
    except Exception:
        # Non-fatal: queue already has the job.
        pass

    return IngestResponse(
        job_id=job_id,
        object_key=object_key,
        source=source,
        size_bytes=len(contents),
        queue_length=queue_length,
    )
