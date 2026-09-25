import os
import uuid
import shutil
from pathlib import Path
from typing import Optional, BinaryIO
from app.core.config import settings


class StorageBackend:
    """Local filesystem storage backend."""

    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path or settings.MODEL_STORAGE_PATH)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.tmp_path = Path(settings.UPLOAD_TMP_DIR or f"{self.base_path}/.tmp")
        self.tmp_path.mkdir(parents=True, exist_ok=True)

    def _get_user_path(self, user_id: str) -> Path:
        """Get user directory path (creates if needed)."""
        user_path = self.base_path / user_id
        user_path.mkdir(parents=True, exist_ok=True)
        return user_path

    def _get_model_path(self, user_id: str, model_id: str) -> Path:
        """Get model directory path (creates if needed)."""
        user_path = self._get_user_path(user_id)
        model_path = user_path / model_id
        model_path.mkdir(parents=True, exist_ok=True)
        return model_path

    def get_file_path(self, user_id: str, model_id: str, filename: str) -> Optional[Path]:
        """Get file path without creating directories. Returns None if not found."""
        user_path = self.base_path / user_id
        model_path = user_path / model_id
        file_path = model_path / filename

        if not file_path.exists():
            return None

        return file_path

    def open_temp(self, user_id: str, model_id: str, filename: str) -> tuple[Path, str]:
        """Open a temporary file for streaming upload. Returns (path, stored_filename)."""
        stored_filename = f"{uuid.uuid4()}_{filename}"
        temp_path = self.tmp_path / stored_filename
        return temp_path, stored_filename

    def commit_temp(self, temp_path: Path, user_id: str, model_id: str, stored_filename: str) -> str:
        """Move temp file to final location. Returns stored_filename."""
        model_path = self._get_model_path(user_id, model_id)
        final_path = model_path / stored_filename

        # Atomic rename (same volume)
        shutil.move(str(temp_path), str(final_path))

        return stored_filename

    def delete_model_dir(self, user_id: str, model_id: str) -> bool:
        """Delete entire model directory. Returns True if deleted."""
        user_path = self.base_path / user_id
        model_path = user_path / model_id

        if not model_path.exists():
            return False

        # Delete all files in model directory
        for file_path in model_path.iterdir():
            if file_path.is_file():
                file_path.unlink()

        # Delete model directory
        try:
            model_path.rmdir()
        except OSError:
            pass

        # Try to delete empty user directory
        try:
            user_path.rmdir()
        except OSError:
            pass

        return True

    def save_file(self, user_id: str, model_id: str, filename: str, file_data: bytes) -> str:
        """Save file to storage. Returns stored filename."""
        model_path = self._get_model_path(user_id, model_id)
        stored_filename = f"{uuid.uuid4()}_{filename}"
        file_path = model_path / stored_filename

        with open(file_path, "wb") as f:
            f.write(file_data)

        return stored_filename

    def get_file(self, user_id: str, model_id: str, filename: str) -> Optional[bytes]:
        """Get file from storage. Returns None if not found."""
        file_path = self.get_file_path(user_id, model_id, filename)
        if file_path is None:
            return None

        with open(file_path, "rb") as f:
            return f.read()

    def get_file_stream(self, user_id: str, model_id: str, filename: str):
        """Get file as stream (for large files)."""
        file_path = self.get_file_path(user_id, model_id, filename)
        if file_path is None:
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
        file_path = self.get_file_path(user_id, model_id, filename)
        if file_path is None:
            return False

        file_path.unlink()
        return True

    def file_exists(self, user_id: str, model_id: str, filename: str) -> bool:
        """Check if file exists."""
        return self.get_file_path(user_id, model_id, filename) is not None

    def get_file_size(self, user_id: str, model_id: str, filename: str) -> Optional[int]:
        """Get file size in bytes."""
        file_path = self.get_file_path(user_id, model_id, filename)
        if file_path is None:
            return None

        return file_path.stat().st_size


# Singleton instance
storage = StorageBackend()
