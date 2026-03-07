# Smart Finance

Multi-tenant finance ingestion and analytics app (FastAPI + worker + Next.js).

## What It Does

1. User signs in (email/password or Google OAuth).
2. User uploads statement PDF.
3. File is stored in MinIO (S3-compatible).
4. Ingest job is pushed to Redis queue.
5. Worker extracts statement summary, transactions, and EMI items.
6. Data is persisted in Postgres, scoped by user.
7. Dashboard renders totals, trends, category breakdown, top merchants, and ingest history.

## Current Capabilities

- User auth and tenancy:
  - `POST /v1/auth/register`
  - `POST /v1/auth/login`
  - `POST /v1/auth/google`
  - `GET /v1/auth/me`
- Bearer-token protected APIs for ingest, transactions, statements, ingest history, debug preview.
- Ingestion pipeline:
  - PDF upload to object store
  - Queueing in Redis
  - Async worker processing
  - Dedup + reupload correction
  - Ingest event history and rollback
- Dashboard features:
  - Statement totals and monthly summaries
  - Credit/debit monthly view
  - Top merchants by month
  - Category breakdown with pie chart + drilldown modal
  - Ingestion history panel + detailed modal
  - Manual upload progress/status
  - Reset all data action (per signed-in user)
- Debug/admin:
  - User-scoped DB preview
  - Global DB preview behind `X-Debug-Key`

## Repo Layout

- `apps/server`: FastAPI API + worker + extraction + DB models
- `apps/web`: Next.js app router frontend
- `infra`: Docker compose for Postgres/Redis/MinIO
- `packages/python`: placeholder shared package

## Prerequisites

- Docker Desktop with `docker compose`
- Python `3.11`
- Node.js `18+` and npm
- Git

## Environment Setup

From repo root:

```bash
cp infra/.env.example infra/.env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

Important:

- Backend settings load from `apps/server/.env` only.
- Frontend public envs load from `apps/web/.env.local`.
- Do not commit real secrets (`.env`, `.env.local`).

### Server env (key fields)

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `AUTH_SECRET_KEY`
- `AUTH_TOKEN_TTL_MINUTES`
- `GOOGLE_OAUTH_CLIENT_ID` (required for Google sign-in)
- `DEBUG_ADMIN_KEY` (required for `/v1/debug/db-preview/all`)
- `OPENAI_API_KEY` (if `LLM_PROVIDER=openai`)

### Web env (key fields)

- `NEXT_PUBLIC_API_URL` (usually `http://127.0.0.1:8000`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (for Google sign-in button)

## Run Locally

### 1) Start infra

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

### 2) Start backend API

```bash
cd apps/server
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
set -a && source .env && set +a
python -m uvicorn app.main:app --reload
```

### 3) Start worker (new terminal)

```bash
cd apps/server
source .venv/bin/activate
set -a && source .env && set +a
python -m app.workers.ingest_worker
```

### 4) Start web app (new terminal)

```bash
cd apps/web
npm install
npm run dev -- -p 3000
```

Open `http://localhost:3000`.

## Google OAuth Setup

This app uses Google Identity Services ID token flow. Only **client ID** is needed (no client secret in this flow).

1. Google Cloud Console -> APIs & Services -> Credentials.
2. Create OAuth client: **Web application**.
3. Add authorized JavaScript origins:
   - `http://localhost:3000`
   - `http://localhost:3001` (optional if port fallback is used)
4. Set same client ID in:
   - `apps/server/.env` -> `GOOGLE_OAUTH_CLIENT_ID=...`
   - `apps/web/.env.local` -> `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...`
5. Restart backend and web.

If you see `invalid_client`, client ID or origin config is wrong.

## API Quickstart

### Health

```bash
curl http://127.0.0.1:8000/health
```

### Register

```bash
curl -X POST http://127.0.0.1:8000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"Password123!","full_name":"Demo User"}'
```

### Login and store token

```bash
curl -X POST http://127.0.0.1:8000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"Password123!"}'
```

Use returned token:

```bash
export TOKEN="paste_access_token_here"
```

### Upload PDF

```bash
curl -X POST http://127.0.0.1:8000/v1/ingest/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@apps/server/tests/sample1.pdf" \
  -F "source=manual" \
  -F "external_id=test-sample-1"
```

### Read user-scoped ingest events

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/v1/ingest-events?limit=20"
```

### Read user-scoped DB preview

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/v1/debug/db-preview?limit=10&events_limit=20"
```

### Read global DB preview (admin)

```bash
curl -H "X-Debug-Key: your-debug-key" \
  "http://127.0.0.1:8000/v1/debug/db-preview/all?limit=20&events_limit=50"
```

Note: `X-Debug-Key` must be an HTTP header, not query param.

### Reset all data for signed-in user

```bash
curl -X POST http://127.0.0.1:8000/v1/debug/reset-all \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm_text":"DELETE_EVERYTHING"}'
```

## Main Endpoints

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/google`
- `GET /v1/auth/me`
- `POST /v1/ingest/upload`
- `GET /v1/transactions`
- `GET /v1/statements`
- `GET /v1/statements/summary/totals`
- `GET /v1/statements/summary/by-month`
- `GET /v1/statements/summary/by-transaction-month`
- `GET /v1/statements/summary/credits-debits-by-month`
- `GET /v1/statements/summary/top-merchants-by-month`
- `GET /v1/statements/summary/categories-by-month`
- `GET /v1/ingest-events`
- `GET /v1/ingest-events/{artifact_id}/details`
- `POST /v1/ingest-events/{artifact_id}/rollback`
- `POST /v1/debug/reset-all`
- `GET /v1/debug/db-preview`
- `GET /v1/debug/db-preview/all`
- `GET /v1/schema`

## Database Tables

Defined in `apps/server/app/db.py`:

- `users`
- `statements`
- `transactions`
- `emi_items`
- `artifacts`
- `ingest_events`

Inspect via psql:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U postgres -d finance
```

Inside psql:

```sql
\dt
SELECT * FROM users LIMIT 5;
SELECT * FROM statements LIMIT 5;
SELECT * FROM transactions LIMIT 5;
SELECT * FROM emi_items LIMIT 5;
SELECT * FROM artifacts LIMIT 5;
SELECT * FROM ingest_events ORDER BY created_at DESC LIMIT 10;
```

## Common Troubleshooting

- `Address already in use` for API:
  - `lsof -nP -iTCP:8000 -sTCP:LISTEN`
  - `kill -9 <PID>`
- Worker not consuming:
  - Verify API and worker use same `REDIS_URL`.
  - Verify worker terminal loaded `apps/server/.env`.
- `Google OAuth is not configured on server`:
  - `GOOGLE_OAUTH_CLIENT_ID` missing in `apps/server/.env`.
- `401 Invalid debug admin key`:
  - Send `X-Debug-Key` header, match `DEBUG_ADMIN_KEY` in server `.env`.
- Windows setup:
  - Use Python `3.11`.
  - Use Command Prompt or PowerShell syntax for env vars.
  - Ensure `npm` and `node` are installed and in PATH.

## Dev Workflow

Local quality checks:

```bash
pre-commit run --all-files
```

Typical Git flow:

1. Branch from `main`: `git checkout -b feat/your-change`
2. Commit: `git commit -m "feat(scope): message"`
3. Push: `git push -u origin feat/your-change`
4. Open PR to `main`
5. Wait for CI + review
6. Merge PR
