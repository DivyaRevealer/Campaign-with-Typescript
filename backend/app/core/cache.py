"""Redis caching utilities for performance optimization."""

import json
import hashlib
from typing import Any, Optional
from functools import wraps

try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

from app.core.config import settings


# Global Redis client (initialized on startup)
_redis_client: Optional[Any] = None


async def get_redis_client() -> Optional[Any]:
    """Get or create Redis client instance."""
    global _redis_client
    
    if not REDIS_AVAILABLE or redis is None:
        return None
    
    if _redis_client is None:
        try:
            redis_host = getattr(settings, 'REDIS_HOST', 'localhost')
            redis_port = getattr(settings, 'REDIS_PORT', 6379)
            redis_db = getattr(settings, 'REDIS_DB', 0)
            redis_password = getattr(settings, 'REDIS_PASSWORD', None)
            
            _redis_client = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=redis_db,
                password=redis_password,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            # Test connection
            await _redis_client.ping()
        except Exception:
            # Redis not available - continue without caching
            _redis_client = None
    
    return _redis_client


async def close_redis_client():
    """Close Redis client connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


def generate_cache_key(prefix: str, **kwargs) -> str:
    """Generate a cache key from prefix and keyword arguments."""
    # Sort kwargs for consistent key generation
    sorted_kwargs = sorted(kwargs.items())
    key_str = f"{prefix}:{json.dumps(sorted_kwargs, sort_keys=True)}"
    # Hash long keys to keep them short
    if len(key_str) > 200:
        key_str = f"{prefix}:{hashlib.sha256(key_str.encode()).hexdigest()}"
    return key_str


async def get_cache(key: str) -> Optional[Any]:
    """Get value from cache."""
    client = await get_redis_client()
    if not client:
        return None
    
    try:
        value = await client.get(key)
        if value:
            return json.loads(value)
    except Exception:
        # Cache miss or error - return None
        pass
    return None


async def set_cache(key: str, value: Any, ttl: int = 900) -> bool:
    """Set value in cache with TTL (default 15 minutes = 900 seconds)."""
    client = await get_redis_client()
    if not client:
        return False
    
    try:
        await client.setex(key, ttl, json.dumps(value))
        return True
    except Exception:
        # Cache set failed - continue without caching
        return False


async def delete_cache(key: str) -> bool:
    """Delete a key from cache."""
    client = await get_redis_client()
    if not client:
        return False
    
    try:
        await client.delete(key)
        return True
    except Exception:
        return False


async def clear_cache_pattern(pattern: str) -> int:
    """Clear all cache keys matching a pattern."""
    client = await get_redis_client()
    if not client:
        return 0
    
    try:
        keys = []
        async for key in client.scan_iter(match=pattern):
            keys.append(key)
        if keys:
            return await client.delete(*keys)
        return 0
    except Exception:
        return 0


def cached(ttl: int = 900, key_prefix: str = "cache"):
    """Decorator to cache function results."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key from function name and arguments
            cache_key = generate_cache_key(
                f"{key_prefix}:{func.__name__}",
                args=str(args),
                **kwargs
            )
            
            # Try to get from cache
            cached_value = await get_cache(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Cache miss - execute function
            result = await func(*args, **kwargs)
            
            # Store in cache
            await set_cache(cache_key, result, ttl)
            
            return result
        return wrapper
    return decorator

