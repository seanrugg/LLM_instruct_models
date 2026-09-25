from typing import Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # App
    APP_NAME: str = "LLM Instruct Models Repository"
    APP_VERSION: str = "0.2.0"
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

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173"

    # Registration
    ALLOW_REGISTRATION: bool = False

    # Admin bootstrap
    ADMIN_USERNAME: Optional[str] = None
    ADMIN_PASSWORD: Optional[str] = None
    ADMIN_EMAIL: Optional[str] = None

    # Download tokens
    DOWNLOAD_TOKEN_EXPIRE_MINUTES: int = 5

    # Upload temp directory
    UPLOAD_TMP_DIR: Optional[str] = None

    # Allowed file extensions
    ALLOWED_EXTENSIONS: list = [
        ".gguf", ".pt", ".pth", ".safetensors", ".onnx",
        ".tar", ".zip", ".gz", ".bin"
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str) -> list[str]:
        """Parse comma-separated CORS origins into a list."""
        if isinstance(v, list):
            return v
        return [origin.strip() for origin in v.split(",") if origin.strip()]

    @field_validator("UPLOAD_TMP_DIR", mode="before")
    @classmethod
    def set_upload_tmp_dir(cls, v: Optional[str], info) -> Optional[str]:
        """Default UPLOAD_TMP_DIR to MODEL_STORAGE_PATH/.tmp if not set."""
        if v is None:
            model_storage = info.data.get("MODEL_STORAGE_PATH", "./models")
            return f"{model_storage}/.tmp"
        return v


settings = Settings()
