import os
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
from app.core.security import create_download_token, decode_download_token
from app.api.deps import get_current_user

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=ModelListResponse)
async def list_models(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    framework: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all models with pagination (auth required)."""
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Search models by name or description (auth required)."""
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
async def get_model(
    model_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get model details (auth required)."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    return model


@router.post("", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    model_data: ModelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new model entry."""
    new_model = Model(
        owner_id=current_user.id,
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
    current_user: User = Depends(get_current_user),
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

    if model.owner_id != current_user.id:
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
    current_user: User = Depends(get_current_user),
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

    if model.owner_id != current_user.id:
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Upload a model file (streaming)."""
    # Check model exists and belongs to user
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model not found"
        )

    if model.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to upload to this model"
        )

    # Sanitize filename
    original_filename = file.filename or "unknown"
    # Strip path components and quotes
    original_filename = os.path.basename(original_filename).strip('"').strip("'")
    if not original_filename:
        original_filename = "unknown"

    # Check file extension
    file_ext = f".{original_filename.rsplit('.', 1)[-1].lower()}" if '.' in original_filename else ""
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}"
        )

    # Open temp file for streaming
    temp_path, stored_filename = storage.open_temp(
        str(current_user.id),
        str(model_id),
        original_filename
    )

    # Stream upload
    byte_count = 0
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    try:
        with open(temp_path, "wb") as f:
            while True:
                chunk = await file.read(8 * 1024 * 1024)  # 8 MB chunks
                if not chunk:
                    break

                byte_count += len(chunk)
                f.write(chunk)

                # Check size limit
                if byte_count > max_bytes:
                    temp_path.unlink()  # Delete partial file
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE_MB}MB"
                    )
    except HTTPException:
        raise
    except Exception as e:
        # Clean up temp file on error
        if temp_path.exists():
            temp_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )

    # Commit temp file to final location
    if byte_count == 0:
        temp_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file"
        )

    final_filename = storage.commit_temp(temp_path, str(current_user.id), str(model_id), stored_filename)

    # Delete old file if model already had one
    if model.filename:
        storage.delete_file(str(current_user.id), str(model_id), model.filename)

    # Update model metadata
    model.filename = final_filename
    model.original_filename = original_filename
    model.content_type = file.content_type or "application/octet-stream"
    model.size_bytes = byte_count
    await db.commit()

    return {
        "message": "File uploaded successfully",
        "filename": final_filename,
        "size": byte_count
    }


@router.post("/{model_id}/download-token")
async def generate_download_token(
    model_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate a short-lived download token (auth required)."""
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

    # Create download token
    token = create_download_token(str(current_user.id), model_id)

    return {
        "download_token": token,
        "expires_in_minutes": settings.DOWNLOAD_TOKEN_EXPIRE_MINUTES
    }


@router.get("/{model_id}/download")
async def download_model_file(
    model_id: uuid.UUID,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Download a model file (token required)."""
    # Validate download token
    payload = decode_download_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired download token"
        )

    # Verify model ID matches token
    if payload["mid"] != str(model_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Download token does not match this model"
        )

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

    # Get file path
    file_path = storage.get_file_path(
        str(model.owner_id),
        str(model_id),
        model.filename
    )

    if file_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found in storage"
        )

    from fastapi.responses import FileResponse
    from starlette.responses import Response

    # Check if range requests are supported (Starlette >= 0.14.1)
    # For now, serve as FileResponse with range support
    return FileResponse(
        path=str(file_path),
        filename=model.original_filename or model.filename,
        media_type=model.content_type or "application/octet-stream",
        headers={
            "Content-Length": str(file_path.stat().st_size),
            "Accept-Ranges": "bytes"
        }
    )
