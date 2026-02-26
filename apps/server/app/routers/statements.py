from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import EmiItem, Statement, Transaction, get_session

router = APIRouter()


class MoneyOut(BaseModel):
    value: float
    currency: str


class EmiOut(BaseModel):
    id: str
    description: Optional[str] = None
    total_amount: Optional[MoneyOut] = None
    monthly_installment: Optional[MoneyOut] = None
    tenure_months: Optional[int] = None
    remaining_months: Optional[int] = None


class StatementOut(BaseModel):
    id: str
    account_type: str
    source: str
    object_key: str
    issuer: Optional[str] = None
    instrument: Optional[str] = None
    statement_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    total_due: Optional[MoneyOut] = None
    minimum_due: Optional[MoneyOut] = None
    opening_balance: Optional[MoneyOut] = None
    closing_balance: Optional[MoneyOut] = None
    total_credits: Optional[MoneyOut] = None
    total_debits: Optional[MoneyOut] = None
    finance_charges: Optional[MoneyOut] = None
    emi_items: list[EmiOut] = []


class StatementDetail(StatementOut):
    transactions: list[dict] = []


class TotalsOut(BaseModel):
    total_due: Optional[MoneyOut] = None
    minimum_due: Optional[MoneyOut] = None
    opening_balance: Optional[MoneyOut] = None
    closing_balance: Optional[MoneyOut] = None
    total_credits: Optional[MoneyOut] = None
    total_debits: Optional[MoneyOut] = None
    finance_charges: Optional[MoneyOut] = None
    statement_count: int
    transaction_count: int


class MonthlyTotalsOut(BaseModel):
    month: str
    total_due: Optional[MoneyOut] = None
    minimum_due: Optional[MoneyOut] = None
    total_credits: Optional[MoneyOut] = None
    total_debits: Optional[MoneyOut] = None
    finance_charges: Optional[MoneyOut] = None
    statement_count: int
    transaction_count: int
    txn_amount_total: Optional[MoneyOut] = None


class MonthlyCreditDebitOut(BaseModel):
    month: str
    debit_total: Optional[MoneyOut] = None
    credit_total: Optional[MoneyOut] = None
    transaction_count: int


class MerchantTotalOut(BaseModel):
    merchant: str
    total: MoneyOut
    transaction_count: int


class MonthlyTopMerchantsOut(BaseModel):
    month: str
    top_merchants: list[MerchantTotalOut]


class CategoryTotalOut(BaseModel):
    category: str
    total: MoneyOut
    transaction_count: int


class MonthlyCategoryBreakdownOut(BaseModel):
    month: str
    categories: list[CategoryTotalOut]


@router.get("", response_model=list[StatementOut])
async def list_statements(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Statement)
    if issuer:
        pattern = f"%{issuer}%"
        stmt = stmt.where(
            or_(
                Statement.issuer.ilike(pattern),
                Statement.instrument.ilike(pattern),
            )
        )
    if start:
        stmt = stmt.where(Statement.statement_date >= start)
    if end:
        stmt = stmt.where(Statement.statement_date <= end)
    stmt = stmt.order_by(Statement.created_at.desc()).offset(offset).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [_statement_to_out(row) for row in rows]


@router.get("/summary/totals", response_model=TotalsOut)
async def get_statement_totals(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Statement)
    if issuer:
        pattern = f"%{issuer}%"
        stmt = stmt.where(
            or_(
                Statement.issuer.ilike(pattern),
                Statement.instrument.ilike(pattern),
            )
        )
    if start:
        stmt = stmt.where(Statement.statement_date >= start)
    if end:
        stmt = stmt.where(Statement.statement_date <= end)

    rows = (await session.execute(stmt)).scalars().all()

    total_due = _sum_money(rows, "total_due_value", "total_due_currency")
    minimum_due = _sum_money(rows, "minimum_due_value", "minimum_due_currency")
    opening_balance = _sum_money(
        rows, "opening_balance_value", "opening_balance_currency"
    )
    closing_balance = _sum_money(
        rows, "closing_balance_value", "closing_balance_currency"
    )
    total_credits = _sum_money(rows, "total_credits_value", "total_credits_currency")
    total_debits = _sum_money(rows, "total_debits_value", "total_debits_currency")
    finance_charges = _sum_money(
        rows, "finance_charges_value", "finance_charges_currency"
    )

    tx_stmt = select(Transaction.statement_id).distinct()
    if issuer:
        tx_stmt = tx_stmt.join(Statement, Statement.id == Transaction.statement_id)
        tx_stmt = tx_stmt.where(
            or_(
                Statement.issuer.ilike(pattern),
                Statement.instrument.ilike(pattern),
            )
        )
    if start:
        tx_stmt = tx_stmt.where(Statement.statement_date >= start)
    if end:
        tx_stmt = tx_stmt.where(Statement.statement_date <= end)
    tx_statement_ids = (await session.execute(tx_stmt)).scalars().all()

    count_stmt = select(Transaction).where(
        Transaction.statement_id.in_(tx_statement_ids)
    )
    transaction_count = len((await session.execute(count_stmt)).scalars().all())

    return TotalsOut(
        total_due=total_due,
        minimum_due=minimum_due,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        total_credits=total_credits,
        total_debits=total_debits,
        finance_charges=finance_charges,
        statement_count=len(rows),
        transaction_count=transaction_count,
    )


