from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import boto3
from botocore.exceptions import ClientError
from .core.env import require_env
from .db import init_db

app = FastAPI(title="Finance Agent – Server", version="0.1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- S3/MinIO bucket bootstrap on startup ---
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_ACCESS_KEY = require_env("S3_ACCESS_KEY")
S3_SECRET_KEY = require_env("S3_SECRET_KEY")
S3_BUCKET = require_env("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

s3_client = None

def ensure_bucket():
    global s3_client
    s3_client = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
    )
    # Create bucket if missing
    existing = [b["Name"] for b in s3_client.list_buckets().get("Buckets", [])]
    if S3_BUCKET not in existing:
        s3_client.create_bucket(Bucket=S3_BUCKET)
        # Optional: enable versioning (safer for receipts)
        s3_client.put_bucket_versioning(
            Bucket=S3_BUCKET,
            VersioningConfiguration={"Status": "Enabled"}
        )

@app.on_event("startup")
async def on_startup():
    try:
        ensure_bucket()
        print(f"[bootstrap] MinIO bucket ensured: s3://{S3_BUCKET}")
    except ClientError as e:
        # Non-fatal: app still runs; but uploads will fail until fixed.
        print("[bootstrap] MinIO bootstrap error:", e)
    await init_db()

@app.get("/health")
async def health():
    return {"ok": True, "bucket": S3_BUCKET}

# Mount routers here (transactions, analytics, auth)
from .routers.ingest import router as ingest_router
from .routers.transactions import router as tx_router
from .routers.statements import router as statements_router
from .routers.ingest_events import router as ingest_events_router
from .routers.schema import router as schema_router
from .routers.debug import router as debug_router
app.include_router(ingest_router, prefix="/v1/ingest", tags=["ingestion"])
app.include_router(tx_router, prefix="/v1/transactions", tags=["transactions"])
app.include_router(statements_router, prefix="/v1/statements", tags=["statements"])
app.include_router(ingest_events_router, prefix="/v1/ingest-events", tags=["ingest-events"])
app.include_router(schema_router, prefix="/v1/schema", tags=["schema"])
app.include_router(debug_router, prefix="/v1/debug", tags=["debug"])
