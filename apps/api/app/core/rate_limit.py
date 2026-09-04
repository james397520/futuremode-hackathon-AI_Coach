"""Redis token-bucket rate limiting (spec §40.3 / §49.4).

Why a token bucket: the platform has two very different traffic shapes — bursty UI
navigation (many small GETs) and expensive, slow calls (``POST /sessions/{id}/message``
which fans out to the LLM). A bucket lets a user burst up to ``capacity`` and then
settle to ``refill_per_second``, instead of a fixed window that either throttles normal
browsing or lets a scripted client hammer the model endpoint.

The refill + take is a single Lua script so it is atomic across API replicas
(§49.3 — the API is horizontally scaled and stateless).

Failure policy: Redis being down must not take the product down (§49.4), so limiters
**fail open** and log loudly — except limiters constructed with ``fail_closed=True``
(login and other credential endpoints), where an unavailable limiter must not become a
free brute-force window.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Final

import structlog
from fastapi import Depends, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings
from app.core.context import RequestContext
from app.core.errors import RateLimitedError, ServiceUnavailableError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = structlog.get_logger(__name__)

KEY_PREFIX: Final[str] = "rl"

#: KEYS[1]=bucket key, ARGV=[capacity, refill_per_second, now_ms, cost, ttl_seconds]
#: Returns {allowed, remaining_tokens_milli, retry_after_ms}
_TOKEN_BUCKET_LUA: Final[str] = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed = math.max(0, now_ms - ts)
tokens = math.min(capacity, tokens + (elapsed / 1000.0) * refill)

local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local deficit = cost - tokens
  retry_after_ms = math.ceil((deficit / refill) * 1000)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', key, ttl)
return {allowed, math.floor(tokens * 1000), retry_after_ms}
"""

_redis: Redis | None = None


def get_redis(settings: Settings | None = None) -> Redis:
    """Process-wide async Redis client (decoded responses)."""
    global _redis
    if _redis is None:
        cfg = settings or get_settings()
        _redis = Redis.from_url(
            cfg.redis_url,
            decode_responses=True,
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
            health_check_interval=30,
        )
    return _redis


async def ping_redis(settings: Settings | None = None) -> bool:
    """Readiness probe for Redis."""
    client = get_redis(settings)
    return bool(await client.ping())


async def close_redis() -> None:
    """Close the pool on shutdown."""
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    """Outcome of one bucket check."""

    allowed: bool
    remaining: float
    retry_after_seconds: int


class RateLimiter:
    """Token-bucket limiter backed by a Redis Lua script."""

    __slots__ = ("_client", "_script_sha")

    def __init__(self, client: Redis | None = None) -> None:
        self._client = client or get_redis()
        self._script_sha: str | None = None

    async def _eval(
        self, key: str, capacity: float, refill_per_second: float, cost: float, ttl: int
    ) -> list[int]:
        now_ms = int(time.time() * 1000)
        args = [capacity, refill_per_second, now_ms, cost, ttl]
        if self._script_sha is None:
            self._script_sha = await self._client.script_load(_TOKEN_BUCKET_LUA)
        try:
            raw = await self._client.evalsha(self._script_sha, 1, key, *args)
        except RedisError as exc:
            if "NOSCRIPT" not in str(exc):
                raise
            self._script_sha = await self._client.script_load(_TOKEN_BUCKET_LUA)
            raw = await self._client.evalsha(self._script_sha, 1, key, *args)
        return [int(value) for value in raw]

    async def check(
        self,
        key: str,
        *,
        capacity: int,
        refill_per_second: float,
        cost: int = 1,
        fail_closed: bool = False,
    ) -> RateLimitDecision:
        """Take ``cost`` tokens from ``key``'s bucket.

        Raises:
            ServiceUnavailableError: only when ``fail_closed`` and Redis is unreachable.
        """
        ttl = max(60, int(capacity / max(refill_per_second, 0.001)) * 2)
        try:
            allowed, remaining_milli, retry_after_ms = await self._eval(
                f"{KEY_PREFIX}:{key}", capacity, refill_per_second, cost, ttl
            )
        except (RedisError, OSError) as exc:
            logger.error("rate_limiter_unavailable", fail_closed=fail_closed, exc_info=exc)
            if fail_closed:
                raise ServiceUnavailableError(
                    "Rate limiting is unavailable; this request was rejected for safety."
                ) from exc
            return RateLimitDecision(allowed=True, remaining=float(capacity), retry_after_seconds=0)
        return RateLimitDecision(
            allowed=bool(allowed),
            remaining=remaining_milli / 1000.0,
            retry_after_seconds=max(1, (retry_after_ms + 999) // 1000),
        )


_limiter: RateLimiter | None = None


def get_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter()
    return _limiter


# ---------------------------------------------------------------------------
# FastAPI dependency factory
# ---------------------------------------------------------------------------


def _bucket_key(name: str, request: Request, ctx: RequestContext | None) -> str:
    """Prefer the authenticated principal; fall back to the peer address."""
    if ctx is not None and ctx.user_id:
        return f"{name}:u:{ctx.tenant_id}:{ctx.user_id}"
    client_host = request.client.host if request.client else "unknown"
    return f"{name}:ip:{client_host}"


def rate_limit(
    name: str,
    *,
    per_minute: int | None = None,
    burst: int | None = None,
    cost: int = 1,
    fail_closed: bool = False,
    by_ip: bool = False,
) -> Callable[..., Awaitable[None]]:
    """Build a rate-limit dependency.

    Args:
        name: Bucket namespace, e.g. ``"sessions.message"``. Keep it stable — it is the
            Redis key prefix and shows up in dashboards.
        per_minute: Sustained rate. Defaults to the configured mutating/default rate.
        burst: Bucket capacity. Defaults to ``per_minute``.
        cost: Tokens consumed by one call; use >1 for expensive endpoints.
        fail_closed: Reject instead of allowing when Redis is unreachable.
        by_ip: Always key by peer address (used by unauthenticated endpoints).

    Usage::

        @router.post(
            "/sessions",
            dependencies=[Depends(rate_limit("sessions.create", per_minute=10))],
        )
    """

    async def dependency(request: Request) -> None:
        settings = get_settings()
        if not settings.rate_limit_enabled:
            return
        rate = per_minute or settings.rate_limit_mutating_per_minute
        capacity = burst or rate
        ctx: RequestContext | None = getattr(request.state, "context", None)
        key = (
            f"{name}:ip:{request.client.host if request.client else 'unknown'}"
            if by_ip
            else _bucket_key(name, request, ctx)
        )
        decision = await get_limiter().check(
            key,
            capacity=capacity,
            refill_per_second=rate / 60.0,
            cost=cost,
            fail_closed=fail_closed,
        )
        if not decision.allowed:
            logger.warning(
                "rate_limited",
                bucket=name,
                path=request.url.path,
                retry_after=decision.retry_after_seconds,
            )
            raise RateLimitedError(decision.retry_after_seconds)

    return dependency


#: Shared limiter presets so routers stay declarative and consistent.
DefaultReadLimit = Annotated[None, Depends(rate_limit("read", per_minute=240, burst=60))]
MutatingLimit = Annotated[None, Depends(rate_limit("mutate", per_minute=30, burst=15))]
LoginLimit = Annotated[
    None,
    Depends(
        rate_limit("auth.login", per_minute=10, burst=5, fail_closed=True, by_ip=True)
    ),
]
ExpensiveLimit = Annotated[
    None, Depends(rate_limit("expensive", per_minute=20, burst=10, cost=2))
]
