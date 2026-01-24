# Placeholder: wire your preferred LLM client with JSON mode
from .schema import Extracted

SYSTEM_PROMPT = """You extract finance transaction data from SMS/emails/statements.
- Output STRICT JSON for the provided schema. No prose.
- Populate *all* transactions found in the document into the `txns` list.
- When the document is a statement, also populate `statement` fields like total_due,
  minimum_due, due_date, statement_date, period_start/period_end, opening/closing
  balance, finance charges, and any EMI items.
- Ignore examples/illustrations or interest calculation demos; only extract actual
  posted transactions in the statement period.
- Prefer the actual spend amount over limits/balances.
- Use ISO datetime with timezone if present; else assume sender timezone.
- If unsure, set confidence <= 0.6 and add 'notes'."""

def extract(message_text: str) -> Extracted:
    # TODO: call your LLM with a schema/tool-calling API and return Extracted
    raise NotImplementedError("Wire an LLM client here (OpenAI/Anthropic/etc).")
