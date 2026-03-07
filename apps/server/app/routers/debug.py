import asyncio
import json
import secrets

import redis.asyncio as redis
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import main as app_main
from ..auth import get_current_user
from ..db import (
    Artifact,
    EmiItem,
    IngestEvent,
    Statement,
    Transaction,
    User,
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


def _is_valid_debug_admin_key(candidate: str | None) -> bool:
    configured = settings.debug_admin_key
    if not configured:
        return False
    if not candidate:
        return False
    return secrets.compare_digest(candidate, configured)


async def _load_db_preview_data(
    session: AsyncSession,
    limit: int,
    events_limit: int,
    user_id: str | None,
) -> dict:
    statement_stmt = select(Statement).order_by(Statement.created_at.desc()).limit(limit)
    transaction_stmt = (
        select(Transaction).order_by(Transaction.created_at.desc()).limit(limit)
    )
    emi_stmt = select(EmiItem).limit(limit)
    artifact_stmt = select(Artifact).order_by(Artifact.created_at.desc()).limit(limit)
    event_stmt = (
        select(IngestEvent).order_by(IngestEvent.created_at.desc()).limit(events_limit)
    )
    user_stmt = select(User).order_by(User.created_at.desc()).limit(limit)

    if user_id:
        statement_stmt = statement_stmt.where(Statement.user_id == user_id)
        transaction_stmt = transaction_stmt.where(Transaction.user_id == user_id)
        emi_stmt = emi_stmt.join(Statement, Statement.id == EmiItem.statement_id).where(
            Statement.user_id == user_id
        )
        artifact_stmt = artifact_stmt.where(Artifact.user_id == user_id)
        event_stmt = event_stmt.where(IngestEvent.user_id == user_id)
        user_stmt = user_stmt.where(User.id == user_id)

    statements = (await session.execute(statement_stmt)).scalars().all()
    transactions = (await session.execute(transaction_stmt)).scalars().all()
    emis = (await session.execute(emi_stmt)).scalars().all()
    artifacts = (await session.execute(artifact_stmt)).scalars().all()
    events = (await session.execute(event_stmt)).scalars().all()
    users = (await session.execute(user_stmt)).scalars().all()

    return {
        "users": [_row_to_dict(row) for row in users],
        "statements": [_row_to_dict(row) for row in statements],
        "transactions": [_row_to_dict(row) for row in transactions],
        "emi_items": [_row_to_dict(row) for row in emis],
        "artifacts": [_row_to_dict(row) for row in artifacts],
        "ingest_events": [_row_to_dict(row) for row in events],
    }


async def _clear_user_queue(user_id: str) -> int:
    removed = 0
    try:
        jobs = await redis_client.lrange("ingest:queue", 0, -1)
    except redis.RedisError:
        return 0

    for raw in jobs:
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if payload.get("user_id") != user_id:
            continue
        removed += int(await redis_client.lrem("ingest:queue", 1, raw))
    return removed


def _purge_bucket_objects(object_keys: list[str]) -> tuple[int, int]:
    if not object_keys:
        return (0, 0)
    if app_main.s3_client is None:
        app_main.ensure_bucket()

    client = app_main.s3_client
    if client is None:
        return (0, 0)

    current_deleted = 0
    versioned_deleted = 0

    target_keys = set(object_keys)

    list_current = client.get_paginator("list_objects_v2")
    for page in list_current.paginate(Bucket=S3_BUCKET):
        for item in page.get("Contents", []):
            if item["Key"] not in target_keys:
                continue
            client.delete_object(Bucket=S3_BUCKET, Key=item["Key"])
            current_deleted += 1

    list_versions = client.get_paginator("list_object_versions")
    for page in list_versions.paginate(Bucket=S3_BUCKET):
        for item in page.get("Versions", []):
            if item["Key"] not in target_keys:
                continue
            client.delete_object(
                Bucket=S3_BUCKET, Key=item["Key"], VersionId=item["VersionId"]
            )
            versioned_deleted += 1
        for item in page.get("DeleteMarkers", []):
            if item["Key"] not in target_keys:
                continue
            client.delete_object(
                Bucket=S3_BUCKET, Key=item["Key"], VersionId=item["VersionId"]
            )
            versioned_deleted += 1

    return (current_deleted, versioned_deleted)


@router.get("/db-preview")
async def db_preview(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(5, ge=1, le=100),
    events_limit: int = Query(10, ge=1, le=200),
):
    payload = await _load_db_preview_data(
        session=session,
        limit=limit,
        events_limit=events_limit,
        user_id=current_user.id,
    )
    return jsonable_encoder(payload)


@router.get("/db-preview/all")
async def db_preview_all(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(20, ge=1, le=500),
    events_limit: int = Query(50, ge=1, le=1000),
    x_debug_key: str | None = Header(default=None, alias="X-Debug-Key"),
):
    if not settings.debug_admin_key:
        raise HTTPException(
            status_code=403,
            detail="DEBUG_ADMIN_KEY is not configured",
        )
    if not _is_valid_debug_admin_key(x_debug_key):
        raise HTTPException(status_code=401, detail="Invalid debug admin key")

    payload = await _load_db_preview_data(
        session=session,
        limit=limit,
        events_limit=events_limit,
        user_id=None,
    )
    return jsonable_encoder(payload)


@router.post("/reset-all", response_model=ResetAllResponse)
async def reset_all_data(
    payload: ResetAllRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if payload.confirm_text != RESET_CONFIRM_TEXT:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid confirmation text. Expected '{RESET_CONFIRM_TEXT}'.",
        )

    warnings: list[str] = []

    artifact_rows = (
        (
            await session.execute(
                select(Artifact.object_key).where(Artifact.user_id == current_user.id)
            )
        )
        .scalars()
        .all()
    )
    object_keys = sorted({key for key in artifact_rows if key})

    try:
        emi_result = await session.execute(
            delete(EmiItem).where(
                EmiItem.statement_id.in_(
                    select(Statement.id).where(Statement.user_id == current_user.id)
                )
            )
        )
        txn_result = await session.execute(
            delete(Transaction).where(Transaction.user_id == current_user.id)
        )
        stmt_result = await session.execute(
            delete(Statement).where(Statement.user_id == current_user.id)
        )
        event_result = await session.execute(
            delete(IngestEvent).where(IngestEvent.user_id == current_user.id)
        )
        artifact_result = await session.execute(
            delete(Artifact).where(Artifact.user_id == current_user.id)
        )
        await session.commit()
    except Exception as exc:
        await session.rollback()
        raise HTTPException(
            status_code=500, detail=f"Database reset failed: {exc}"
        ) from exc

    redis_deleted = 0
    try:
        redis_deleted = await _clear_user_queue(current_user.id)
    except redis.RedisError as exc:
        warnings.append(f"Redis queue reset failed: {exc}")

    current_deleted = 0
    versioned_deleted = 0
    try:
        current_deleted, versioned_deleted = await asyncio.to_thread(
            _purge_bucket_objects,
            object_keys,
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
