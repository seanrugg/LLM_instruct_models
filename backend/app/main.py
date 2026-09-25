from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, func
from app.core.config import settings
from app.core.database import init_db, get_db
from app.core.security import get_password_hash
from app.models.models import User
from app.api import auth_router, models_router, users_router

logger = logging.getLogger(__name__)


def validate_jwt_secret():
    """Validate JWT_SECRET_KEY is secure in production."""
    if settings.DEBUG:
        return  # Skip validation in debug mode

    default_secret = "change-me-in-production-use-openssl-rand-hex-32"
    if settings.JWT_SECRET_KEY == default_secret:
        logger.error(
            "FATAL: JWT_SECRET_KEY is still set to the default value. "
            "Generate a secure secret with: openssl rand -hex 32"
        )
        raise RuntimeError("JWT_SECRET_KEY must be changed from default value")

    if len(settings.JWT_SECRET_KEY) < 32:
        logger.error(
            f"FATAL: JWT_SECRET_KEY is too short ({len(settings.JWT_SECRET_KEY)} chars). "
            "Must be at least 32 characters."
        )
        raise RuntimeError("JWT_SECRET_KEY must be at least 32 characters")

    logger.info("JWT_SECRET_KEY validation passed")


async def bootstrap_admin_user():
    """Create admin user on startup if users table is empty and ADMIN_* vars are set."""
    # Import db session here to avoid circular imports
    from app.core.database import async_session

    async with async_session() as db:
        # Check if users table is empty
        result = await db.execute(select(func.count(User.id)))
        user_count = result.scalar()

        if user_count > 0:
            logger.info("Users table not empty, skipping admin bootstrap")
            return

        # Check if admin vars are set
        if not (settings.ADMIN_USERNAME and settings.ADMIN_PASSWORD):
            logger.warning(
                "WARNING: Users table is empty and ADMIN_USERNAME/ADMIN_PASSWORD are not set. "
                "No admin user will be created. Use POST /api/users (admin only) to create the first user."
            )
            return

        # Create admin user
        admin_user = User(
            username=settings.ADMIN_USERNAME,
            email=settings.ADMIN_EMAIL,
            password_hash=get_password_hash(settings.ADMIN_PASSWORD),
            is_admin=True
        )
        db.add(admin_user)
        await db.commit()
        logger.info(f"Admin user '{settings.ADMIN_USERNAME}' created successfully")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    validate_jwt_secret()
    await init_db()
    await bootstrap_admin_user()
    yield
    # Shutdown
    # Cleanup if needed


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(users_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "message": "LLM Instruct Models Repository API",
        "docs": "/docs",
        "version": settings.APP_VERSION
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