@router.get("/summary/by-month", response_model=list[MonthlyTotalsOut])
async def get_statement_monthly_totals(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Statement)
    if issuer:
        pattern = f"%{issuer}%"
        stmt = stmt.where(
            or_(
                Statement.issuer.ilike(pattern),
                Statement.instrument.ilike(pattern),
            )
        )
    if start:
        stmt = stmt.where(Statement.statement_date >= start)
    if end:
        stmt = stmt.where(Statement.statement_date <= end)

    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    by_month = {}
    statement_ids = []
    for row in rows:
        if not row.statement_date:
            continue
        key = row.statement_date.strftime("%Y-%m")
        entry = by_month.setdefault(
            key,
            {
                "rows": [],
                "statement_ids": [],
            },
        )
        entry["rows"].append(row)
        entry["statement_ids"].append(row.id)
        statement_ids.append(row.id)

    tx_stmt = select(Transaction.statement_id).where(
        Transaction.statement_id.in_(statement_ids)
    )
    tx_rows = (await session.execute(tx_stmt)).scalars().all()
    tx_counts = {}
    for statement_id in tx_rows:
        tx_counts[statement_id] = tx_counts.get(statement_id, 0) + 1

    results = []
    for month, data in sorted(by_month.items()):
        rows = data["rows"]
        statement_ids = data["statement_ids"]
        results.append(
            MonthlyTotalsOut(
                month=month,
                total_due=_sum_money(rows, "total_due_value", "total_due_currency"),
                minimum_due=_sum_money(
                    rows, "minimum_due_value", "minimum_due_currency"
                ),
                total_credits=_sum_money(
                    rows, "total_credits_value", "total_credits_currency"
                ),
                total_debits=_sum_money(
                    rows, "total_debits_value", "total_debits_currency"
                ),
                finance_charges=_sum_money(
                    rows, "finance_charges_value", "finance_charges_currency"
                ),
                statement_count=len(rows),
                transaction_count=sum(tx_counts.get(sid, 0) for sid in statement_ids),
            )
        )
    return results


@router.get("/summary/by-transaction-month", response_model=list[MonthlyTotalsOut])
async def get_transaction_monthly_totals(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Transaction)
    if issuer or start or end:
        stmt = stmt.join(Statement, Statement.id == Transaction.statement_id)
        if issuer:
            pattern = f"%{issuer}%"
            stmt = stmt.where(
                or_(
                    Statement.issuer.ilike(pattern),
                    Statement.instrument.ilike(pattern),
                )
            )
        if start:
            stmt = stmt.where(Transaction.ts >= start)
        if end:
            stmt = stmt.where(Transaction.ts <= end)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    by_month = {}
    for row in rows:
        key = row.ts.strftime("%Y-%m")
        entry = by_month.setdefault(
            key,
            {
                "rows": [],
                "amount_total": 0.0,
                "currency": row.amount_currency,
            },
        )
        entry["rows"].append(row)
        if row.amount_currency == entry["currency"]:
            entry["amount_total"] += row.amount_value

    results = []
    for month, data in sorted(by_month.items()):
        rows = data["rows"]
        results.append(
            MonthlyTotalsOut(
                month=month,
                total_due=None,
                minimum_due=None,
                total_credits=None,
                total_debits=None,
                finance_charges=None,
                statement_count=len({r.statement_id for r in rows if r.statement_id}),
                transaction_count=len(rows),
                txn_amount_total=_money(data["amount_total"], data["currency"]),
            )
        )
    return results


