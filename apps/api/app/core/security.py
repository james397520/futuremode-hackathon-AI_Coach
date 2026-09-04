"""Password hashing, JWT issue/verify, secure cookies and CSRF helpers (spec §73).

Threat model notes
------------------
* **Tokens**: short-lived HS256 access tokens (default 15 min) carry the tenant /
  workspace / role claims that :mod:`app.core.deps` turns into a ``RequestContext``.
  Refresh tokens are a separate ``typ`` and are rejected by the access-token verifier,
  so a stolen refresh token cannot be replayed as an access token.
* **Cookies**: the access token is delivered as an ``HttpOnly``, ``Secure``,
  ``SameSite=Lax`` cookie so browser JavaScript (and therefore XSS) cannot read it.
  ``Secure`` is only relaxed for plain-HTTP local development.
* **CSRF**: because the session travels in a cookie, mutating requests require the
  double-submit pattern — a non-``HttpOnly`` CSRF cookie whose value is
  ``<nonce>.<HMAC(nonce, jti)>`` must be echoed in the ``X-CSRF-Token`` header.
  Binding the HMAC to the session's ``jti`` means a token minted for one session is
  useless for another.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.errors import TokenExpiredError, TokenInvalidError
from app.domain.enums import Role

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

    from fastapi import Response

# bcrypt with an explicit cost; ``deprecated="auto"`` lets us rotate schemes later.
_pwd_context: Final[CryptContext] = CryptContext(
    schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12
)

#: bcrypt silently truncates at 72 bytes — reject longer inputs instead.
MAX_PASSWORD_BYTES: Final[int] = 72
MIN_PASSWORD_LENGTH: Final[int] = 12
CSRF_HEADER_NAME: Final[str] = "X-CSRF-Token"


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


class TokenClaims(BaseModel):
    """Verified JWT payload.

    Claim names are short to keep the cookie small: ``tid`` tenant, ``wid`` workspace,
    ``rls`` roles, ``tms`` team ids.
    """

    sub: str
    tid: str
    wid: str | None = None
    rls: list[Role] = Field(default_factory=list)
    tms: list[str] = Field(default_factory=list)
    typ: TokenType
    jti: str
    iat: int
    exp: int
    iss: str


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


class WeakPasswordError(ValueError):
    """Raised when a password fails the local policy (surfaced as 422 by the router)."""


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt.

    Raises:
        WeakPasswordError: if the password is too short or longer than bcrypt's limit.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise WeakPasswordError(
            f"Password must be at most {MAX_PASSWORD_BYTES} bytes when UTF-8 encoded."
        )
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time-ish verification. Never raises on a malformed stored hash."""
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return False
    try:
        return _pwd_context.verify(password, password_hash)
    except ValueError:
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True when the stored hash uses an outdated scheme/cost and should be upgraded."""
    return _pwd_context.needs_update(password_hash)


def dummy_verify() -> None:
    """Burn a bcrypt round for unknown accounts to flatten the login timing channel."""
    _pwd_context.dummy_verify()


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------


def _encode(
    *,
    settings: Settings,
    subject: str,
    tenant_id: str,
    workspace_id: str | None,
    roles: Sequence[Role],
    team_ids: Sequence[str],
    token_type: TokenType,
    ttl_seconds: int,
    jti: str | None = None,
) -> tuple[str, TokenClaims]:
    now = datetime.now(tz=UTC)
    claims = TokenClaims(
        sub=subject,
        tid=tenant_id,
        wid=workspace_id,
        rls=list(roles),
        tms=list(team_ids),
        typ=token_type,
        jti=jti or uuid.uuid4().hex,
        iat=int(now.timestamp()),
        exp=int((now + timedelta(seconds=ttl_seconds)).timestamp()),
        iss=settings.jwt_issuer,
    )
    token = jwt.encode(
        claims.model_dump(mode="json"),
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, claims


def issue_access_token(
    *,
    user_id: str,
    tenant_id: str,
    workspace_id: str | None,
    roles: Iterable[Role],
    team_ids: Iterable[str] = (),
    settings: Settings | None = None,
) -> tuple[str, TokenClaims]:
    """Mint a short-lived access token. Returns ``(token, claims)``."""
    cfg = settings or get_settings()
    return _encode(
        settings=cfg,
        subject=user_id,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        roles=tuple(roles),
        team_ids=tuple(team_ids),
        token_type=TokenType.ACCESS,
        ttl_seconds=cfg.access_token_ttl_seconds,
    )


def issue_refresh_token(
    *,
    user_id: str,
    tenant_id: str,
    settings: Settings | None = None,
) -> tuple[str, TokenClaims]:
    """Mint a refresh token.

    It deliberately carries no workspace or role claims: privileges are re-derived from
    the database on refresh, so a role revocation takes effect within one access-token
    lifetime.
    """
    cfg = settings or get_settings()
    return _encode(
        settings=cfg,
        subject=user_id,
        tenant_id=tenant_id,
        workspace_id=None,
        roles=(),
        team_ids=(),
        token_type=TokenType.REFRESH,
        ttl_seconds=cfg.refresh_token_ttl_seconds,
    )


def decode_token(
    token: str,
    *,
    expected_type: TokenType,
    settings: Settings | None = None,
) -> TokenClaims:
    """Verify signature, issuer, expiry and token type.

    Raises:
        TokenExpiredError: the token is past ``exp``.
        TokenInvalidError: bad signature, wrong issuer, wrong ``typ`` or malformed.
    """
    cfg = settings or get_settings()
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            cfg.jwt_secret.get_secret_value(),
            algorithms=[cfg.jwt_algorithm],
            issuer=cfg.jwt_issuer,
            options={"require_exp": True, "require_iat": True, "verify_aud": False},
        )
    except JWTError as exc:  # jose raises ExpiredSignatureError as a JWTError subclass
        if "expire" in str(exc).lower():
            raise TokenExpiredError() from exc
        raise TokenInvalidError() from exc

    try:
        claims = TokenClaims.model_validate(payload)
    except ValueError as exc:
        raise TokenInvalidError() from exc

    if claims.typ is not expected_type:
        raise TokenInvalidError(
            f"Expected a {expected_type.value} token.",
        )
    return claims


def verify_access_token(token: str, *, settings: Settings | None = None) -> TokenClaims:
    """Convenience wrapper used by the auth dependency."""
    return decode_token(token, expected_type=TokenType.ACCESS, settings=settings)


# ---------------------------------------------------------------------------
# Cookies
# ---------------------------------------------------------------------------


def session_cookie_kwargs(settings: Settings) -> dict[str, Any]:
    """Cookie attributes for the session cookie (§73)."""
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
        "domain": settings.cookie_domain,
    }


def csrf_cookie_kwargs(settings: Settings) -> dict[str, Any]:
    """Same as the session cookie but readable by JS so the SPA can echo it."""
    kwargs = session_cookie_kwargs(settings)
    kwargs["httponly"] = False
    return kwargs


def refresh_cookie_kwargs(settings: Settings) -> dict[str, Any]:
    """Refresh cookie: HttpOnly, ``SameSite=Strict`` and scoped to the refresh path.

    ``Strict`` plus a narrow ``path`` means a cross-site POST cannot even reach the
    refresh endpoint with the cookie attached, which is why refresh does not need the
    double-submit CSRF check (the access token is often expired at that point).
    """
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "strict",
        "path": "/api/v1/auth/refresh",
        "domain": settings.cookie_domain,
    }


def set_session_cookies(
    response: Response,
    *,
    access_token: str,
    csrf_token: str,
    refresh_token: str | None = None,
    settings: Settings | None = None,
) -> None:
    """Attach the session, CSRF and (optionally) refresh cookies."""
    cfg = settings or get_settings()
    response.set_cookie(
        cfg.session_cookie_name,
        access_token,
        max_age=cfg.access_token_ttl_seconds,
        **session_cookie_kwargs(cfg),
    )
    response.set_cookie(
        cfg.csrf_cookie_name,
        csrf_token,
        max_age=cfg.access_token_ttl_seconds,
        **csrf_cookie_kwargs(cfg),
    )
    if refresh_token is not None:
        response.set_cookie(
            cfg.refresh_cookie_name,
            refresh_token,
            max_age=cfg.refresh_token_ttl_seconds,
            **refresh_cookie_kwargs(cfg),
        )


def clear_session_cookies(response: Response, settings: Settings | None = None) -> None:
    """Delete every auth cookie on logout (§61 ``clear_on_logout`` covers client caches)."""
    cfg = settings or get_settings()
    for name in (cfg.session_cookie_name, cfg.csrf_cookie_name):
        response.delete_cookie(name, path="/", domain=cfg.cookie_domain)
    response.delete_cookie(
        cfg.refresh_cookie_name, path="/api/v1/auth/refresh", domain=cfg.cookie_domain
    )


# ---------------------------------------------------------------------------
# CSRF (double-submit, bound to the session jti)
# ---------------------------------------------------------------------------


def _csrf_signature(nonce: str, jti: str, settings: Settings) -> str:
    return hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        f"{nonce}:{jti}".encode(),
        hashlib.sha256,
    ).hexdigest()


def issue_csrf_token(jti: str, *, settings: Settings | None = None) -> str:
    """Create ``<nonce>.<hmac>`` bound to the session's ``jti``."""
    cfg = settings or get_settings()
    nonce = secrets.token_urlsafe(24)
    return f"{nonce}.{_csrf_signature(nonce, jti, cfg)}"


