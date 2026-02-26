"""
OpenAI-powered extractor.

This implementation expects the `openai` Python package and a valid API key.
It constructs a JSON schema request so the response can be validated against
`Extracted`.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, Iterable, Optional

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency
    OpenAI = None

try:  # pragma: no cover - optional dependency
    from openai import APITimeoutError
except Exception:  # pragma: no cover - openai versions vary
    APITimeoutError = ()

from ..schema import Extracted
from ..llm_extractor import SYSTEM_PROMPT
from ..utils import classify_statement_pages, extract_pdf_pages_text, is_pdf
from .base import BaseExtractor


class OpenAIExtractor(BaseExtractor):
    def __init__(
        self, *, api_key: str, model: str, timeout_seconds: int, max_retries: int
    ):
        if OpenAI is None:
            raise RuntimeError(
                "The openai package is required for the OpenAI provider. "
                "Install it via `pip install openai`."
            )
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for the OpenAI provider.")
        self.client = OpenAI(
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=max_retries,
        )
        self.model = model

    def extract(
        self,
        *,
        content: bytes,
        source: str,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Extracted:
        metadata = metadata or {}
        schema = Extracted.model_json_schema()
        sections = _prepare_sections(content, metadata)
        extracts = []
        for section_name, payloads in sections:
            for payload in payloads:
                extracts.extend(
                    _call_with_fallback(
                        self.client,
                        self.model,
                        payload,
                        schema,
                        section_name,
                    )
                )
        merged = _merge_extracts(extracts)
        return Extracted.model_validate(merged)


def _prepare_sections(
    content: bytes, metadata: Dict[str, str]
) -> list[tuple[str, list[str]]]:
    name = metadata.get("filename", "document")
    source_hint = metadata.get("source_hint", "unknown")
    if is_pdf(content):
        pages = extract_pdf_pages_text(content)
        sections = classify_statement_pages(pages)
        summary_blocks = _format_page_blocks(sections["summary"])
        txn_blocks = _chunk_page_blocks(sections["transactions"])
        emi_blocks = _format_page_blocks(sections["emi"])
        return [
            (
                "summary",
                (
                    [
                        f"{_doc_header(name, source_hint)}\nSTATEMENT SUMMARY:\n{summary_blocks}"
                    ]
                    if summary_blocks
                    else []
                ),
            ),
            (
                "transactions",
                [
                    f"{_doc_header(name, source_hint)}\nTRANSACTIONS:\n{block}"
                    for block in txn_blocks
                ],
            ),
            (
                "emi",
                (
                    [
                        f"{_doc_header(name, source_hint)}\nEMI / LOAN SECTION:\n{emi_blocks}"
                    ]
                    if emi_blocks
                    else []
                ),
            ),
        ]
    else:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1", errors="replace")
        return [("document", [f"{_doc_header(name, source_hint)}\n{text}"])]


def _doc_header(name: str, source_hint: str) -> str:
    return f"Filename: {name}\nSource: {source_hint}"


def _format_page_blocks(pages: list[tuple[int, str]]) -> str:
    if not pages:
        return ""
    return "\n\n".join([f"[page {idx}]\n{text}" for idx, text in pages])


def _chunk_page_blocks(
    pages: list[tuple[int, str]],
    *,
    max_chars: int = 3500,
) -> list[str]:
    if not pages:
        return []
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for idx, text in pages:
        block = f"[page {idx}]\n{text}\n"
        if current and size + len(block) > max_chars:
            chunks.append("".join(current).strip())
            current = []
            size = 0
        current.append(block)
        size += len(block)
    if current:
        chunks.append("".join(current).strip())
    return chunks


def _call_model(client, model: str, text: str, schema: dict, section: str) -> dict:
    section_hint = _section_hint(section)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{section_hint}\n\n{text}"},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "Extracted", "schema": schema},
        },
    )
    output_fragment = response.choices[0].message.content
    if isinstance(output_fragment, str):
        output = output_fragment
    else:
        output = output_fragment[0]["text"]
    return json.loads(output)


def _call_with_fallback(
    client,
    model: str,
    text: str,
    schema: dict,
    section: str,
) -> list[dict]:
    try:
        return [_call_model(client, model, text, schema, section)]
    except Exception as exc:
        if not _is_timeout(exc):
            raise
        fallback_chunks = _split_payload(text, section)
        results = []
        for chunk in fallback_chunks:
            results.append(_call_model(client, model, chunk, schema, section))
        return results


def _is_timeout(exc: Exception) -> bool:
    if isinstance(exc, APITimeoutError):
        return True
    message = str(exc).lower()
    return "timed out" in message or "timeout" in message


def _split_payload(text: str, section: str) -> list[str]:
    marker_map = {
        "summary": "STATEMENT SUMMARY:",
        "transactions": "TRANSACTIONS:",
        "emi": "EMI / LOAN SECTION:",
    }
    marker = marker_map.get(section, "")
    header = ""
    body = text
    if marker and marker in text:
        header, body = text.split(marker, 1)
        header = f"{header}{marker}\n"
    chunks = _chunk_text_lines(body, max_chars=1800)
    if not chunks:
        return [text]
    return [f"{header}{chunk}" for chunk in chunks]


def _chunk_text_lines(text: str, *, max_chars: int = 1800) -> list[str]:
    lines = [line for line in text.splitlines() if line.strip()]
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for line in lines:
        line_len = len(line) + 1
        if current and size + line_len > max_chars:
            chunks.append("\n".join(current).strip())
            current = []
            size = 0
        current.append(line)
        size += line_len
    if current:
        chunks.append("\n".join(current).strip())
    return chunks


def _section_hint(section: str) -> str:
    if section == "summary":
        return (
            "SECTION: STATEMENT SUMMARY ONLY.\n"
            "Extract statement fields and EMI items if present. "
            "If there are no transactions here, return txns as an empty list."
        )
    if section == "transactions":
        return (
            "SECTION: TRANSACTIONS ONLY.\n"
            "Extract all real transactions in the statement period. "
            "Ignore examples/illustrations or interest calculation demos. "
            "If no statement summary fields are present, leave them null."
        )
    if section == "emi":
        return (
            "SECTION: EMI / LOAN DETAILS ONLY.\n"
            "Extract EMI items; transactions may be empty."
        )
    return "SECTION: DOCUMENT"


def _merge_extracts(extracts: Iterable[dict]) -> dict:
    merged: dict = {}
    merged_txns = []
    seen = set()
    statement = {}
    for extract in extracts:
        for key in (
            "doc_type",
            "issuer",
            "instrument",
            "confidence",
            "notes",
            "schema_version",
        ):
            if key in extract and extract.get(key) is not None:
                merged.setdefault(key, extract[key])
        for txn in extract.get("txns", []):
            normalized = _normalize_txn(txn, extract.get("statement") or {})
            if not normalized:
                continue
            dedupe_key = (
                normalized.get("timestamp_iso"),
                normalized.get("amount", {}).get("value"),
                (normalized.get("merchant", {}) or {}).get("normalized")
                or (normalized.get("merchant", {}) or {}).get("raw"),
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            merged_txns.append(normalized)
        chunk_statement = extract.get("statement") or {}
        if chunk_statement:
            if "emi_items" in chunk_statement:
                statement.setdefault("emi_items", []).extend(
                    chunk_statement["emi_items"]
                )
            for field, value in chunk_statement.items():
                if field == "emi_items":
                    continue
                if value is not None and field not in statement:
                    statement[field] = value
    merged["txns"] = merged_txns
    if statement:
        merged["statement"] = statement
    merged = _filter_txns_by_period(merged)
    return merged


def _normalize_txn(txn: dict, statement: dict) -> Optional[dict]:
    if not isinstance(txn, dict):
        return None
    normalized = dict(txn)
    if "timestamp_iso" not in normalized:
        for alt in ("timestamp", "date", "txn_date"):
            if alt in normalized:
                normalized["timestamp_iso"] = normalized.pop(alt)
                break
    if "type" not in normalized:
        normalized["type"] = "debit"

    amount = normalized.get("amount")
    if amount is None:
        value = normalized.pop("amount_value", None)
        if value is None:
            value = normalized.pop("value", None)
        if value is not None:
            normalized["amount"] = {
                "value": float(value),
                "currency": normalized.pop("currency", "INR"),
            }
    elif isinstance(amount, dict):
        amount.setdefault("currency", "INR")
    else:
        normalized["amount"] = {"value": float(amount), "currency": "INR"}

    if "timestamp_iso" not in normalized:
        fallback = statement.get("statement_date") or statement.get("due_date")
        if fallback:
            normalized["timestamp_iso"] = fallback

    if (
        "timestamp_iso" not in normalized
        or "amount" not in normalized
        or "type" not in normalized
    ):
        return None
    return normalized


def _filter_txns_by_period(data: dict) -> dict:
    statement = data.get("statement") or {}
    start = statement.get("period_start")
    end = statement.get("period_end")
    if not start or not end:
        return data
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except Exception:
        return data
    filtered = []
    for txn in data.get("txns", []):
        try:
            ts = datetime.fromisoformat(
                str(txn.get("timestamp_iso")).replace("Z", "+00:00")
            )
        except Exception:
            continue
        if start_dt <= ts <= end_dt:
            filtered.append(txn)
    data["txns"] = filtered
    return data
