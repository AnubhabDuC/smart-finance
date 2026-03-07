from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..db import Statement, Transaction, User, get_session

router = APIRouter()


class TxIn(BaseModel):
    ts: datetime
    amount: float
    currency: str = "INR"
    account_type: str
    instrument: str
    merchant_raw: Optional[str] = None
    source: str
    meta: dict = {}


class TxOut(TxIn):
    id: str
    statement_id: Optional[str] = None
    statement_issuer: Optional[str] = None
    statement_instrument: Optional[str] = None
    category_lvl1: Optional[str] = None
    category_lvl2: Optional[str] = None
    confidence: float = 0.0


@router.post("", response_model=TxOut)
async def add_tx(
    tx: TxIn,
    current_user: User = Depends(get_current_user),
):
    # TODO: insert into DB, categorize, return normalized row
    _ = current_user
    return TxOut(id="demo-1", **tx.model_dump())


@router.get("", response_model=list[TxOut])
async def list_transactions(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    merchant: Optional[str] = None,
):
    stmt = select(Transaction, Statement).outerjoin(
        Statement, Statement.id == Transaction.statement_id
    )
    stmt = stmt.where(Transaction.user_id == current_user.id)
    if start:
        stmt = stmt.where(Transaction.ts >= start)
    if end:
        stmt = stmt.where(Transaction.ts <= end)
    if merchant:
        stmt = stmt.where(Transaction.merchant_normalized.ilike(f"%{merchant}%"))
    stmt = stmt.order_by(Transaction.ts.desc()).offset(offset).limit(limit)
    rows = (await session.execute(stmt)).all()
    result = []
    for tx_row, st_row in rows:
        result.append(
            TxOut(
                id=tx_row.id,
                ts=tx_row.ts,
                amount=tx_row.amount_value,
                currency=tx_row.amount_currency,
                account_type=tx_row.account_type or "credit_card",
                instrument=tx_row.channel or "CARD",
                merchant_raw=tx_row.merchant_raw,
                source=tx_row.source,
                statement_id=tx_row.statement_id,
                statement_issuer=st_row.issuer if st_row else None,
                statement_instrument=st_row.instrument if st_row else None,
                meta={
                    "statement_id": tx_row.statement_id,
                    "object_key": tx_row.object_key,
                },
            )
        )
    return result