@router.get(
    "/summary/credits-debits-by-month", response_model=list[MonthlyCreditDebitOut]
)
async def get_monthly_credits_debits(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Transaction)
    if issuer or start or end:
        stmt = stmt.join(Statement, Statement.id == Transaction.statement_id)
        if issuer:
            pattern = f"%{issuer}%"
            stmt = stmt.where(
                or_(
                    Statement.issuer.ilike(pattern),
                    Statement.instrument.ilike(pattern),
                )
            )
        if start:
            stmt = stmt.where(Transaction.ts >= start)
        if end:
            stmt = stmt.where(Transaction.ts <= end)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    by_month = {}
    for row in rows:
        key = row.ts.strftime("%Y-%m")
        entry = by_month.setdefault(
            key,
            {
                "currency": row.amount_currency,
                "debit": 0.0,
                "credit": 0.0,
                "count": 0,
            },
        )
        if row.amount_currency != entry["currency"]:
            continue
        if row.txn_type == "credit":
            entry["credit"] += row.amount_value
        else:
            entry["debit"] += row.amount_value
        entry["count"] += 1

    results = []
    for month, data in sorted(by_month.items()):
        results.append(
            MonthlyCreditDebitOut(
                month=month,
                debit_total=_money(data["debit"], data["currency"]),
                credit_total=_money(data["credit"], data["currency"]),
                transaction_count=data["count"],
            )
        )
    return results


@router.get(
    "/summary/top-merchants-by-month", response_model=list[MonthlyTopMerchantsOut]
)
async def get_top_merchants_by_month(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = Query(5, ge=1, le=25),
):
    stmt = select(Transaction)
    if issuer or start or end:
        stmt = stmt.join(Statement, Statement.id == Transaction.statement_id)
        if issuer:
            pattern = f"%{issuer}%"
            stmt = stmt.where(
                or_(
                    Statement.issuer.ilike(pattern),
                    Statement.instrument.ilike(pattern),
                )
            )
        if start:
            stmt = stmt.where(Transaction.ts >= start)
        if end:
            stmt = stmt.where(Transaction.ts <= end)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    by_month = {}
    for row in rows:
        key = row.ts.strftime("%Y-%m")
        entry = by_month.setdefault(
            key,
            {
                "currency": row.amount_currency,
                "merchants": {},
            },
        )
        if row.amount_currency != entry["currency"]:
            continue
        merchant = row.merchant_normalized or row.merchant_raw or "UNKNOWN"
        bucket = entry["merchants"].setdefault(merchant, {"total": 0.0, "count": 0})
        bucket["total"] += row.amount_value
        bucket["count"] += 1

    results = []
    for month, data in sorted(by_month.items()):
        top = sorted(
            data["merchants"].items(), key=lambda item: item[1]["total"], reverse=True
        )[:limit]
        results.append(
            MonthlyTopMerchantsOut(
                month=month,
                top_merchants=[
                    MerchantTotalOut(
                        merchant=name,
                        total=_money(stats["total"], data["currency"]),
                        transaction_count=stats["count"],
                    )
                    for name, stats in top
                ],
            )
        )
    return results


