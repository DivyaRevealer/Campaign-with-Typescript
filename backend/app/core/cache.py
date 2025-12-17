"""Redis caching utilities with in-memory fallback for performance optimization."""

import json
import hashlib
import time
from typing import Any, Optional, Dict, Tuple
from functools import wraps
from collections import OrderedDict

try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

from app.core.config import settings


# Global Redis client (initialized on startup)
_redis_client: Optional[Any] = None
_redis_available: bool = False  # Track if Redis is actually available

# In-memory cache fallback (when Redis is unavailable)
# Structure: {key: (value, expiry_timestamp)}
_memory_cache: Dict[str, Tuple[Any, float]] = {}
_memory_cache_max_size: int = 1000  # Limit memory usage


async def get_redis_client() -> Optional[Any]:
    """Get or create Redis client instance."""
    global _redis_client, _redis_available
    
    if not REDIS_AVAILABLE or redis is None:
        return None
    
    # If we've already determined Redis is not available, skip connection attempts
    if _redis_client is None and not _redis_available:
        # Try once to connect
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
                socket_connect_timeout=0.5,  # Very fast timeout
                socket_timeout=0.5,  # Very fast timeout
            )
            # Test connection with very short timeout
            import asyncio
            await asyncio.wait_for(_redis_client.ping(), timeout=0.5)
            _redis_available = True
            print("✅ Redis connected - Dashboard caching enabled", flush=True)
        except Exception:
            # Redis not available - mark as unavailable and skip future attempts
            _redis_client = None
            _redis_available = False
            # Only print once to avoid spam
            if not hasattr(get_redis_client, '_warned'):
                print("⚠️  Redis not available - Using in-memory cache fallback (install Redis for distributed caching)", flush=True)
                get_redis_client._warned = True
    
    return _redis_client if _redis_available else None


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


def _get_memory_cache(key: str) -> Optional[Any]:
    """Get value from in-memory cache if not expired."""
    if key not in _memory_cache:
        return None
    
    value, expiry = _memory_cache[key]
    current_time = time.time()
    
    # Check if expired
    if expiry > 0 and current_time > expiry:
        # Remove expired entry
        del _memory_cache[key]
        return None
    
    return value


def _set_memory_cache(key: str, value: Any, ttl: int = 900) -> bool:
    """Set value in in-memory cache with TTL."""
    try:
        # Calculate expiry timestamp (0 means no expiry)
        expiry = time.time() + ttl if ttl > 0 else 0
        
        # If cache is too large, remove oldest entries (simple LRU)
        if len(_memory_cache) >= _memory_cache_max_size:
            # Remove 10% of oldest entries
            keys_to_remove = list(_memory_cache.keys())[:int(_memory_cache_max_size * 0.1)]
            for k in keys_to_remove:
                del _memory_cache[k]
        
        _memory_cache[key] = (value, expiry)
        return True
    except Exception:
        return False


def _get_memory_cache_ttl(key: str) -> int:
    """Get remaining TTL for in-memory cache entry in seconds."""
    if key not in _memory_cache:
        return -2  # Key doesn't exist (same as Redis)
    
    _, expiry = _memory_cache[key]
    if expiry == 0:
        return -1  # No expiry (same as Redis)
    
    current_time = time.time()
    if current_time > expiry:
        # Expired - remove it
        del _memory_cache[key]
        return -2
    
    remaining = int(expiry - current_time)
    return remaining if remaining > 0 else -2


async def get_cache(key: str) -> Optional[Any]:
    """Get value from cache (Redis or in-memory fallback)."""
    client = await get_redis_client()
    
    # Try Redis first
    if client:
        try:
            # Use asyncio.wait_for to prevent long timeouts
            import asyncio
            value = await asyncio.wait_for(client.get(key), timeout=0.1)  # 100ms max
            if value:
                return json.loads(value)
        except asyncio.TimeoutError:
            # Redis is slow/unresponsive - fall back to memory
            pass
        except Exception:
            # Redis error - fall back to memory
            pass
    
    # Fall back to in-memory cache
    return _get_memory_cache(key)


async def set_cache(key: str, value: Any, ttl: int = 900) -> bool:
    """Set value in cache with TTL (default 15 minutes = 900 seconds).
    Uses Redis if available, otherwise falls back to in-memory cache."""
    client = await get_redis_client()
    
    # Try Redis first
    if client:
        try:
            await client.setex(key, ttl, json.dumps(value))
            # Also store in memory cache as backup
            _set_memory_cache(key, value, ttl)
            return True
        except Exception:
            # Redis failed - fall back to memory
            pass
    
    # Fall back to in-memory cache
    return _set_memory_cache(key, value, ttl)


async def get_cache_ttl(key: str) -> int:
    """Get remaining TTL for a cache key in seconds.
    Returns:
        -2: Key doesn't exist
        -1: Key exists but has no expiry
        >=0: Remaining TTL in seconds
    Works with both Redis and in-memory cache."""
    client = await get_redis_client()
    
    # Try Redis first
    if client:
        try:
            import asyncio
            ttl = await asyncio.wait_for(client.ttl(key), timeout=0.1)
            return ttl
        except Exception:
            # Redis failed - check memory cache
            pass
    
    # Fall back to in-memory cache
    return _get_memory_cache_ttl(key)


async def delete_cache(key: str) -> bool:
    """Delete a key from cache (Redis and/or in-memory)."""
    deleted = False
    
    # Delete from Redis
    client = await get_redis_client()
    if client:
        try:
            await client.delete(key)
            deleted = True
        except Exception:
            pass
    
    # Delete from memory cache
    if key in _memory_cache:
        del _memory_cache[key]
        deleted = True
    
    return deleted


async def clear_cache_pattern(pattern: str) -> int:
    """Clear all cache keys matching a pattern (Redis and/or in-memory)."""
    deleted_count = 0
    
    # Clear from Redis
    client = await get_redis_client()
    if client:
        try:
            keys = []
            async for key in client.scan_iter(match=pattern):
                keys.append(key)
            if keys:
                deleted_count += await client.delete(*keys)
        except Exception:
            pass
    
    # Clear from memory cache (simple pattern matching)
    if '*' in pattern or '?' in pattern:
        # Simple glob matching for memory cache
        import fnmatch
        keys_to_delete = [k for k in _memory_cache.keys() if fnmatch.fnmatch(k, pattern)]
        for key in keys_to_delete:
            del _memory_cache[key]
            deleted_count += 1
    elif pattern in _memory_cache:
        del _memory_cache[pattern]
        deleted_count += 1
    
    return deleted_count


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

