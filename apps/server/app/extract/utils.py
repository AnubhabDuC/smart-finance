from __future__ import annotations

from io import BytesIO
import re
from typing import Dict, List, Tuple


def is_pdf(content: bytes) -> bool:
    return content[:4] == b"%PDF"


def extract_pdf_text(content: bytes) -> str:
    pages = extract_pdf_pages_text(content)
    return "\n".join(pages).strip()


def extract_pdf_pages_text(content: bytes) -> List[str]:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "pdfplumber is required to extract PDF text. "
            "Install it via `pip install pdfplumber`."
        ) from exc

    text_parts = []
    with pdfplumber.open(BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text_parts.append(page_text.strip())
    return text_parts


def classify_statement_pages(pages: List[str]) -> Dict[str, List[Tuple[int, str]]]:
    summary_pages: List[Tuple[int, str]] = []
    txn_pages: List[Tuple[int, str]] = []
    emi_pages: List[Tuple[int, str]] = []

    for idx, text in enumerate(pages, start=1):
        upper = text.upper()
        if not text:
            continue

        if _looks_like_noise_page(upper):
            continue

        if _looks_like_emi_section(upper):
            emi_pages.append((idx, text))
            continue

        if _looks_like_summary_section(upper):
            summary_pages.append((idx, text))
            continue

        if _looks_like_transaction_page(upper, text):
            txn_pages.append((idx, text))
            continue

    return {
        "summary": summary_pages,
        "transactions": txn_pages,
        "emi": emi_pages,
    }


def split_statement_sections(pages: List[str]) -> Dict[str, str]:
    sections = classify_statement_pages(pages)
    summary_parts = [f"[page {idx}]\n{text}" for idx, text in sections["summary"]]
    txn_parts = [f"[page {idx}]\n{text}" for idx, text in sections["transactions"]]
    emi_parts = [f"[page {idx}]\n{text}" for idx, text in sections["emi"]]
    return {
        "summary": "\n\n".join(summary_parts),
        "transactions": "\n\n".join(txn_parts),
        "emi": "\n\n".join(emi_parts),
    }


def _looks_like_transaction_page(upper: str, text: str) -> bool:
    header_signals = [
        "DATE",
        "TRANSACTION",
        "PARTICULARS",
        "DESCRIPTION",
        "AMOUNT",
        "DEBIT",
        "CREDIT",
        "DR",
        "CR",
    ]
    has_header = sum(1 for key in header_signals if key in upper) >= 3
    date_count = len(re.findall(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", text))
    amount_count = len(re.findall(r"\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\b", text))
    return has_header or (date_count >= 4 and amount_count >= 6)


def _looks_like_summary_section(upper: str) -> bool:
    markers = [
        "STATEMENT SUMMARY",
        "SUMMARY OF ACCOUNT",
        "TOTAL AMOUNT DUE",
        "PAYMENT DUE DATE",
        "STATEMENT DATE",
    ]
    return any(marker in upper for marker in markers)


def _looks_like_emi_section(upper: str) -> bool:
    markers = [
        "EMI / PERSONAL LOAN",
        "EMI / PERSONAL LOAN ON CREDIT CARD",
        "EMI SCHEDULE",
        "EMI DETAILS",
        "LOAN ON CREDIT CARD",
    ]
    return any(marker in upper for marker in markers)


def _looks_like_noise_page(upper: str) -> bool:
    markers = [
        "IMPORTANT INFORMATION",
        "IMPORTANT INFORMATION ON YOUR CREDIT CARD",
        "INTEREST CALCULATION",
        "ILLUSTRATION",
        "METHOD OF PAYMENT",
        "HOW TO PAY",
        "CUSTOMER CARE",
        "CHARGES WILL BE LEVIED",
        "BENEFITS",
        "MOST IMPORTANT TERMS AND CONDITIONS",
        "TERMS AND CONDITIONS",
        "MITC",
    ]
    return any(marker in upper for marker in markers)