@router.get(
    "/summary/categories-by-month", response_model=list[MonthlyCategoryBreakdownOut]
)
async def get_categories_by_month(
    session: AsyncSession = Depends(get_session),
    issuer: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(Transaction)
    if issuer or start or end:
        stmt = stmt.join(Statement, Statement.id == Transaction.statement_id)
        if issuer:
            pattern = f"%{issuer}%"
            stmt = stmt.where(
                or_(
                    Statement.issuer.ilike(pattern),
                    Statement.instrument.ilike(pattern),
                )
            )
        if start:
            stmt = stmt.where(Transaction.ts >= start)
        if end:
            stmt = stmt.where(Transaction.ts <= end)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    by_month = {}
    for row in rows:
        key = row.ts.strftime("%Y-%m")
        entry = by_month.setdefault(
            key,
            {"currency": row.amount_currency, "categories": {}},
        )
        if row.amount_currency != entry["currency"]:
            continue
        category = _categorize_merchant(row.merchant_normalized or row.merchant_raw)
        bucket = entry["categories"].setdefault(category, {"total": 0.0, "count": 0})
        bucket["total"] += row.amount_value
        bucket["count"] += 1

    results = []
    for month, data in sorted(by_month.items()):
        categories = [
            CategoryTotalOut(
                category=name,
                total=_money(stats["total"], data["currency"]),
                transaction_count=stats["count"],
            )
            for name, stats in sorted(
                data["categories"].items(),
                key=lambda item: item[1]["total"],
                reverse=True,
            )
        ]
        results.append(MonthlyCategoryBreakdownOut(month=month, categories=categories))
    return results


@router.get("/{statement_id}", response_model=StatementDetail)
async def get_statement(
    statement_id: str,
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Statement).where(Statement.id == statement_id)
    row = (await session.execute(stmt)).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Statement not found")

    em_stmt = select(EmiItem).where(EmiItem.statement_id == statement_id)
    emi_rows = (await session.execute(em_stmt)).scalars().all()

    tx_stmt = select(Transaction).where(Transaction.statement_id == statement_id)
    tx_rows = (await session.execute(tx_stmt)).scalars().all()

    detail = StatementDetail(**_statement_to_out(row).model_dump())
    detail.emi_items = [_emi_to_out(emi) for emi in emi_rows]
    detail.transactions = [
        {
            "id": tx.id,
            "ts": tx.ts,
            "amount": {"value": tx.amount_value, "currency": tx.amount_currency},
            "type": tx.txn_type,
            "merchant": {"raw": tx.merchant_raw, "normalized": tx.merchant_normalized},
            "channel": tx.channel,
            "location": tx.location,
            "reference": tx.reference,
        }
        for tx in tx_rows
    ]
    return detail


def _money(value: Optional[float], currency: Optional[str]) -> Optional[MoneyOut]:
    if value is None or currency is None:
        return None
    return MoneyOut(value=value, currency=currency)


def _sum_money(rows, value_field: str, currency_field: str) -> Optional[MoneyOut]:
    total = 0.0
    currency = None
    for row in rows:
        value = getattr(row, value_field, None)
        row_currency = getattr(row, currency_field, None)
        if value is None or row_currency is None:
            continue
        if currency is None:
            currency = row_currency
        if row_currency != currency:
            continue
        total += float(value)
    if currency is None:
        return None
    return MoneyOut(value=total, currency=currency)


def _categorize_merchant(merchant: Optional[str]) -> str:
    if not merchant:
        return "Other"
    text = merchant.lower()
    rules = {
        "Groceries": ["grocery", "supermarket", "mart", "bigbasket", "blinkit"],
        "Dining": ["restaurant", "cafe", "coffee", "swiggy", "zomato"],
        "Travel": ["uber", "ola", "air", "airline", "hotel", "irctc", "makemytrip"],
        "Fuel": ["fuel", "petrol", "diesel", "bpcl", "hpcl", "iocl"],
        "Utilities": ["electric", "water", "gas", "broadband", "internet", "utility"],
        "Shopping": ["amazon", "flipkart", "myntra", "ajio"],
        "Subscriptions": ["netflix", "spotify", "prime", "subscription"],
        "Healthcare": ["pharmacy", "hospital", "clinic", "medical"],
        "Insurance": ["insurance", "policy", "premium"],
        "Cash/ATM": ["atm", "cash withdrawal"],
        "Transfer": ["imps", "neft", "upi", "transfer"],
    }
    for category, keywords in rules.items():
        if any(keyword in text for keyword in keywords):
            return category
    return "Other"


def _statement_to_out(row: Statement) -> StatementOut:
    return StatementOut(
        id=row.id,
        account_type=row.account_type or "credit_card",
        source=row.source,
        object_key=row.object_key,
        issuer=row.issuer,
        instrument=row.instrument,
        statement_date=row.statement_date,
        due_date=row.due_date,
        period_start=row.period_start,
        period_end=row.period_end,
        total_due=_money(row.total_due_value, row.total_due_currency),
        minimum_due=_money(row.minimum_due_value, row.minimum_due_currency),
        opening_balance=_money(row.opening_balance_value, row.opening_balance_currency),
        closing_balance=_money(row.closing_balance_value, row.closing_balance_currency),
        total_credits=_money(row.total_credits_value, row.total_credits_currency),
        total_debits=_money(row.total_debits_value, row.total_debits_currency),
        finance_charges=_money(row.finance_charges_value, row.finance_charges_currency),
    )


def _emi_to_out(item: EmiItem) -> EmiOut:
    return EmiOut(
        id=item.id,
        description=item.description,
        total_amount=_money(item.total_amount_value, item.total_amount_currency),
        monthly_installment=_money(
            item.monthly_installment_value, item.monthly_installment_currency
        ),
        tenure_months=item.tenure_months,
        remaining_months=item.remaining_months,
    )
