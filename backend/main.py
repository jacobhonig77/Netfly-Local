from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Optional, Tuple

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
os.chdir(ROOT_DIR)


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip().strip("\"").strip("'")
        os.environ.setdefault(key, value)


_load_env_file(Path(__file__).resolve().parent / ".env")
_load_env_file(ROOT_DIR / ".env")


def _parse_cors_origins(raw: str) -> list[str]:
    value = (raw or "*").strip()
    if value == "*":
        return ["*"]
    return [v.strip() for v in value.split(",") if v.strip()]


# Database runtime selection.
# - sqlite (default): use SQLITE_PATH/DB_PATH
# - postgres: use DATABASE_URL
db_backend = os.getenv("DB_BACKEND", "sqlite").strip().lower()
if db_backend == "postgres":
    os.environ["DB_BACKEND"] = "postgres"
    if os.getenv("DATABASE_URL"):
        os.environ["DATABASE_URL"] = os.getenv("DATABASE_URL", "")
else:
    os.environ["DB_BACKEND"] = "sqlite"
    if os.getenv("SQLITE_PATH"):
        os.environ["DB_PATH"] = os.getenv("SQLITE_PATH", "")

from api_server import (  # noqa: E402
    business_monthly,
    forecast_mtd,
    goals_get,
    import_date_coverage,
    import_history,
    inventory_history,
    inventory_insights,
    inventory_latest,
    meta_date_range,
    ntb_monthly,
    pnl_summary,
    product_sku_summary,
    product_summary,
    product_top_movers,
    product_trend,
    sales_daily,
    sales_pivot,
    sales_summary,
    settings_get,
)