def verify_csrf_token(
    token: str | None,
    *,
    jti: str,
    settings: Settings | None = None,
) -> bool:
    """Verify a CSRF token against the current session id in constant time."""
    if not token or "." not in token:
        return False
    cfg = settings or get_settings()
    nonce, _, signature = token.rpartition(".")
    if not nonce or not signature:
        return False
    return hmac.compare_digest(signature, _csrf_signature(nonce, jti, cfg))


def verify_csrf_pair(
    *,
    cookie_token: str | None,
    header_token: str | None,
    jti: str,
    settings: Settings | None = None,
) -> bool:
    """Double-submit check: cookie and header must match *and* be validly signed."""
    if not cookie_token or not header_token:
        return False
    if not hmac.compare_digest(cookie_token, header_token):
        return False
    return verify_csrf_token(cookie_token, jti=jti, settings=settings)


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------


def new_request_id() -> str:
    """Opaque correlation id (no host/time information encoded)."""
    return uuid.uuid4().hex


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)


def hash_lookup_key(value: str, settings: Settings | None = None) -> str:
    """Keyed hash for values we must index but must not store in the clear.

    Used for API-key lookups and rate-limit keys derived from identifiers.
    """
    cfg = settings or get_settings()
    return hmac.new(
        cfg.jwt_secret.get_secret_value().encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
