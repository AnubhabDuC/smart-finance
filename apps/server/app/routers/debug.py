import asyncio

import redis.asyncio as redis
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import main as app_main
from ..db import (
    Artifact,
    EmiItem,
    IngestEvent,
    Statement,
    Transaction,
    get_session,
)
from ..main import S3_BUCKET
from ..settings import settings

router = APIRouter()
redis_client = redis.from_url(settings.redis_url, decode_responses=True)
RESET_CONFIRM_TEXT = "DELETE_EVERYTHING"


class ResetAllRequest(BaseModel):
    confirm_text: str


class ResetAllResponse(BaseModel):
    deleted: dict[str, int]
    redis_queue_deleted: int
    s3_current_deleted: int
    s3_versioned_deleted: int
    warnings: list[str]


def _row_to_dict(row) -> dict:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def _count_from_rowcount(value: int | None) -> int:
    if value is None or value < 0:
        return 0
    return int(value)


def _purge_bucket_objects() -> tuple[int, int]:
    if app_main.s3_client is None:
        app_main.ensure_bucket()

    client = app_main.s3_client
    if client is None:
        return (0, 0)

    current_deleted = 0
    versioned_deleted = 0

    list_current = client.get_paginator("list_objects_v2")
    for page in list_current.paginate(Bucket=S3_BUCKET):
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            client.delete_objects(
                Bucket=S3_BUCKET, Delete={"Objects": keys, "Quiet": True}
            )
            current_deleted += len(keys)

    list_versions = client.get_paginator("list_object_versions")
    for page in list_versions.paginate(Bucket=S3_BUCKET):
        version_items = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in page.get("Versions", [])
        ]
        marker_items = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in page.get("DeleteMarkers", [])
        ]
        to_delete = [*version_items, *marker_items]
        if to_delete:
            client.delete_objects(
                Bucket=S3_BUCKET, Delete={"Objects": to_delete, "Quiet": True}
            )
            versioned_deleted += len(to_delete)

    return (current_deleted, versioned_deleted)


@router.get("/db-preview")
async def db_preview(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(5, ge=1, le=100),
    events_limit: int = Query(10, ge=1, le=200),
):
    statements = (
        (
            await session.execute(
                select(Statement).order_by(Statement.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    transactions = (
        (
            await session.execute(
                select(Transaction).order_by(Transaction.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    emis = (await session.execute(select(EmiItem).limit(limit))).scalars().all()
    artifacts = (
        (
            await session.execute(
                select(Artifact).order_by(Artifact.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    events = (
        (
            await session.execute(
                select(IngestEvent)
                .order_by(IngestEvent.created_at.desc())
                .limit(events_limit)
            )
        )
        .scalars()
        .all()
    )

    payload = {
        "statements": [_row_to_dict(row) for row in statements],
        "transactions": [_row_to_dict(row) for row in transactions],
        "emi_items": [_row_to_dict(row) for row in emis],
        "artifacts": [_row_to_dict(row) for row in artifacts],
        "ingest_events": [_row_to_dict(row) for row in events],
    }
    return jsonable_encoder(payload)


@router.post("/reset-all", response_model=ResetAllResponse)
async def reset_all_data(
    payload: ResetAllRequest,
    session: AsyncSession = Depends(get_session),
):
    if payload.confirm_text != RESET_CONFIRM_TEXT:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid confirmation text. Expected '{RESET_CONFIRM_TEXT}'.",
        )

    warnings: list[str] = []

    try:
        emi_result = await session.execute(delete(EmiItem))
        txn_result = await session.execute(delete(Transaction))
        stmt_result = await session.execute(delete(Statement))
        event_result = await session.execute(delete(IngestEvent))
        artifact_result = await session.execute(delete(Artifact))
        await session.commit()
    except Exception as exc:
        await session.rollback()
        raise HTTPException(
            status_code=500, detail=f"Database reset failed: {exc}"
        ) from exc

    redis_deleted = 0
    try:
        redis_deleted = int(await redis_client.delete("ingest:queue"))
    except redis.RedisError as exc:
        warnings.append(f"Redis queue reset failed: {exc}")

    current_deleted = 0
    versioned_deleted = 0
    try:
        current_deleted, versioned_deleted = await asyncio.to_thread(
            _purge_bucket_objects
        )
    except ClientError as exc:
        warnings.append(f"Object store reset failed: {exc}")

    response = ResetAllResponse(
        deleted={
            "emi_items": _count_from_rowcount(emi_result.rowcount),
            "transactions": _count_from_rowcount(txn_result.rowcount),
            "statements": _count_from_rowcount(stmt_result.rowcount),
            "ingest_events": _count_from_rowcount(event_result.rowcount),
            "artifacts": _count_from_rowcount(artifact_result.rowcount),
        },
        redis_queue_deleted=redis_deleted,
        s3_current_deleted=current_deleted,
        s3_versioned_deleted=versioned_deleted,
        warnings=warnings,
    )
    return jsonable_encoder(response)
