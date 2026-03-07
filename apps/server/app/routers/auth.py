from __future__ import annotations

import secrets
from datetime import datetime
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..db import User, get_session
from ..settings import settings

router = APIRouter()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20)


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


async def _verify_google_id_token(id_token: str) -> dict:
    if not settings.google_oauth_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on server",
        )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": id_token},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google token verification failed: {exc}",
        ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google ID token",
        )

    claims = response.json()
    aud = claims.get("aud")
    email = claims.get("email")
    email_verified = claims.get("email_verified")

    if not isinstance(aud, str) or not secrets.compare_digest(
        aud, settings.google_oauth_client_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google token audience mismatch",
        )

    if not isinstance(email, str) or not email.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google token missing email",
        )

    if str(email_verified).lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified",
        )

    return claims


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_session),
):
    email = payload.email.strip().lower()
    existing_stmt = select(User).where(User.email == email)
    existing = (await session.execute(existing_stmt)).scalars().first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    user = User(
        id=str(uuid4()),
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip() if payload.full_name else None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(
        access_token=token,
        user=UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            created_at=user.created_at,
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_session),
):
    email = payload.email.strip().lower()
    stmt = select(User).where(User.email == email)
    user = (await session.execute(stmt)).scalars().first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(
        access_token=token,
        user=UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            created_at=user.created_at,
        ),
    )


@router.post("/google", response_model=AuthResponse)
async def google_login(
    payload: GoogleLoginRequest,
    session: AsyncSession = Depends(get_session),
):
    claims = await _verify_google_id_token(payload.id_token)
    email = claims["email"].strip().lower()
    name = claims.get("name")

    stmt = select(User).where(User.email == email)
    user = (await session.execute(stmt)).scalars().first()
    if not user:
        user = User(
            id=str(uuid4()),
            email=email,
            password_hash=hash_password(uuid4().hex),
            full_name=name.strip() if isinstance(name, str) and name.strip() else None,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    elif not user.full_name and isinstance(name, str) and name.strip():
        user.full_name = name.strip()
        await session.commit()
        await session.refresh(user)

    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(
        access_token=token,
        user=UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            created_at=user.created_at,
        ),
    )


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        created_at=current_user.created_at,
    )
