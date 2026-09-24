import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from typing import Optional
from app.core.database import get_db
from app.models.models import User, Model
from app.schemas import ModelCreate, ModelUpdate, ModelResponse, ModelListResponse, SearchResponse
from app.storage.storage import storage
from app.core.config import settings

router = APIRouter(prefix="/models", tags=["models"])


def get_current_user(current_user_id: uuid.UUID = Depends(lambda: None)):
    """Dependency to get current user from JWT token."""
    return current_user_id


@router.get("/", response_model=ModelListResponse)
async def list_models(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    framework: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """List all models with pagination."""
    # Build query
    query = select(Model)
    count_query = select(func.count(Model.id))

    if search:
        like_condition = or_(
            Model.name.ilike(f"%{search}%"),
            Model.description.ilike(f"%{search}%"),
        )
        query = query.where(like_condition)
        count_query = count_query.where(like_condition)

    if framework:
        query = query.where(Model.framework == framework)
        count_query = count_query.where(Model.framework == framework)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get page
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


@router.get("/search", response_model=SearchResponse)
async def search_models(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db)
):
    """Search models by name or description."""
    query = select(Model).where(
        or_(
            Model.name.ilike(f"%{q}%"),
            Model.description.ilike(f"%{q}%"),
        )
    ).order_by(Model.created_at.desc())

    result = await db.execute(query)
    models = result.scalars().all()

    return SearchResponse(
        items=[ModelResponse.model_validate(m) for m in models],
        total=len(models)
    )


@router.get("/{model_id}", response_model=ModelResponse)
async def get_model(model_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Get model details."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    return model


@router.post("/", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    model_data: ModelCreate,
    current_user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new model entry."""
    new_model = Model(
        owner_id=current_user_id,
        name=model_data.name,
        description=model_data.description,
        version=model_data.version,
        tags=model_data.tags,
        framework=model_data.framework,
        filename=""  # Will be set on upload
    )
    db.add(new_model)
    await db.commit()
    await db.refresh(new_model)

    return new_model


@router.put("/{model_id}", response_model=ModelResponse)
async def update_model(
    model_id: uuid.UUID,
    model_data: ModelUpdate,
    current_user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update model metadata."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    if model.owner_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this model"
        )

    # Update fields
    update_data = model_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(model, field, value)

    await db.commit()
    await db.refresh(model)

    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a model and its files."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    if model.owner_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this model"
        )

    # Delete files
    if model.filename:
        storage.delete_file(str(model.owner_id), str(model_id), model.filename)

    # Delete from database
    await db.delete(model)
    await db.commit()

    return None


@router.post("/{model_id}/upload")
async def upload_model_file(
    model_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Upload a model file."""
    # Check model exists and belongs to user
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    if model.owner_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to upload to this model"
        )

    # Check file extension
    file_ext = f".{file.filename.rsplit('.', 1)[-1].lower()}" if '.' in file.filename else ""
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}"
        )

    # Read file data
    file_data = await file.read()

    # Check size
    if len(file_data) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE_MB}MB"
        )

    # Save file
    stored_filename = storage.save_file(
        str(current_user_id),
        str(model_id),
        file.filename,
        file_data
    )

    # Update model metadata
    model.filename = stored_filename
    model.original_filename = file.filename
    model.content_type = file.content_type
    model.size_bytes = len(file_data)
    await db.commit()

    return {
        "message": "File uploaded successfully",
        "filename": stored_filename,
        "size": len(file_data)
    }


@router.get("/{model_id}/download")
async def download_model_file(
    model_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Download a model file."""
    # Check model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    if not model.filename:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No file uploaded for this model"
        )

    # Get file
    file_data = storage.get_file(
        str(model.owner_id),
        str(model_id),
        model.filename
    )

    if not file_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found in storage"
        )

    from fastapi.responses import Response
    return Response(
        content=file_data,
        media_type=model.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename=\"{model.original_filename or model.filename}\""
        }
    )
