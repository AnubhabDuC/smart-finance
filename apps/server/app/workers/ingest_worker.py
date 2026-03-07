import asyncio
import hashlib
import json
import boto3
import os
from datetime import datetime
from uuid import uuid4

import redis.asyncio as redis
from redis.exceptions import ConnectionError, TimeoutError
from botocore.exceptions import ClientError

from ..settings import settings
from ..core.env import require_env
from ..extract.pipeline import parse_document
from sqlalchemy import delete, select

from ..db import (
    Artifact,
    EmiItem,
    IngestEvent,
    Statement,
    Transaction,
    SessionLocal,
    init_db,
)

QUEUE_KEY = "ingest:queue"


async def process_job(payload: dict, s3_client, bucket: str):
    key = payload["object_key"]
    try:
        obj = s3_client.get_object(Bucket=bucket, Key=key)
        data = obj["Body"].read()
        metadata = obj.get("Metadata", {})
        print(f"[worker] downloaded {key} ({len(data)} bytes)")

        file_hash = payload.get("file_hash") or hashlib.sha256(data).hexdigest()

        extraction = parse_document(
            data,
            source=payload.get("source", "manual"),
            metadata=metadata,
        )
        for txn in extraction.txns:
            print(
                "[worker] extracted",
                f"merchant={txn.merchant.raw or txn.merchant.normalized} "
                f"amount={txn.amount.value} {txn.amount.currency} "
                f"timestamp={txn.timestamp_iso.isoformat()} "
                f"confidence={extraction.confidence}",
            )
        if extraction.statement:
            stmt = extraction.statement
            print(
                "[worker] statement summary",
                f"total_due={_fmt_money(stmt.total_due)} "
                f"minimum_due={_fmt_money(stmt.minimum_due)} "
                f"due_date={_fmt_dt(stmt.due_date)} "
                f"opening_balance={_fmt_money(stmt.opening_balance)} "
                f"closing_balance={_fmt_money(stmt.closing_balance)} "
                f"emi_items={len(stmt.emi_items)}",
            )
        await _persist_extraction(payload, extraction, file_hash)
    except ClientError as exc:
        print(f"[worker] failed to download {key}: {exc}")
    except Exception as exc:  # pragma: no cover - debugging aid
        print(f"[worker] extract error for {key}: {exc}")


async def _persist_extraction(payload: dict, extraction, file_hash: str):
    user_id = payload.get("user_id")
    statement_id = None
    async with SessionLocal() as session:
        artifact = await _get_or_create_artifact(session, payload, file_hash, user_id)
        await _log_event(
            session,
            artifact.id,
            user_id,
            "ingest_received",
            f"source={payload.get('source')} object_key={payload.get('object_key')}",
        )
        await _handle_reupload(session, artifact.id, user_id)

        if extraction.statement:
            statement_id = str(uuid4())
            stmt = extraction.statement
            statement = Statement(
                id=statement_id,
                user_id=user_id,
                account_type="credit_card",
                artifact_id=artifact.id,
                source=payload.get("source", "manual"),
                object_key=payload["object_key"],
                external_id=payload.get("external_id"),
                issuer=extraction.issuer,
                instrument=extraction.instrument,
                statement_date=stmt.statement_date,
                due_date=stmt.due_date,
                period_start=stmt.period_start,
                period_end=stmt.period_end,
                total_due_value=stmt.total_due.value if stmt.total_due else None,
                total_due_currency=stmt.total_due.currency if stmt.total_due else None,
                minimum_due_value=stmt.minimum_due.value if stmt.minimum_due else None,
                minimum_due_currency=(
                    stmt.minimum_due.currency if stmt.minimum_due else None
                ),
                opening_balance_value=(
                    stmt.opening_balance.value if stmt.opening_balance else None
                ),
                opening_balance_currency=(
                    stmt.opening_balance.currency if stmt.opening_balance else None
                ),
                closing_balance_value=(
                    stmt.closing_balance.value if stmt.closing_balance else None
                ),
                closing_balance_currency=(
                    stmt.closing_balance.currency if stmt.closing_balance else None
                ),
                total_credits_value=(
                    stmt.total_credits.value if stmt.total_credits else None
                ),
                total_credits_currency=(
                    stmt.total_credits.currency if stmt.total_credits else None
                ),
                total_debits_value=(
                    stmt.total_debits.value if stmt.total_debits else None
                ),
                total_debits_currency=(
                    stmt.total_debits.currency if stmt.total_debits else None
                ),
                finance_charges_value=(
                    stmt.finance_charges.value if stmt.finance_charges else None
                ),
                finance_charges_currency=(
                    stmt.finance_charges.currency if stmt.finance_charges else None
                ),
                notes=extraction.notes,
            )
            session.add(statement)

            for item in stmt.emi_items:
                session.add(
                    EmiItem(
                        id=str(uuid4()),
                        statement_id=statement_id,
                        description=item.description,
                        total_amount_value=(
                            item.total_amount.value if item.total_amount else None
                        ),
                        total_amount_currency=(
                            item.total_amount.currency if item.total_amount else None
                        ),
                        monthly_installment_value=(
                            item.monthly_installment.value
                            if item.monthly_installment
                            else None
                        ),
                        monthly_installment_currency=(
                            item.monthly_installment.currency
                            if item.monthly_installment
                            else None
                        ),
                        tenure_months=item.tenure_months,
                        remaining_months=item.remaining_months,
                    )
                )

        for txn in extraction.txns:
            txn_hash = _hash_txn(
                txn.timestamp_iso.isoformat(),
                txn.amount.value,
                txn.amount.currency,
                txn.merchant.normalized or txn.merchant.raw or "",
            )
            if await _is_duplicate(session, user_id, txn_hash):
                await _log_event(
                    session,
                    artifact.id,
                    user_id,
                    "dedup_skip",
                    f"txn_hash={txn_hash}",
                )
                continue
            session.add(
                Transaction(
                    id=str(uuid4()),
                    user_id=user_id,
                    statement_id=statement_id,
                    account_type="credit_card",
                    artifact_id=artifact.id,
                    transaction_hash=txn_hash,
                    source=payload.get("source", "manual"),
                    object_key=payload["object_key"],
                    external_id=payload.get("external_id"),
                    ts=txn.timestamp_iso,
                    amount_value=txn.amount.value,
                    amount_currency=txn.amount.currency,
                    txn_type=txn.type,
                    merchant_raw=txn.merchant.raw,
                    merchant_normalized=txn.merchant.normalized,
                    channel=txn.channel,
                    location=txn.location,
                    reference=txn.reference,
                )
            )
        await _log_event(
            session,
            artifact.id,
            user_id,
            "ingest_complete",
            (
                f"transactions={len(extraction.txns)} "
                "emis="
                f"{len(extraction.statement.emi_items) if extraction.statement else 0}"
            ),
        )
        await session.commit()


