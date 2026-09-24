# LLM Instruct Models Repository

A self-hosted model repository for managing, uploading, and downloading large language model weights and checkpoints.

## Features

- **User Authentication** — Secure registration and login with JWT tokens
- **Model Upload** — Support for large model files (up to 50GB by default)
- **Model Download** — Direct download with metadata
- **Model Management** — Organize models with names, descriptions, versions, tags, and frameworks
- **Search** — Full-text search across model names and descriptions
- **Pagination** — Efficient browsing of large model libraries
- **Docker Support** — Easy deployment with Docker Compose

## Tech Stack

### Backend
- **Framework:** FastAPI (Python 3.10+)
- **Database:** SQLite (development) / PostgreSQL (production)
- **ORM:** SQLAlchemy
- **Authentication:** JWT with bcrypt password hashing
- **Storage:** Local filesystem (expandable to S3)

### Frontend
- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** React Router
- **HTTP Client:** Axios
- **Styling:** Custom CSS

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone <your-repo-url>
cd LLM_instruct_models

# Start the application
docker-compose up -d

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Option 2: Manual Setup

#### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## API Documentation

Interactive API documentation is available at `http://localhost:8000/docs` after starting the backend.

### Key Endpoints

- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login and get JWT token
- `GET /api/models` — List all models (paginated)
- `GET /api/models/search?q=...` — Search models
- `POST /api/models` — Create model metadata
- `POST /api/models/{id}/upload` — Upload model file
- `GET /api/models/{id}/download` — Download model file
- `DELETE /api/models/{id}` — Delete model

## File Upload

### Supported Formats
- `.gguf` — GGUF format (llama.cpp)
- `.pt`, `.pth` — PyTorch
- `.safetensors` — Safetensors
- `.onnx` — ONNX Runtime
- `.tar`, `.zip`, `.gz` — Archives
- `.bin` — Binary files

### File Size Limit
Default: 50GB (configurable via `MAX_UPLOAD_SIZE_MB` environment variable)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./llm_models.db` | Database connection string |
| `JWT_SECRET_KEY` | `change-me-in-production` | Secret key for JWT tokens |
| `MODEL_STORAGE_PATH` | `./models` | Path to store model files |
| `MAX_UPLOAD_SIZE_MB` | `50000` | Maximum upload size in MB |
| `DEBUG` | `false` | Enable debug mode |

### Allowed File Extensions

Configure in `backend/app/core/config.py`:

```python
ALLOWED_EXTENSIONS: list = [
    ".gguf", ".pt", ".pth", ".safetensors", ".onnx",
    ".tar", ".zip", ".gz", ".bin"
]
```

## Project Structure

```
LLM_instruct_models/
├── backend/
│   ├── app/
│   │   ├── api/           # API routes
│   │   ├── core/          # Core configuration, security, database
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── storage/       # Storage backend
│   │   └── main.py        # FastAPI application
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/           # API client
│   │   ├── components/    # React components
│   │   ├── App.jsx        # Main app component
│   │   └── main.jsx       # Entry point
│   ├── package.json
│   └── Dockerfile
├── models/                # Model file storage (created on first run)
├── docker-compose.yml
└── README.md
```

## Development

### Backend Development

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Run with auto-reload
uvicorn app.main:app --reload
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

### Running Tests

```bash
# Backend tests (to be implemented)
cd backend
pytest

# Frontend tests (to be implemented)
cd frontend
npm test
```

## Production Deployment

### Deployment Guides

- **[Plesk Deployment Guide](./DEPLOY_PLESK.md)** — Deploy on Plesk with IONOS hosting
- **General Production Setup** — See below for generic production deployment

### Using PostgreSQL

1. Set `DATABASE_URL` to your PostgreSQL connection string:
   ```
   DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
   ```

2. Run database migrations (to be implemented with Alembic)

3. Set a secure `JWT_SECRET_KEY`

4. Configure CORS origins in `backend/app/main.py`

5. Set up reverse proxy (nginx, Caddy) for HTTPS

### Storage

For production, consider using object storage:

1. Implement S3 storage backend in `backend/app/storage/`
2. Set environment variables for S3 credentials
3. Update `MODEL_STORAGE_PATH` to S3 bucket URL

## Security Considerations

- Change `JWT_SECRET_KEY` in production
- Use HTTPS in production
- Implement rate limiting for upload endpoints
- Add file type validation beyond extensions
- Implement user quotas for storage
- Add audit logging for model uploads/downloads
- Consider adding API keys for programmatic access

## License

MIT

## Author

Built for managing personal LLM instruct models.
