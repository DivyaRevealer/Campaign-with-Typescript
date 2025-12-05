"""Application configuration loaded from environment variables."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings exposed via dependency injection throughout the app."""

    # Read .env with BOM tolerance; case-sensitive keys
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8-sig",
        case_sensitive=True,
    )

    APP_NAME: str = "IMS API"
    ENV: str = "dev"  # dev | staging | prod
    DEBUG: bool = True

    # JWT
    SECRET_KEY: str  # set via env/.env
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    JWT_ISSUER: str = "ims-api"
    JWT_AUDIENCE: str = "ims-clients"

    # CORS
    CORS_ALLOWED_ORIGINS: list[str] = Field(default_factory=list)

    # Cookies
    COOKIE_DOMAIN: str | None = None
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "strict"  # lax/strict/none
    REFRESH_CSRF_COOKIE_NAME: str = "ims_refresh_csrf"

    # DB (ims)
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "appadmin"
    DB_PASSWORD: str = ""  # set via env/.env
    DB_NAME: str = "ims"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 3600
    DB_ISOLATION_LEVEL: str = "READ COMMITTED"
    DB_RETRY_ATTEMPTS: int = 4
    DB_RETRY_BASE_DELAY: float = 0.05
    DB_RETRY_JITTER: float = 0.025
    IDEMPOTENCY_TTL_MINUTES: int = 5
    # Controls how many concurrent Excel/JSON uploads the server can handle.
    # Tune per environment (e.g., lower for dev, higher for production) based on
    # available CPU and memory.
    EXCEL_MAX_CONCURRENCY: int = 4
    # Rate limit for upload endpoints to protect the service from bursts.
    # See app.core.rate_limit.limiter for syntax.
    EXCEL_UPLOAD_RATE: str = "5/minute"
    SECURITY_MAX_CONCURRENCY: int = 4
    EXCEL_OP_TIMEOUT_SEC: int = 30
    INNODB_LOCK_WAIT_TIMEOUT_SEC: int = 10
    SELECT_MAX_EXECUTION_TIME_MS: int = 5000
    DB_NOWAIT_LOCKS: bool = False
    # Maximum allowed upload size for user-supplied files.
    MAX_UPLOAD_BYTES: int = 5 * 1024 * 1024  # 5 MB
    ENABLE_FILE_SCAN: bool = True
    # Location of Microsoft Defender's command-line scanner (MpCmdRun.exe). This
    # can vary between Windows Server versions and should be configured via the
    # environment when deploying to Windows hosts.
    DEFENDER_MPCMDRUN_PATH: str = r"C:\Program Files\Windows Defender\MpCmdRun.exe"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )


settings = Settings()
