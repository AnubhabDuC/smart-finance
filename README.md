# Smart Finance (Finance Agent MVP)

End-to-end ingestion + extraction pipeline for financial statements, with a FastAPI backend, a Redis-based worker, and a Next.js dashboard. The system supports manual PDF uploads, dedup/reupload correction, statement summaries, and analytics views for credit card activity.

## What this project does

1. Manual PDF upload (UI or API).
2. File stored in S3/MinIO.
3. Redis queue triggers the ingestion worker.
4. Worker extracts statement summary + transactions + EMI items.
5. Results are persisted to Postgres.
6. Dashboard reads from API and renders summaries, charts, and history.

## Monorepo layout

- `apps/server` - FastAPI server, ingestion worker, extraction pipeline, DB models.
- `apps/web` - Next.js frontend (dashboard UI).
- `infra` - Docker Compose for Postgres, Redis, MinIO.
- `packages/python` - Shared python package placeholder.

## Quick start

### 1) Start infra services

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2) Backend (FastAPI)

```bash
cd apps/server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
set -a && source .env && set +a
uvicorn app.main:app --reload
```

### 3) Worker

```bash
cd apps/server
source .venv/bin/activate
set -a && source .env && set +a
python -m app.workers.ingest_worker
```

### 4) Frontend

```bash
cd apps/web
npm install
npm run dev
```

If port 3000 is already in use, Next.js will pick 3001. To force 3000:

```bash
PORT=3000 npm run dev
```

## Environment variables

Backend example: `apps/server/.env.example`

```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/finance
REDIS_URL=redis://localhost:6379/0
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=financeadmin
S3_SECRET_KEY=changeMeNow_2024
S3_BUCKET=finance-raw
S3_REGION=us-east-1
LLM_PROVIDER=heuristic
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=
OPENAI_TIMEOUT_SECONDS=120
OPENAI_MAX_RETRIES=2
```

Frontend example: `apps/web/.env.example`

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Note: the current UI uses a hardcoded `API_BASE` in `apps/web/app/page.tsx`. If you want to use `NEXT_PUBLIC_API_URL`, update the UI to read the env var.

## API overview

Core endpoints:

- `GET /health`
- `POST /v1/ingest/upload` (multipart form: `file`, `source`, `external_id`)
- `GET /v1/statements`
- `GET /v1/transactions`
- `GET /v1/statements/summary/*`
- `GET /v1/ingest-events`
- `GET /v1/ingest-events/{artifact_id}/details`
- `POST /v1/ingest-events/{artifact_id}/rollback`

Debug/testing:

- `GET /v1/schema` - JSON schema snapshot from SQLAlchemy models.
- `GET /v1/debug/db-preview` - Sample rows from key tables.

## Database schema

Source of truth lives in `apps/server/app/db.py`:

- `statements`
- `transactions`
- `emi_items`
- `artifacts`
- `ingest_events`

The schema is auto-created on app startup via `init_db()`.

### Query the DB via psql

```bash
docker compose -f infra/docker-compose.yml exec db psql -U postgres -d finance
```

Inside psql:

```sql
\dt
SELECT * FROM statements LIMIT 5;
SELECT * FROM transactions LIMIT 5;
```

## Extraction pipeline

- Default is **heuristic** extraction.
- Optional **LLM** extraction (OpenAI/Anthropic) controlled by `LLM_PROVIDER`.
- The worker auto-dedups transactions using a hash and logs `dedup_skip`.
- Reuploads clear the prior statement/transactions for that artifact and log `reupload_reset`.

## Frontend overview

The UI is currently built in a single file for speed of iteration:

- `apps/web/app/page.tsx` - main dashboard (manual upload, ingestion history, summaries, charts, modals).
- `apps/web/app/layout.tsx` - root layout wrapper.

As the project matures, this should be split into components, hooks, and styles.

## Sample data

Sample PDFs live in:

- `apps/server/tests/sample1.pdf`
- `apps/server/tests/sample2.pdf`

## Testing

Backend tests (optional):

```bash
cd apps/server
pytest
```

## Notes

- OCR is not yet implemented (planned later).
- If LLM extraction fails or times out, it falls back to heuristic parsing.

