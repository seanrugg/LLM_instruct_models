from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db
from app.api import auth_router, models_router, users_router

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(users_router, prefix="/api")


@app.on_event("startup")
async def startup_event():
    await init_db()


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
