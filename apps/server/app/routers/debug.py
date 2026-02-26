from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Artifact, EmiItem, IngestEvent, Statement, Transaction, get_session

router = APIRouter()


def _row_to_dict(row) -> dict:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


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
