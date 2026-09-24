# Setup Guide

## Prerequisites

- Docker and Docker Compose (for Docker deployment)
- OR Python 3.10+ and Node.js 18+ (for manual setup)

## Docker Deployment (Recommended)

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd LLM_instruct_models
```

### 2. Configure Environment (Optional)

Create a `.env` file in the root directory:

```env
# Backend
DATABASE_URL=sqlite+aiosqlite:///./llm_models.db
JWT_SECRET_KEY=your-secure-random-secret-key-here
MODEL_STORAGE_PATH=/app/models
MAX_UPLOAD_SIZE_MB=50000

# Frontend
VITE_API_URL=http://localhost:8000
```

**Important:** Change `JWT_SECRET_KEY` to a secure random string in production!

### 3. Start the Application

```bash
docker-compose up -d
```

### 4. Verify Installation

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### 5. First Login

1. Navigate to http://localhost:5173
2. Click "Register" to create your admin account
3. Login with your credentials

## Manual Deployment

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend will start at http://localhost:8000

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will start at http://localhost:5173

## Database Setup (Production)

### SQLite (Development)

No setup required. Database file `llm_models.db` is created automatically.

### PostgreSQL (Production)

1. Create a PostgreSQL database:

```bash
createdb llm_models
```

2. Set the database URL in environment:

```env
DATABASE_URL=postgresql+asyncpg://username:password@localhost:5432/llm_models
```

3. Run migrations (when implemented):

```bash
cd backend
alembic upgrade head
```

## Storage Configuration

### Local Storage (Default)

Models are stored in the `models/` directory:

```
models/
├── {user_id}/
│   └── {model_id}/
│       └── {stored_filename}
```

### S3 Storage (Production)

To be implemented. Will support:
- AWS S3
- MinIO
- Any S3-compatible storage

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./llm_models.db` | Database connection |
| `JWT_SECRET_KEY` | `change-me-in-production` | JWT secret (CHANGE IN PRODUCTION) |
| `MODEL_STORAGE_PATH` | `./models` | Local storage path |
| `MAX_UPLOAD_SIZE_MB` | `50000` | Max upload size (50GB) |
| `DEBUG` | `false` | Enable debug mode |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |

## Troubleshooting

### Backend won't start

**Error:** `ModuleNotFoundError: No module named 'fastapi'`

**Solution:** Install dependencies:
```bash
cd backend
pip install -r requirements.txt
```

### Frontend can't connect to backend

**Error:** `Network Error` or `CORS error`

**Solution:** Ensure backend is running at http://localhost:8000 and frontend proxy is configured in `vite.config.js`.

### Database errors

**Error:** `sqlite3.OperationalError: no such table`

**Solution:** Delete the database file and restart:
```bash
rm llm_models.db
# Restart backend
```

### Port already in use

**Error:** `Address already in use`

**Solution:** Change ports in `docker-compose.yml` or kill the process using the port:
```bash
# Find process using port 8000
lsof -i :8000
# Kill process
kill -9 <PID>
```

## Next Steps

1. Register an account
2. Upload your first model
3. Explore the API documentation at /docs
4. Configure environment variables for production

## Support

For issues or questions, please refer to the API documentation or contact the maintainer.