app = FastAPI(title="IQBAR Dashboard Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(os.getenv("BACKEND_CORS_ORIGINS", "*")),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer_scheme = HTTPBearer(auto_error=True)
_jwks_cache: dict[str, Any] = {"expires_at": 0, "keys": []}


def ymd(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def _resolve_date_window(meta: dict[str, Any], preset: str, start_date: Optional[str], end_date: Optional[str]) -> Tuple[str, str]:
    max_date = str(meta.get("max_date") or "")
    min_date = str(meta.get("min_date") or "")
    if start_date and end_date:
        return str(start_date), str(end_date)
    if not max_date:
        today = date.today()
        month_start = today.replace(day=1)
        return ymd(month_start), ymd(today)
    max_dt = datetime.strptime(max_date, "%Y-%m-%d").date()
    min_dt = datetime.strptime(min_date, "%Y-%m-%d").date() if min_date else max_dt
    p = (preset or "MTD").strip()
    if p == "YTD":
        start = max_dt.replace(month=1, day=1)
    elif p == "Last 30":
        start = max_dt.fromordinal(max_dt.toordinal() - 29)
    elif p == "Last 90":
        start = max_dt.fromordinal(max_dt.toordinal() - 89)
    elif p == "Custom" and start_date and end_date:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    else:
        start = max_dt.replace(day=1)
    if start < min_dt:
        start = min_dt
    return ymd(start), max_date


def _safe_call(
    key: str,
    errors: dict[str, str],
    fn: Callable[..., Any],
    *args: Any,
    fallback: Any = None,
    **kwargs: Any,
) -> Any:
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        errors[key] = str(exc)
        return fallback


def _get_jwks(issuer: str) -> list[dict[str, Any]]:
    now = int(time.time())
    if _jwks_cache["keys"] and now < int(_jwks_cache["expires_at"]):
        return _jwks_cache["keys"]
    url = f"{issuer.rstrip('/')}/.well-known/jwks.json"
    with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310
        payload = json.loads(resp.read().decode("utf-8"))
    keys = payload.get("keys", [])
    if not isinstance(keys, list) or not keys:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid JWKS response")
    _jwks_cache["keys"] = keys
    _jwks_cache["expires_at"] = now + 3600
    return keys


def _extract_role(claims: dict[str, Any]) -> str:
    role: Optional[str] = None
    public_metadata = claims.get("public_metadata")
    if isinstance(public_metadata, dict):
        role = public_metadata.get("role") or public_metadata.get("Role")
    if not role:
        role = claims.get("role") or claims.get("org_role")
    norm = str(role or "viewer").strip().lower()
    return "admin" if norm == "admin" else "viewer"


def verify_clerk_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict[str, Any]:
    issuer = os.getenv("CLERK_ISSUER", "").strip()
    audience = os.getenv("CLERK_AUDIENCE", "").strip()
    if not issuer:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CLERK_ISSUER is not configured")
    token = credentials.credentials
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token kid")
        key_data = next((k for k in _get_jwks(issuer) if k.get("kid") == kid), None)
        if not key_data:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signing key not found")
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key_data))
        options = {"verify_aud": bool(audience)}
        claims = jwt.decode(
            token,
            key=public_key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=audience if audience else None,
            options=options,
        )
        return {
            "user_id": claims.get("sub"),
            "role": _extract_role(claims),
            "claims": claims,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Unauthorized: {exc}") from exc


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/dashboard")
def dashboard(
    channel: str = Query(default="Amazon"),
    preset: str = Query(default="MTD"),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    compare_mode: str = Query(default="mom"),
    granularity: str = Query(default="day"),
    product_line: str = Query(default="IQBAR"),
    product_tag: Optional[str] = Query(default=None),
    w7: int = Query(default=40),
    w30: int = Query(default=30),
    w60: int = Query(default=20),
    w90: int = Query(default=10),
    target_wos: float = Query(default=8.0),
    recent_weight: float = Query(default=0.6),
    mom_weight: float = Query(default=0.4),
    weekday_strength: float = Query(default=1.0),
    manual_multiplier: float = Query(default=1.0),
    promo_lift_pct: float = Query(default=0.0),
    content_lift_pct: float = Query(default=0.0),
    instock_rate: float = Query(default=1.0),
    growth_floor: float = Query(default=0.5),
    growth_ceiling: float = Query(default=1.8),
    volatility_multiplier: float = Query(default=1.0),
    include_data: bool = Query(default=True),
    auth: dict[str, Any] = Depends(verify_clerk_token),
) -> dict[str, Any]:
    errors: dict[str, str] = {}

    meta = _safe_call("meta", errors, meta_date_range, channel, fallback={})
    resolved_start, resolved_end = _resolve_date_window(meta or {}, preset, start_date, end_date)
    common = {"start_date": resolved_start, "end_date": resolved_end, "channel": channel}

    workspace = {
        "settings": _safe_call("workspace.settings", errors, settings_get, fallback={"auto_slack_on_import": True}),
        "import_history": _safe_call("workspace.import_history", errors, import_history, channel=channel, fallback={"rows": []}),
        "import_date_coverage": _safe_call(
            "workspace.import_date_coverage",
            errors,
            import_date_coverage,
            start_date="2024-01-01",
            end_date="2026-12-31",
            channel=channel,
            fallback={"rows": []},
        ),
        "ntb_monthly": _safe_call(
            "workspace.ntb_monthly",
            errors,
            ntb_monthly,
            channel=channel,
            fallback={"rows": [], "updated_from": None, "updated_to": None, "imported_at": None},
        ),
        "goals": _safe_call("workspace.goals", errors, goals_get, channel=channel, year=None, fallback={"rows": []}),
    }

    if not include_data:
        return {
            "meta": meta,
            "channel": channel,
            "preset": preset,
            "resolved_dates": {"start_date": resolved_start, "end_date": resolved_end},
            "workspace": workspace,
            "auth": {"user_id": auth.get("user_id"), "role": auth.get("role", "viewer")},
            "errors": errors,
        }

    sales = {
        "summary": _safe_call("sales.summary", errors, sales_summary, compare_mode=compare_mode, **common, fallback=None),
        "daily": _safe_call("sales.daily", errors, sales_daily, **common, fallback={"rows": []}),
        "pivot": _safe_call("sales.pivot", errors, sales_pivot, **common, fallback={"rows": []}),
    }
    product = {
        "summary": _safe_call("product.summary", errors, product_summary, **common, fallback={"rows": []}),
        "trend": _safe_call("product.trend", errors, product_trend, granularity=granularity, **common, fallback={"rows": []}),
        "sku_summary": _safe_call(
            "product.sku_summary",
            errors,
            product_sku_summary,
            product_line=product_line,
            product_tag=product_tag,
            **common,
            fallback={"rows": []},
        ),
        "sku_summary_all": {
            "iqbar": _safe_call("product.sku_summary_all.iqbar", errors, product_sku_summary, product_line="IQBAR", **common, fallback={"rows": []}),
            "iqmix": _safe_call("product.sku_summary_all.iqmix", errors, product_sku_summary, product_line="IQMIX", **common, fallback={"rows": []}),
            "iqjoe": _safe_call("product.sku_summary_all.iqjoe", errors, product_sku_summary, product_line="IQJOE", **common, fallback={"rows": []}),
        },
        "top_movers": _safe_call(
            "product.top_movers",
            errors,
            product_top_movers,
            product_line=product_line,
            product_tag=product_tag,
            **common,
            fallback={"gainers": [], "decliners": []},
        ),
    }
    business = {
        "monthly": _safe_call("business.monthly", errors, business_monthly, channel=channel, fallback={"rows": [], "summary": {}}),
        "pnl_summary": _safe_call("business.pnl_summary", errors, pnl_summary, start_date=resolved_start, end_date=resolved_end, fallback=None),
    }
    forecast = _safe_call(
        "forecast.mtd",
        errors,
        forecast_mtd,
        as_of_date=resolved_end,
        channel=channel,
        recent_weight=recent_weight,
        mom_weight=mom_weight,
        weekday_strength=weekday_strength,
        manual_multiplier=manual_multiplier,
        promo_lift_pct=promo_lift_pct,
        content_lift_pct=content_lift_pct,
        instock_rate=instock_rate,
        growth_floor=growth_floor,
        growth_ceiling=growth_ceiling,
        volatility_multiplier=volatility_multiplier,
        fallback={"projection": None},
    )
    inventory = {
        "latest": _safe_call(
            "inventory.latest",
            errors,
            inventory_latest,
            w7=w7,
            w30=w30,
            w60=w60,
            w90=w90,
            target_wos=target_wos,
            fallback={"snapshot": None, "rows": [], "by_line": {}},
        ),
        "history": _safe_call("inventory.history", errors, inventory_history, fallback={"rows": []}),
        "insights": _safe_call("inventory.insights", errors, inventory_insights, w7=w7, w30=w30, w60=w60, w90=w90, fallback={"kpis": {}, "insights": []}),
    }

    return {
        "meta": meta,
        "channel": channel,
        "preset": preset,
        "resolved_dates": {"start_date": resolved_start, "end_date": resolved_end},
        "sales": sales,
        "product": product,
        "business": business,
        "forecast": forecast,
        "inventory": inventory,
        "workspace": workspace,
        "auth": {"user_id": auth.get("user_id"), "role": auth.get("role", "viewer")},
        "errors": errors,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
    )
