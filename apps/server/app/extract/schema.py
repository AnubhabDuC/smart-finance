from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from datetime import datetime

class Money(BaseModel):
    value: float
    currency: Literal["INR","USD","EUR","GBP"] = "INR"

class Merchant(BaseModel):
    raw: Optional[str] = None
    normalized: Optional[str] = None

class Txn(BaseModel):
    type: Literal["debit","credit","hold","reversal","refund"]
    amount: Money
    timestamp_iso: datetime
    merchant: Merchant = Merchant()
    reference: Optional[str] = None
    channel: Optional[Literal["UPI","POS","ECOM","ATM","IMPS","NEFT","CARD","OTHER"]] = None
    location: Optional[str] = None

class EmiItem(BaseModel):
    description: Optional[str] = None
    total_amount: Optional[Money] = None
    monthly_installment: Optional[Money] = None
    tenure_months: Optional[int] = None
    remaining_months: Optional[int] = None

class StatementSummary(BaseModel):
    statement_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    total_due: Optional[Money] = None
    minimum_due: Optional[Money] = None
    opening_balance: Optional[Money] = None
    closing_balance: Optional[Money] = None
    total_credits: Optional[Money] = None
    total_debits: Optional[Money] = None
    finance_charges: Optional[Money] = None
    emi_items: List[EmiItem] = []

class Extracted(BaseModel):
    schema_version: Literal["1.2"] = "1.2"
    doc_type: Literal["bank_sms","bank_email","ecommerce_receipt","statement_page"]
    issuer: Optional[str] = None
    instrument: Optional[str] = None
    txns: List[Txn]
    statement: Optional[StatementSummary] = None
    balances: Optional[dict] = None
    confidence: float = Field(ge=0, le=1, default=0.0)
    notes: Optional[str] = None
