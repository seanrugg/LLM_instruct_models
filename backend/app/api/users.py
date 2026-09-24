import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.models import User, Model
from app.schemas import UserResponse, ModelResponse, ModelListResponse

router = APIRouter(prefix="/users", tags=["users"])


async def get_current_user_id(authorization: str) -> uuid.UUID:
    """Dependency to extract current user ID from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )

    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)

    if payload is None or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

    try:
        return uuid.UUID(payload["sub"])
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format"
        )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user_id: uuid.UUID = Depends(get_current_user_id)):
    """Get current user profile."""
    return UserResponse(
        id=current_user_id,
        username="",  # Would need to fetch from DB
        email=None,
        created_at=None
    )


@router.get("/{user_id}/models", response_model=ModelListResponse)
async def get_user_models(
    user_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get all models for a user."""
    from sqlalchemy import func

    # Check user exists
    result = await db.execute(select(User).where(User.id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Get models
    query = select(Model).where(Model.owner_id == user_id)
    count_query = select(func.count(Model.id)).where(Model.owner_id == user_id)

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    query = query.order_by(Model.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    models = result.scalars().all()

    return ModelListResponse(
        items=[ModelResponse.model_validate(m) for m in models],
        total=total,
        page=page,
        page_size=page_size
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Delete a user account (must be self or admin)."""
    if user_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only delete your own account"
        )

    # Delete user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    await db.delete(user)
    await db.commit()

    return None
