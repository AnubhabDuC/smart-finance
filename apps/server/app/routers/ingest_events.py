from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Artifact, EmiItem, IngestEvent, Statement, Transaction, get_session

router = APIRouter()


class IngestEventOut(BaseModel):
    id: str
    event_type: str
    message: Optional[str] = None
    created_at: datetime
    artifact_id: Optional[str] = None
    object_key: Optional[str] = None
    file_hash: Optional[str] = None


class IngestTxnOut(BaseModel):
    id: str
    ts: datetime
    amount_value: float
    amount_currency: str
    txn_type: str
    merchant_raw: Optional[str] = None
    merchant_normalized: Optional[str] = None
    channel: Optional[str] = None
    reference: Optional[str] = None
    location: Optional[str] = None


class IngestEmiOut(BaseModel):
    id: str
    description: Optional[str] = None
    total_amount_value: Optional[float] = None
    total_amount_currency: Optional[str] = None
    monthly_installment_value: Optional[float] = None
    monthly_installment_currency: Optional[str] = None
    tenure_months: Optional[int] = None
    remaining_months: Optional[int] = None


class IngestStatementOut(BaseModel):
    id: str
    issuer: Optional[str] = None
    instrument: Optional[str] = None
    statement_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    total_due_value: Optional[float] = None
    total_due_currency: Optional[str] = None
    minimum_due_value: Optional[float] = None
    minimum_due_currency: Optional[str] = None


class IngestDetailOut(BaseModel):
    artifact_id: str
    object_key: Optional[str] = None
    file_hash: Optional[str] = None
    source: Optional[str] = None
    external_id: Optional[str] = None
    status: Optional[str] = None
    transactions_added: int
    transactions_skipped: int
    transactions: list[IngestTxnOut]
    emi_items: list[IngestEmiOut]
    statement: Optional[IngestStatementOut] = None
    events: list[IngestEventOut]


class RollbackRequest(BaseModel):
    transaction_ids: Optional[list[str]] = None


@router.get("", response_model=list[IngestEventOut])
async def list_ingest_events(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(25, ge=1, le=200),
):
    stmt = (
        select(IngestEvent, Artifact)
        .outerjoin(Artifact, Artifact.id == IngestEvent.artifact_id)
        .order_by(IngestEvent.created_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    results = []
    for event, artifact in rows:
        results.append(
            IngestEventOut(
                id=event.id,
                event_type=event.event_type,
                message=event.message,
                created_at=event.created_at,
                artifact_id=event.artifact_id,
                object_key=artifact.object_key if artifact else None,
                file_hash=artifact.file_hash if artifact else None,
            )
        )
    return results


@router.get("/{artifact_id}/details", response_model=IngestDetailOut)
async def ingest_details(
    artifact_id: str,
    session: AsyncSession = Depends(get_session),
):
    artifact_stmt = select(Artifact).where(Artifact.id == artifact_id)
    artifact = (await session.execute(artifact_stmt)).scalars().first()
    if not artifact:
        raise HTTPException(status_code=404, detail="Ingestion not found")

    statement_stmt = select(Statement).where(Statement.artifact_id == artifact_id)
    statement = (await session.execute(statement_stmt)).scalars().first()

    txn_stmt = (
        select(Transaction)
        .where(Transaction.artifact_id == artifact_id)
        .order_by(Transaction.ts.asc())
    )
    transactions = (await session.execute(txn_stmt)).scalars().all()

    emi_stmt = (
        select(EmiItem)
        .join(Statement, EmiItem.statement_id == Statement.id)
        .where(Statement.artifact_id == artifact_id)
    )
    emi_items = (await session.execute(emi_stmt)).scalars().all()

    dedup_stmt = (
        select(func.count())
        .select_from(IngestEvent)
        .where(
            IngestEvent.artifact_id == artifact_id,
            IngestEvent.event_type == "dedup_skip",
        )
    )
    dedup_count = (await session.execute(dedup_stmt)).scalar_one()

    events_stmt = (
        select(IngestEvent)
        .where(IngestEvent.artifact_id == artifact_id)
        .order_by(IngestEvent.created_at.desc())
        .limit(100)
    )
    events = (await session.execute(events_stmt)).scalars().all()
    event_out = [
        IngestEventOut(
            id=event.id,
            event_type=event.event_type,
            message=event.message,
            created_at=event.created_at,
            artifact_id=event.artifact_id,
            object_key=artifact.object_key,
            file_hash=artifact.file_hash,
        )
        for event in events
    ]

    statement_out = None
    if statement:
        statement_out = IngestStatementOut(
            id=statement.id,
            issuer=statement.issuer,
            instrument=statement.instrument,
            statement_date=statement.statement_date,
            due_date=statement.due_date,
            period_start=statement.period_start,
            period_end=statement.period_end,
            total_due_value=statement.total_due_value,
            total_due_currency=statement.total_due_currency,
            minimum_due_value=statement.minimum_due_value,
            minimum_due_currency=statement.minimum_due_currency,
        )

    return IngestDetailOut(
        artifact_id=artifact.id,
        object_key=artifact.object_key,
        file_hash=artifact.file_hash,
        source=artifact.source,
        external_id=artifact.external_id,
        status=artifact.status,
        transactions_added=len(transactions),
        transactions_skipped=int(dedup_count or 0),
        transactions=[
            IngestTxnOut(
                id=txn.id,
                ts=txn.ts,
                amount_value=txn.amount_value,
                amount_currency=txn.amount_currency,
                txn_type=txn.txn_type,
                merchant_raw=txn.merchant_raw,
                merchant_normalized=txn.merchant_normalized,
                channel=txn.channel,
                reference=txn.reference,
                location=txn.location,
            )
            for txn in transactions
        ],
        emi_items=[
            IngestEmiOut(
                id=item.id,
                description=item.description,
                total_amount_value=item.total_amount_value,
                total_amount_currency=item.total_amount_currency,
                monthly_installment_value=item.monthly_installment_value,
                monthly_installment_currency=item.monthly_installment_currency,
                tenure_months=item.tenure_months,
                remaining_months=item.remaining_months,
            )
            for item in emi_items
        ],
        statement=statement_out,
        events=event_out,
    )


@router.post("/{artifact_id}/rollback")
async def rollback_ingest(
    artifact_id: str,
    payload: RollbackRequest,
    session: AsyncSession = Depends(get_session),
):
    artifact_stmt = select(Artifact).where(Artifact.id == artifact_id)
    artifact = (await session.execute(artifact_stmt)).scalars().first()
    if not artifact:
        raise HTTPException(status_code=404, detail="Ingestion not found")

    if payload.transaction_ids:
        delete_stmt = (
            delete(Transaction)
            .where(Transaction.artifact_id == artifact_id)
            .where(Transaction.id.in_(payload.transaction_ids))
        )
        result = await session.execute(delete_stmt)
        session.add(
            IngestEvent(
                id=str(uuid4()),
                artifact_id=artifact_id,
                event_type="ingest_partial_rollback",
                message=f"transactions_deleted={result.rowcount or 0}",
            )
        )
        await session.commit()
        return {"status": "partial", "transactions_deleted": result.rowcount or 0}

    stmt_ids = select(Statement.id).where(Statement.artifact_id == artifact_id)
    statement_ids = [row[0] for row in (await session.execute(stmt_ids)).all()]
    if statement_ids:
        await session.execute(
            delete(EmiItem).where(EmiItem.statement_id.in_(statement_ids))
        )
    txn_result = await session.execute(
        delete(Transaction).where(Transaction.artifact_id == artifact_id)
    )
    stmt_result = await session.execute(
        delete(Statement).where(Statement.artifact_id == artifact_id)
    )
    await session.execute(
        update(Artifact).where(Artifact.id == artifact_id).values(status="rolled_back")
    )
    session.add(
        IngestEvent(
            id=str(uuid4()),
            artifact_id=artifact_id,
            event_type="ingest_rollback",
            message="Rolled back ingestion data",
        )
    )
    await session.commit()
    return {
        "status": "rolled_back",
        "transactions_deleted": txn_result.rowcount or 0,
        "statements_deleted": stmt_result.rowcount or 0,
    }
