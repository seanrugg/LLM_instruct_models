import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# Auth Schemas
class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[str] = None
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: Optional[str] = None
    is_admin: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[str] = None
    password: str = Field(..., min_length=6)
    is_admin: bool = False


class AuthConfigResponse(BaseModel):
    allow_registration: bool


# Model Schemas
class ModelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    version: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = None
    framework: Optional[str] = Field(None, max_length=50)


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    version: Optional[str] = None
    tags: Optional[List[str]] = None
    framework: Optional[str] = None


class ModelResponse(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: Optional[str] = None
    version: Optional[str] = None
    tags: Optional[List[str]] = None
    framework: Optional[str] = None
    size_bytes: Optional[int] = None
    filename: str
    original_filename: Optional[str] = None
    content_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ModelListResponse(BaseModel):
    items: List[ModelResponse]
    total: int
    page: int
    page_size: int


class SearchResponse(BaseModel):
    items: List[ModelResponse]
    total: int
