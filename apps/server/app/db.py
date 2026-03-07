from __future__ import annotations

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .settings import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Statement(Base):
    __tablename__ = "statements"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    account_type: Mapped[str] = mapped_column(String(32), default="credit_card")
    artifact_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("artifacts.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(512))
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    issuer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(128), nullable=True)
    statement_date: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    due_date: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    period_start: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    period_end: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    total_due_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_due_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    minimum_due_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    minimum_due_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    opening_balance_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    opening_balance_currency: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )
    closing_balance_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    closing_balance_currency: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )
    total_credits_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_credits_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    total_debits_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_debits_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    finance_charges_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    finance_charges_currency: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="statement")
    emis: Mapped[list["EmiItem"]] = relationship(back_populates="statement")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    statement_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("statements.id"), nullable=True
    )
    account_type: Mapped[str] = mapped_column(String(32), default="credit_card")
    artifact_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("artifacts.id"), nullable=True
    )
    transaction_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source: Mapped[str] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(512))
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ts: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    amount_value: Mapped[float] = mapped_column(Float)
    amount_currency: Mapped[str] = mapped_column(String(8))
    txn_type: Mapped[str] = mapped_column(String(16))
    merchant_raw: Mapped[str | None] = mapped_column(String(256), nullable=True)
    merchant_normalized: Mapped[str | None] = mapped_column(String(256), nullable=True)
    channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    statement: Mapped["Statement | None"] = relationship(back_populates="transactions")


class EmiItem(Base):
    __tablename__ = "emi_items"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    statement_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("statements.id")
    )
    description: Mapped[str | None] = mapped_column(String(256), nullable=True)
    total_amount_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_amount_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    monthly_installment_value: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    monthly_installment_currency: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )
    tenure_months: Mapped[int | None] = mapped_column(nullable=True)
    remaining_months: Mapped[int | None] = mapped_column(nullable=True)

    statement: Mapped["Statement"] = relationship(back_populates="emis")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    file_hash: Mapped[str] = mapped_column(String(128))
    object_key: Mapped[str] = mapped_column(String(512))
    source: Mapped[str] = mapped_column(String(64))
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="received")
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class IngestEvent(Base):
    __tablename__ = "ingest_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    artifact_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("artifacts.id"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(32))
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                "ALTER TABLE statements "
                "ADD COLUMN IF NOT EXISTS account_type "
                "VARCHAR(32) DEFAULT 'credit_card'"
            )
        )
        await conn.execute(
            text("ALTER TABLE statements " "ADD COLUMN IF NOT EXISTS artifact_id UUID")
        )
        await conn.execute(
            text("ALTER TABLE statements " "ADD COLUMN IF NOT EXISTS user_id UUID")
        )
        await conn.execute(
            text(
                "ALTER TABLE statements "
                "ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE statements "
                "ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE transactions "
                "ADD COLUMN IF NOT EXISTS account_type "
                "VARCHAR(32) DEFAULT 'credit_card'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE transactions " "ADD COLUMN IF NOT EXISTS artifact_id UUID"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE transactions "
                "ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(128)"
            )
        )
        await conn.execute(
            text("ALTER TABLE transactions " "ADD COLUMN IF NOT EXISTS user_id UUID")
        )
        await conn.execute(
            text("ALTER TABLE artifacts " "ADD COLUMN IF NOT EXISTS user_id UUID")
        )
        await conn.execute(
            text(
                "ALTER TABLE artifacts "
                "DROP CONSTRAINT IF EXISTS artifacts_file_hash_key"
            )
        )
        await conn.execute(
            text("ALTER TABLE ingest_events " "ADD COLUMN IF NOT EXISTS user_id UUID")
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_transactions_hash "
                "ON transactions (transaction_hash)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_transactions_user_hash "
                "ON transactions (user_id, transaction_hash)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_statements_user_id "
                "ON statements (user_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_transactions_user_id "
                "ON transactions (user_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_artifacts_user_id "
                "ON artifacts (user_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_artifacts_user_file_hash "
                "ON artifacts (user_id, file_hash)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_ingest_events_user_id "
                "ON ingest_events (user_id)"
            )
        )
        await conn.execute(
            text(
                "UPDATE statements SET account_type='credit_card' "
                "WHERE account_type IS NULL"
            )
        )
        await conn.execute(
            text(
                "UPDATE transactions SET account_type='credit_card' "
                "WHERE account_type IS NULL"
            )
        )


async def get_session():
    async with SessionLocal() as session:
        yield session
