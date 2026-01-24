from datetime import datetime, timezone
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.extract.pipeline import parse_document


def test_parse_document_basic_email():
    body = (
        "Transaction alert!\n"
        "Paid INR 1234.56 to SuperMart on 2024-01-15.\n"
        "Card ending in 4242"
    ).encode("utf-8")

    result = parse_document(
        body,
        source="gmail",
        metadata={"filename": "alert-email.txt"},
    )

    assert result.doc_type == "bank_email"
    assert len(result.txns) == 1
    txn = result.txns[0]
    assert txn.amount.value == 1234.56
    assert txn.channel == "ECOM"
    assert txn.merchant.normalized == "SUPERMART"
    assert txn.timestamp_iso.date() == datetime(
        2024, 1, 15, tzinfo=timezone.utc
    ).date()
