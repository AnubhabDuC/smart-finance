# Smart Finance (Finance Agent MVP)

End-to-end ingestion and extraction pipeline for financial statements:

1. Upload statement PDF (UI or API).
2. Store original file in MinIO (S3-compatible).
3. Push ingestion job to Redis queue.
4. Worker extracts statement summary, transactions, and EMI items.
5. Persist normalized data in Postgres.
6. Render analytics in a Next.js dashboard.

## Monorepo layout

- `apps/server` - FastAPI API, worker, extract pipeline, DB models.
- `apps/web` - Next.js dashboard UI.
- `infra` - Docker Compose stack (Postgres, Redis, MinIO).
- `packages/python` - placeholder shared package.

## Prerequisites

- Docker Desktop (with `docker compose`)
- Python `3.11` (recommended for current pinned dependencies)
- Node.js `18+` and npm
- Git

## Environment setup

Example env files are committed and should be copied locally.

### macOS / Linux

```bash
cp infra/.env.example infra/.env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

### Windows (Git Bash)

```bash
cp infra/.env.example infra/.env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

If copy fails because files do not exist in your local clone, pull latest changes from GitHub first.

## Start the project

### 1) Start infra services

From repo root:

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

### 2) Start backend API (FastAPI)

#### macOS / Linux

```bash
cd apps/server
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
set -a && source .env && set +a
python -m uvicorn app.main:app --reload
```

#### Windows (Git Bash)

```bash
cd apps/server
py -3.11 -m venv .venv
source .venv/Scripts/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
set -a && source .env && set +a
python -m uvicorn app.main:app --reload
```

### 3) Start ingestion worker

Open a second terminal:

#### macOS / Linux

```bash
cd apps/server
source .venv/bin/activate
set -a && source .env && set +a
python -m app.workers.ingest_worker
```

#### Windows (Git Bash)

```bash
cd apps/server
source .venv/Scripts/activate
set -a && source .env && set +a
python -m app.workers.ingest_worker
```

### 4) Start frontend (Next.js)

Open a third terminal:

```bash
cd apps/web
npm install
npm run dev -- -p 3000
```

Open `http://localhost:3000`.

## Quick verification

- API health:

```bash
curl http://127.0.0.1:8000/health
```

- Upload sample file:

```bash
curl -X POST http://127.0.0.1:8000/v1/ingest/upload \
  -F "file=@apps/server/tests/sample1.pdf" \
  -F "source=manual" \
  -F "external_id=test-sample-1"
```

- Check ingestion events:

```bash
curl "http://127.0.0.1:8000/v1/ingest-events?limit=20"
```

## Key API endpoints

- `GET /health`
- `POST /v1/ingest/upload`
- `GET /v1/transactions`
- `GET /v1/statements`
- `GET /v1/statements/summary/totals`
- `GET /v1/statements/summary/by-month`
- `GET /v1/statements/summary/credits-debits-by-month`
- `GET /v1/statements/summary/top-merchants-by-month`
- `GET /v1/statements/summary/categories-by-month`
- `GET /v1/ingest-events`
- `GET /v1/ingest-events/{artifact_id}/details`
- `POST /v1/ingest-events/{artifact_id}/rollback`
- `GET /v1/schema`
- `GET /v1/debug/db-preview`

## Database tables

Defined in `apps/server/app/db.py`:

- `statements`
- `transactions`
- `emi_items`
- `artifacts`
- `ingest_events`

Inspect quickly:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U postgres -d finance
```

Then in `psql`:

```sql
\dt
SELECT * FROM statements LIMIT 5;
SELECT * FROM transactions LIMIT 5;
SELECT * FROM emi_items LIMIT 5;
SELECT * FROM artifacts LIMIT 5;
SELECT * FROM ingest_events ORDER BY created_at DESC LIMIT 10;
```

## Extraction behavior

- Default provider: `LLM_PROVIDER=heuristic`
- Optional LLM provider: `openai`
- On LLM timeout or model failure, worker falls back to heuristic extraction
- Reupload flow clears prior artifact-linked rows and records history events
- Dedup logic skips duplicate transactions and logs skip events

## Common setup issues

- `ModuleNotFoundError: redis` or `boto3`

  - Ensure `python -m pip install -r apps/server/requirements.txt` completed successfully.

- `Address already in use` (port 8000 / 3000)

  - Stop the old process or choose a different port.

- Windows `npm` errors (`EPERM` / `'next' is not recognized`)

  - Remove `apps/web/node_modules`, reinstall with `npm install`, run `npm run dev -- -p 3000`.

- Python 3.14 install failures for pinned packages
  - Use Python 3.11 for now.

## Development quality checks

From repo root:

```bash
pre-commit run --all-files
```

If hooks auto-fix files, run it again, then commit:

```bash
git add -A
git commit -m "fix(ci): apply pre-commit fixes"
```