async def worker_loop():
    await init_db()
    bucket = require_env("S3_BUCKET")
    s3_client = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=require_env("S3_ACCESS_KEY"),
        aws_secret_access_key=require_env("S3_SECRET_KEY"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
    )
    while True:
        try:
            client = redis.from_url(settings.redis_url, decode_responses=True)
            await client.ping()
            print("[worker] connected to", settings.redis_url)
            print("[worker] listening for jobs on", QUEUE_KEY)

            while True:
                job_raw = await client.lpop(QUEUE_KEY)
                if not job_raw:
                    break
                job = json.loads(job_raw)
                job["received_at"] = datetime.utcnow().isoformat()
                await process_job(job, s3_client, bucket)

            while True:
                response = await client.brpop(QUEUE_KEY, timeout=30)
                if not response:
                    continue
                _, job_raw = response
                job = json.loads(job_raw)
                job["received_at"] = datetime.utcnow().isoformat()
                await process_job(job, s3_client, bucket)
        except (ConnectionError, TimeoutError) as exc:
            print(f"[worker] redis unavailable ({exc}); retrying...")
            await asyncio.sleep(2)


def _fmt_money(money) -> str:
    if money is None:
        return "n/a"
    return f"{money.value} {money.currency}"


def _fmt_dt(dt) -> str:
    if dt is None:
        return "n/a"
    return dt.isoformat()


async def _get_or_create_artifact(
    session, payload: dict, file_hash: str, user_id: str | None
) -> Artifact:
    stmt = select(Artifact).where(Artifact.file_hash == file_hash)
    if user_id:
        stmt = stmt.where(Artifact.user_id == user_id)
    else:
        stmt = stmt.where(Artifact.user_id.is_(None))
    existing = (await session.execute(stmt)).scalars().first()
    if existing:
        existing.object_key = payload["object_key"]
        existing.source = payload.get("source", "manual")
        existing.external_id = payload.get("external_id")
        existing.status = "reuploaded"
        return existing
    artifact = Artifact(
        id=str(uuid4()),
        user_id=user_id,
        file_hash=file_hash,
        object_key=payload["object_key"],
        source=payload.get("source", "manual"),
        external_id=payload.get("external_id"),
        status="received",
    )
    session.add(artifact)
    return artifact


async def _handle_reupload(session, artifact_id: str, user_id: str | None) -> None:
    stmt = select(Transaction).where(Transaction.artifact_id == artifact_id)
    if user_id:
        stmt = stmt.where(Transaction.user_id == user_id)
    else:
        stmt = stmt.where(Transaction.user_id.is_(None))
    existing_txn = (await session.execute(stmt)).scalars().first()
    if not existing_txn:
        return
    await session.execute(
        delete(EmiItem).where(
            EmiItem.statement_id.in_(
                select(Statement.id).where(
                    Statement.artifact_id == artifact_id,
                    Statement.user_id == user_id,
                )
            )
        )
    )
    await session.execute(
        delete(Transaction).where(
            Transaction.artifact_id == artifact_id, Transaction.user_id == user_id
        )
    )
    await session.execute(
        delete(Statement).where(
            Statement.artifact_id == artifact_id, Statement.user_id == user_id
        )
    )
    await _log_event(
        session,
        artifact_id,
        user_id,
        "reupload_reset",
        "Cleared existing data for reupload",
    )


def _hash_txn(ts: str, amount: float, currency: str, merchant: str) -> str:
    base = f"{ts}|{amount:.2f}|{currency}|{merchant.lower()}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


async def _is_duplicate(session, user_id: str | None, txn_hash: str) -> bool:
    stmt = select(Transaction.id).where(
        Transaction.transaction_hash == txn_hash, Transaction.user_id == user_id
    )
    exists = (await session.execute(stmt)).scalars().first()
    return bool(exists)


async def _log_event(
    session,
    artifact_id: str | None,
    user_id: str | None,
    event_type: str,
    message: str,
) -> None:
    session.add(
        IngestEvent(
            id=str(uuid4()),
            artifact_id=artifact_id,
            user_id=user_id,
            event_type=event_type,
            message=message,
        )
    )


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    asyncio.run(worker_loop())
