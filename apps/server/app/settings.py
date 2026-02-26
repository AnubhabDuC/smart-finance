from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/finance"
    llm_provider: str = "heuristic"
    llm_model: str = "gpt-5-mini-2025-08-07"  # gpt-5-mini-2025-08-07

    openai_api_key: Optional[str] = None
    openai_timeout_seconds: int = 120
    openai_max_retries: int = 2
    anthropic_api_key: Optional[str] = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "allow"


settings = Settings()
