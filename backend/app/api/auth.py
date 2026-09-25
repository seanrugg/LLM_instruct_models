import uuid
import time
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.models.models import User
from app.schemas import (
    UserRegister,
    UserLogin,
    TokenResponse,
    UserResponse,
    AuthConfigResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Login throttle: username -> list of timestamps
_login_attempts: dict[str, list[float]] = defaultdict(list)
THROTTLE_MAX_ATTEMPTS = 5
THROTTLE_WINDOW_SECONDS = 15 * 60  # 15 minutes


@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config():
    """Get authentication configuration (public)."""
    return AuthConfigResponse(
        allow_registration=settings.ALLOW_REGISTRATION
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    """Register a new user (if registration is enabled)."""
    # Check if registration is enabled
    if not settings.ALLOW_REGISTRATION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is disabled"
        )

    # Check if username exists
    result = await db.execute(select(User).where(User.username == user_data.username))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # Check if email exists
    if user_data.email:
        result = await db.execute(select(User).where(User.email == user_data.email))
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )

    # Create new user
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password)
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user


@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin, db: AsyncSession = Depends(get_db)):
    """Login and get access token."""
    # Check login throttle
    now = time.time()
    attempts = _login_attempts[credentials.username]

    # Remove attempts outside the window
    _login_attempts[credentials.username] = [
        t for t in attempts if now - t < THROTTLE_WINDOW_SECONDS
    ]
    attempts = _login_attempts[credentials.username]

    if len(attempts) >= THROTTLE_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later."
        )

    # Find user
    result = await db.execute(select(User).where(User.username == credentials.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(credentials.password, user.password_hash):
        # Record failed attempt
        _login_attempts[credentials.username].append(now)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create token
    access_token = create_access_token(data={"sub": str(user.id)})

    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )
