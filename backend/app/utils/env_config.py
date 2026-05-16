"""Read .env file directly for real-time config updates (no restart needed)."""
import os

_ENV_PATH = os.getenv("ENV_FILE_PATH", os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
# Also check common Docker-mounted paths
_CANDIDATE_PATHS = [_ENV_PATH, "/app/.env", ".env"]


def _read_env_file() -> dict:
    env = {}
    for path in _CANDIDATE_PATHS:
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        env[key.strip()] = value.strip()
            break
        except FileNotFoundError:
            continue
    return env


_cache = {}
_cache_ts = 0


def get_env(key: str, default: str = "") -> str:
    """Read a single env var from .env file. Cached for 2s to avoid disk thrashing."""
    import time
    global _cache, _cache_ts
    now = time.time()
    if now - _cache_ts > 2:
        _cache = _read_env_file()
        _cache_ts = now
    return _cache.get(key, os.getenv(key, default))


def reload_env():
    """Force reload .env file (call after file changes)."""
    global _cache, _cache_ts
    _cache = _read_env_file()
    _cache_ts = time.time()
