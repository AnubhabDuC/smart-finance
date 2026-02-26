"""
Fallback heuristic extractor.

This keeps the ingestion worker functional even without an LLM provider.  The
logic is intentionally simple: decode bytes, pick a few key numbers/strings, and
populate the Extracted schema.  Once an LLM integration is selected, this class
can still serve for unit tests or offline dev.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Dict, Optional

from ..schema import Extracted, Merchant, Money, Txn
from ..utils import (
    classify_statement_pages,
    extract_pdf_pages_text,
    extract_pdf_text,
    is_pdf,
    split_statement_sections,
)
from .base import BaseExtractor


class HeuristicExtractor(BaseExtractor):
    def extract(
        self,
        *,
        content: bytes,
        source: str,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Extracted:
        metadata = metadata or {}
        text = _safe_decode(content)
        txns = _extract_transactions(content, source, metadata)
        if not txns:
            amount = _detect_amount(text)
            merchant_name = _detect_merchant(text, metadata)
            txns = [
                Txn(
                    type="debit" if amount >= 0 else "credit",
                    amount=Money(value=abs(amount)),
                    timestamp_iso=_detect_timestamp(text),
                    merchant=Merchant(
                        raw=merchant_name,
                        normalized=_normalize_merchant(merchant_name),
                    ),
                    channel=_guess_channel(source),
                )
            ]
        return Extracted(
            doc_type=_guess_doc_type(source, metadata),
            issuer=_detect_issuer(text),
            instrument=_detect_instrument(text),
            txns=txns,
            confidence=_estimate_confidence(text),
            notes=_build_notes(text),
        )


def _safe_decode(content: bytes) -> str:
    if is_pdf(content):
        pages = extract_pdf_pages_text(content)
        sections = split_statement_sections(pages)
        combined = "\n\n".join(
            part
            for part in [
                sections.get("summary", ""),
                sections.get("transactions", ""),
                sections.get("emi", ""),
            ]
            if part
        )
        return combined or extract_pdf_text(content)
    for encoding in ("utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return repr(content[:160])


def _extract_transactions(
    content: bytes,
    source: str,
    metadata: Dict[str, str],
) -> list[Txn]:
    if is_pdf(content):
        pages = extract_pdf_pages_text(content)
        sections = classify_statement_pages(pages)
        txn_text = "\n".join([text for _, text in sections["transactions"]]).strip()
        if not txn_text:
            txn_text = "\n".join(pages)
    else:
        txn_text = _safe_decode(content)

    txns: list[Txn] = []
    for line in txn_text.splitlines():
        parsed = _parse_txn_line(line)
        if not parsed:
            continue
        ts, amount, merchant_raw, txn_type = parsed
        txns.append(
            Txn(
                type=txn_type,
                amount=Money(value=amount),
                timestamp_iso=ts,
                merchant=Merchant(
                    raw=merchant_raw,
                    normalized=_normalize_merchant(merchant_raw),
                ),
                channel=_guess_channel(source),
            )
        )
    return txns


def _parse_txn_line(line: str):
    line = line.strip()
    if not line:
        return None
    match = re.match(
        r"^(?P<date>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(?P<body>.+?)\s+(?P<amount>[0-9,]+(?:\.\d{1,2})?)\s*(?P<cr>CR)?$",
        line,
        re.IGNORECASE,
    )
    if not match:
        return None
    ts = _parse_date(match.group("date"))
    if not ts:
        return None
    amount = float(match.group("amount").replace(",", ""))
    txn_type = "credit" if match.group("cr") else "debit"
    merchant_raw = _clean_merchant(match.group("body"))
    if not merchant_raw:
        merchant_raw = "UNKNOWN"
    return ts, amount, merchant_raw, txn_type


def _parse_date(value: str):
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _clean_merchant(text: str) -> str:
    cleaned = re.sub(r"^\d+\s+", "", text)
    cleaned = re.sub(r"\s+\d+\s*$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _detect_amount(text: str) -> float:
    match = re.search(r"([0-9]+(?:[.,][0-9]{2})?)", text)
    if match:
        return float(match.group(1).replace(",", ""))
    return 0.0


def _detect_merchant(text: str, metadata: Dict[str, str]) -> Optional[str]:
    patterns = (
        r"(?:from)\s+([A-Za-z0-9 &*-]+?)(?=[.,\n]|$)",
        r"(?:to)\s+([A-Za-z0-9 &*-]+?)(?=[.,\n]|$)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            candidate_lower = candidate.lower()
            for stop in (" on ", " at ", " for "):
                idx = candidate_lower.find(stop)
                if idx != -1:
                    candidate = candidate[:idx]
                    break
            return candidate
    filename = metadata.get("filename")
    if filename:
        stem = filename.rsplit(".", 1)[0]
        if stem:
            return stem
    return None


def _normalize_merchant(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    cleaned = name.strip().upper()
    return re.sub(r"\s+", " ", cleaned)


def _detect_timestamp(text: str) -> datetime:
    now = datetime.now(timezone.utc)
    match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        try:
            return datetime.fromisoformat(match.group(1)).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return now


def _guess_channel(source: str) -> Optional[str]:
    mapping = {
        "gmail": "ECOM",
        "manual": "OTHER",
        "android": "SMS",
        "ios": "ECOM",
    }
    return mapping.get(source.lower(), "OTHER")


def _guess_doc_type(source: str, metadata: Dict[str, str]) -> str:
    if source.lower() == "gmail":
        return "bank_email"
    filename = metadata.get("filename", "")
    if filename.endswith(".pdf"):
        return "statement_page"
    return "ecommerce_receipt"


def _detect_issuer(text: str) -> Optional[str]:
    for issuer in ("HDFC", "ICICI", "SBI", "AMEX", "AXIS", "KOTAK"):
        if issuer in text.upper():
            return issuer
    return None


def _detect_instrument(text: str) -> Optional[str]:
    match = re.search(r"(card\s+ending\s+in\s+\d{4})", text, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def _estimate_confidence(text: str) -> float:
    return 0.8 if len(text.strip()) > 10 else 0.3


def _build_notes(text: str) -> str:
    preview = text.strip().splitlines()
    preview_text = " ".join(preview[:2]) if preview else ""
    return f"heuristic parser preview: {preview_text[:200]}"
