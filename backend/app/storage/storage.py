import os
import uuid
import shutil
from pathlib import Path
from typing import Optional
from app.core.config import settings


class StorageBackend:
    """Local filesystem storage backend."""

    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path or settings.MODEL_STORAGE_PATH)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _get_user_path(self, user_id: str) -> Path:
        user_path = self.base_path / user_id
        user_path.mkdir(parents=True, exist_ok=True)
        return user_path

    def _get_model_path(self, user_id: str, model_id: str) -> Path:
        model_path = self._get_user_path(user_id) / model_id
        model_path.mkdir(parents=True, exist_ok=True)
        return model_path

    def save_file(
        self,
        user_id: str,
        model_id: str,
        filename: str,
        file_data: bytes
    ) -> str:
        """Save file to storage. Returns stored filename."""
        model_path = self._get_model_path(user_id, model_id)
        stored_filename = f"{uuid.uuid4()}_{filename}"
        file_path = model_path / stored_filename

        with open(file_path, "wb") as f:
            f.write(file_data)

        return stored_filename

    def save_file_stream(self, user_id: str, model_id: str, filename: str, chunk_generator):
        """Save file from stream (for large files). Returns stored filename."""
        model_path = self._get_model_path(user_id, model_id)
        stored_filename = f"{uuid.uuid4()}_{filename}"
        file_path = model_path / stored_filename

        with open(file_path, "wb") as f:
            for chunk in chunk_generator:
                f.write(chunk)

        return stored_filename

    def get_file(self, user_id: str, model_id: str, filename: str) -> Optional[bytes]:
        """Get file from storage. Returns None if not found."""
        model_path = self._get_model_path(user_id, model_id)
        file_path = model_path / filename

        if not file_path.exists():
            return None

        with open(file_path, "rb") as f:
            return f.read()

    def get_file_stream(self, user_id: str, model_id: str, filename: str):
        """Get file as stream (for large files)."""
        model_path = self._get_model_path(user_id, model_id)
        file_path = model_path / filename

        if not file_path.exists():
            return None

        def _iter_chunks():
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk

        return _iter_chunks()

    def delete_file(self, user_id: str, model_id: str, filename: str) -> bool:
        """Delete file from storage. Returns True if deleted, False if not found."""
        model_path = self._get_model_path(user_id, model_id)
        file_path = model_path / filename

        if not file_path.exists():
            return False

        file_path.unlink()

        # Clean up empty directories
        try:
            model_path.rmdir()
        except OSError:
            pass

        try:
            user_path = model_path.parent
            user_path.rmdir()
        except OSError:
            pass

        return True

    def file_exists(self, user_id: str, model_id: str, filename: str) -> bool:
        """Check if file exists."""
        model_path = self._get_model_path(user_id, model_id)
        file_path = model_path / filename
        return file_path.exists()

    def get_file_size(self, user_id: str, model_id: str, filename: str) -> Optional[int]:
        """Get file size in bytes."""
        model_path = self._get_model_path(user_id, model_id)
        file_path = model_path / filename

        if not file_path.exists():
            return None

        return file_path.stat().st_size


# Singleton instance
storage = StorageBackend()
