from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    APP_NAME: str = "LLM Instruct Models Repository"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./llm_models.db"

    # JWT
    JWT_SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60

    # Storage
    MODEL_STORAGE_PATH: str = "./models"
    MAX_UPLOAD_SIZE_MB: int = 50000  # 50GB default

    # Allowed file extensions
    ALLOWED_EXTENSIONS: list = [
        ".gguf", ".pt", ".pth", ".safetensors", ".onnx",
        ".tar", ".zip", ".gz", ".bin"
    ]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
