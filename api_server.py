from __future__ import annotations

import calendar
import hashlib
import io
import math
import mimetypes
import os
import re
import sqlite3
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional, Tuple

import pandas as pd
import requests
from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - optional until postgres mode enabled
    psycopg = None
    dict_row = None

try:
    from local_sales_dashboard import (
        build_sales_pdf_report,
        get_logo_path,
        init_db as init_local_db,
    )
except Exception:
    build_sales_pdf_report = None
    get_logo_path = None
    init_local_db = None

DB_PATH = Path(os.getenv("DB_PATH", "data/sales_dashboard.db"))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_BACKEND = os.getenv("DB_BACKEND", "sqlite").strip().lower()
RAW_UPLOAD_DIR = Path(os.getenv("RAW_UPLOAD_DIR", "data/raw_uploads"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "raw-uploads").strip()
SUPABASE_STORAGE_PREFIX = os.getenv("SUPABASE_STORAGE_PREFIX", "iqbar").strip().strip("/")
ENV_PATH = Path(".env")
POSTGRES_SCHEMA_PATH = Path(__file__).resolve().parent / "backend" / "sql" / "postgres_schema.sql"
logger = logging.getLogger("iqbar.api_server")

MONEY_COLUMNS = [
    "product sales",
    "product sales tax",
    "shipping credits",
    "shipping credits tax",
    "gift wrap credits",
    "giftwrap credits tax",
    "regulatory fee",
    "tax on regulatory fee",
    "promotional rebates",
    "promotional rebates tax",
    "marketplace withheld tax",
    "selling fees",
    "fba fees",
    "other transaction fees",
    "other",
    "total",
]

SALES_O_TO_Y_COLUMNS = [
    "product sales",
    "product sales tax",
    "shipping credits",
    "shipping credits tax",
    "gift wrap credits",
    "giftwrap credits tax",
    "regulatory fee",
    "tax on regulatory fee",
    "promotional rebates",
    "promotional rebates tax",
    "marketplace withheld tax",
]


def load_local_env(path: Path = ENV_PATH) -> None:
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


load_local_env()


def _using_postgres() -> bool:
    return DB_BACKEND == "postgres"


class PostgresCursorAdapter:
    def __init__(self, cursor, lastrowid: Optional[int] = None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    @property
    def rowcount(self) -> int:
        return int(self._cursor.rowcount or 0)

    @property
    def description(self):
        return self._cursor.description


class PostgresConnAdapter:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params: tuple = ()):
        statement, bound = _adapt_params_for_postgres(sql, params)
        cur = self._conn.cursor(row_factory=dict_row)
        upper = statement.lstrip().upper()
        lastrowid = None
        if upper.startswith("INSERT INTO") and "RETURNING" not in upper and "ON CONFLICT" not in upper:
            try:
                cur.execute(f"{statement.rstrip().rstrip(';')} RETURNING id", bound)
                row = cur.fetchone()
                if row and isinstance(row, dict) and "id" in row:
                    lastrowid = int(row["id"])
                elif row and not isinstance(row, dict):
                    lastrowid = int(row[0])
                return PostgresCursorAdapter(cur, lastrowid=lastrowid)
            except Exception:
                cur.close()
                cur = self._conn.cursor(row_factory=dict_row)
        cur.execute(statement, bound)
        return PostgresCursorAdapter(cur, lastrowid=lastrowid)

    def executemany(self, sql: str, seq):
        statement, _ = _adapt_params_for_postgres(sql, ())
        cur = self._conn.cursor(row_factory=dict_row)
        cur.executemany(statement, seq)
        return PostgresCursorAdapter(cur)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def db_conn():
    if DB_BACKEND == "postgres":
        if not DATABASE_URL:
            raise RuntimeError("DB_BACKEND=postgres but DATABASE_URL is empty")
        if psycopg is None:
            raise RuntimeError("psycopg is required for postgres mode")
        return PostgresConnAdapter(psycopg.connect(DATABASE_URL, row_factory=dict_row))
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _adapt_sql_for_postgres(sql: str) -> str:
    out = sql
    out = re.sub(r"strftime\\('%Y-%W',\\s*([^)]+)\\)", r"to_char((\\1)::date, 'IYYY-IW')", out)
    out = re.sub(r"strftime\\('%m',\\s*([^)]+)\\)", r"to_char((\\1)::date, 'MM')", out)
    out = re.sub(r"CAST\\(strftime\\('%w',\\s*([^)]+)\\) AS INTEGER\\)", r"CAST(EXTRACT(DOW FROM (\\1)::date) AS INTEGER)", out)
    out = re.sub(r"date\\(([^,\\)]+),\\s*'-(\\d+) day'\\)", r"((\\1)::date - INTERVAL '\\2 day')::date", out)
    return out


def _adapt_params_for_postgres(sql: str, params: tuple) -> tuple[str, tuple]:
    out = []
    in_str = False
    for ch in sql:
        if ch == "'":
            in_str = not in_str
            out.append(ch)
            continue
        if ch == "?" and not in_str:
            out.append("%s")
        else:
            out.append(ch)
    return _adapt_sql_for_postgres("".join(out)), params


def init_api_tables() -> None:
    if _using_postgres():
        conn = db_conn()
        try:
            schema_sql = POSTGRES_SCHEMA_PATH.read_text(encoding="utf-8")
            for statement in [s.strip() for s in schema_sql.split(";") if s.strip()]:
                conn.execute(statement)
            conn.commit()
        finally:
            conn.close()
        return

    # Ensure base dashboard tables exist even on a fresh/empty database
    # (Render free instances can start from a clean filesystem).
    if init_local_db is not None:
        init_local_db()

    conn = db_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            date_time TEXT,
            date TEXT,
            type TEXT,
            order_id TEXT,
            order_state TEXT,
            order_city TEXT,
            order_postal TEXT,
            sku TEXT,
            description TEXT,
            quantity REAL,
            product_sales REAL,
            product_sales_tax REAL,
            shipping_credits REAL,
            shipping_credits_tax REAL,
            gift_wrap_credits REAL,
            giftwrap_credits_tax REAL,
            regulatory_fee REAL,
            tax_on_regulatory_fee REAL,
            promotional_rebates REAL,
            promotional_rebates_tax REAL,
            marketplace_withheld_tax REAL,
            selling_fees REAL,
            fba_fees REAL,
            other_transaction_fees REAL,
            other REAL,
            total REAL,
            transaction_status TEXT,
            sales_o_to_y REAL,
            tx_key TEXT,
            channel TEXT DEFAULT 'Amazon'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            min_date TEXT,
            max_date TEXT,
            total_sales_o_to_y REAL NOT NULL,
            channel TEXT DEFAULT 'Amazon'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS monthly_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            channel TEXT NOT NULL,
            product_line TEXT NOT NULL,
            goal REAL NOT NULL,
            source_file TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_goals_unique ON monthly_goals(year, month, channel, product_line)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sku_mapping (
            sku_key TEXT PRIMARY KEY,
            sku TEXT,
            asin TEXT,
            parent_asin TEXT,
            brand TEXT,
            tag TEXT,
            product_line TEXT,
            unit_count TEXT,
            flavor_name TEXT,
            size TEXT,
            cogs REAL,
            price REAL,
            promo REAL,
            link_to_pdp TEXT,
            updated_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            row_count INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id INTEGER NOT NULL,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            sku TEXT,
            fnsku TEXT,
            asin TEXT,
            product_name TEXT,
            condition TEXT,
            your_price REAL,
            afn_warehouse_quantity REAL,
            afn_fulfillable_quantity REAL,
            afn_unsellable_quantity REAL,
            afn_reserved_quantity REAL,
            afn_total_quantity REAL,
            afn_inbound_working_quantity REAL,
            afn_inbound_shipped_quantity REAL,
            afn_inbound_receiving_quantity REAL,
            afn_researching_quantity REAL,
            product_line TEXT,
            FOREIGN KEY(snapshot_id) REFERENCES inventory_snapshots(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS asin_cogs (
            asin_key TEXT PRIMARY KEY,
            asin TEXT,
            sku TEXT,
            cogs REAL NOT NULL,
            source_sheet TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS slack_daily_alerts (
            alert_date TEXT PRIMARY KEY,
            sent_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ntb_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            min_month TEXT,
            max_month TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ntb_monthly (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL,
            month TEXT NOT NULL,
            product_line TEXT NOT NULL,
            ntb_customers REAL NOT NULL,
            FOREIGN KEY(import_id) REFERENCES ntb_imports(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ntb_monthly_import ON ntb_monthly(import_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ntb_monthly_month ON ntb_monthly(month)")
    # Channel support for multi-workspace datasets (Amazon / Shopify).
    tx_cols = {r["name"] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    if "channel" not in tx_cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN channel TEXT DEFAULT 'Amazon'")
    conn.execute("UPDATE transactions SET channel = 'Amazon' WHERE channel IS NULL OR TRIM(channel) = ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_channel_date ON transactions(channel, date)")

    import_cols = {r["name"] for r in conn.execute("PRAGMA table_info(imports)").fetchall()}
    if "channel" not in import_cols:
        conn.execute("ALTER TABLE imports ADD COLUMN channel TEXT DEFAULT 'Amazon'")
    conn.execute("UPDATE imports SET channel = 'Amazon' WHERE channel IS NULL OR TRIM(channel) = ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_imports_channel_imported_at ON imports(channel, imported_at)")

    ntb_import_cols = {r["name"] for r in conn.execute("PRAGMA table_info(ntb_imports)").fetchall()}
    if "channel" not in ntb_import_cols:
        conn.execute("ALTER TABLE ntb_imports ADD COLUMN channel TEXT DEFAULT 'Amazon'")
    conn.execute("UPDATE ntb_imports SET channel = 'Amazon' WHERE channel IS NULL OR TRIM(channel) = ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ntb_imports_channel_imported_at ON ntb_imports(channel, imported_at)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shopify_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_file TEXT NOT NULL,
            product_line TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            min_date TEXT,
            max_date TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shopify_line_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            product_line TEXT NOT NULL,
            sales REAL NOT NULL,
            units REAL NOT NULL DEFAULT 0,
            orders REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(import_id) REFERENCES shopify_imports(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shopify_line_daily_date ON shopify_line_daily(date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shopify_line_daily_line_date ON shopify_line_daily(product_line, date)")
    conn.commit()
    conn.close()


def normalize_channel(channel: Optional[str]) -> str:
    c = str(channel or "Amazon").strip().lower()
    if c == "shopify":
        return "Shopify"
    return "Amazon"


def _safe_upload_name(name: str) -> str:
    base = Path(name or "upload.bin").name
    return re.sub(r"[^A-Za-z0-9._-]+", "_", base) or "upload.bin"


def _raw_storage_mode() -> str:
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET:
        return "supabase"
    return "local"


def _upload_raw_to_supabase(object_key: str, file_bytes: bytes, content_type: str) -> bool:
    if _raw_storage_mode() != "supabase":
        return False
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{object_key.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "x-upsert": "true",
        "content-type": content_type or "application/octet-stream",
    }
    try:
        resp = requests.post(url, headers=headers, data=file_bytes, timeout=30)
        if 200 <= resp.status_code < 300:
            return True
        logger.warning("supabase raw upload failed [%s]: %s", resp.status_code, resp.text[:300])
        return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("supabase raw upload error: %s", exc)
        return False


def persist_raw_upload(file_name: str, file_bytes: bytes, data_type: str, channel: str = "Amazon") -> str:
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    ch = normalize_channel(channel).lower()
    safe_name = _safe_upload_name(file_name)
    object_key = "/".join(
        p for p in [SUPABASE_STORAGE_PREFIX, ch, data_type, f"{ts}_{safe_name}"] if p
    )
    content_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"

    if _upload_raw_to_supabase(object_key, file_bytes, content_type):
        return f"supabase://{SUPABASE_STORAGE_BUCKET}/{object_key}"

    target_dir = RAW_UPLOAD_DIR / ch / data_type
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{ts}_{safe_name}"
    target_path.write_bytes(file_bytes)
    return str(target_path)


def database_health_check() -> dict:
    try:
        conn = db_conn()
        conn.execute("SELECT 1")
        conn.close()
        return {"ok": True, "db_backend": DB_BACKEND}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "db_backend": DB_BACKEND, "error": str(exc)}


def normalize_product_line(line: Optional[str]) -> str:
    p = str(line or "").strip().upper()
    if p in {"IQBAR", "IQMIX", "IQJOE"}:
        return p
    raise ValueError("product_line must be one of: IQBAR, IQMIX, IQJOE")


def normalize_product_line_from_text(value: str) -> str:
    text = str(value or "").upper()
    if "IQBAR" in text:
        return "IQBAR"
    if "IQMIX" in text:
        return "IQMIX"
    if "IQJOE" in text:
        return "IQJOE"
    return "Unmapped"


def _norm_cols(columns: list[str]) -> list[str]:
    return [str(c).strip().lower().replace("\ufeff", "") for c in columns]


def _detect_header_row_csv(text: str) -> int:
    for idx, line in enumerate(text.splitlines()[:80]):
        low = line.lower()
        if "date/time" in low and "order id" in low and "total" in low:
            return idx
    return 0


def _detect_header_row_xlsx(df_head: pd.DataFrame) -> Optional[int]:
    for idx in range(min(80, len(df_head))):
        row = [str(v).strip().lower() for v in df_head.iloc[idx].tolist()]
        if "date/time" in row and "order id" in row and "total" in row:
            return idx
    return None


def _key_part(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def build_tx_key(
    date_time: str,
    tx_type: str,
    order_id: str,
    sku: str,
    total: float,
    quantity: float,
    description: str,
) -> str:
    raw = "|".join(
        [
            _key_part(date_time),
            _key_part(tx_type).upper(),
            _key_part(order_id).upper(),
            _key_part(sku).upper(),
            f"{float(total):.4f}" if total is not None and str(total) != "" else "",
            f"{float(quantity):.4f}" if quantity is not None and str(quantity) != "" else "",
            _key_part(description).upper(),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def parse_payments_upload(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    lower_name = str(file_name or "").lower()
    if lower_name.endswith(".csv"):
        text = file_bytes.decode("utf-8-sig", errors="replace")
        header_row = _detect_header_row_csv(text)
        df = pd.read_csv(io.StringIO(text), skiprows=header_row)
    elif lower_name.endswith(".xlsx"):
        xlsx = io.BytesIO(file_bytes)
        sheet_names = pd.ExcelFile(xlsx).sheet_names
        df = None
        for sheet in sheet_names:
            xlsx.seek(0)
            head = pd.read_excel(xlsx, sheet_name=sheet, header=None, nrows=100)
            header_row = _detect_header_row_xlsx(head)
            if header_row is None:
                continue
            xlsx.seek(0)
            df = pd.read_excel(xlsx, sheet_name=sheet, header=header_row)
            break
        if df is None:
            raise ValueError("Could not find a sheet header containing date/time, order id, and total.")
    else:
        raise ValueError("Unsupported file type. Use .csv or .xlsx")

    df.columns = _norm_cols(df.columns.tolist())
    if "date/time" not in df.columns:
        raise ValueError("Could not parse payments file: missing 'date/time' column after header detection.")

    for col in MONEY_COLUMNS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
        else:
            df[col] = 0.0
    if "quantity" in df.columns:
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce").fillna(0.0)
    else:
        df["quantity"] = 0.0

    cleaned = df["date/time"].astype(str).str.replace(r"\s[A-Z]{2,4}$", "", regex=True).str.strip()
    df["parsed_timestamp"] = pd.to_datetime(cleaned, format="%b %d, %Y %I:%M:%S %p", errors="coerce")
    df["date"] = df["parsed_timestamp"].dt.date.astype(str)

    for col in ["type", "order id", "order city", "order state", "order postal", "sku", "description", "transaction status"]:
        if col not in df.columns:
            df[col] = ""

    df["sales_o_to_y"] = 0.0
    for col in SALES_O_TO_Y_COLUMNS:
        df["sales_o_to_y"] += df[col]

    return pd.DataFrame(
        {
            "date_time": df["date/time"].astype(str),
            "date": df["date"].astype(str),
            "type": df["type"].astype(str),
            "order_id": df["order id"].astype(str),
            "order_state": df["order state"].astype(str),
            "order_city": df["order city"].astype(str),
            "order_postal": df["order postal"].astype(str),
            "sku": df["sku"].astype(str),
            "description": df["description"].astype(str),
            "quantity": df["quantity"].astype(float),
            "product_sales": df["product sales"],
            "product_sales_tax": df["product sales tax"],
            "shipping_credits": df["shipping credits"],
            "shipping_credits_tax": df["shipping credits tax"],
            "gift_wrap_credits": df["gift wrap credits"],
            "giftwrap_credits_tax": df["giftwrap credits tax"],
            "regulatory_fee": df["regulatory fee"],
            "tax_on_regulatory_fee": df["tax on regulatory fee"],
            "promotional_rebates": df["promotional rebates"],
            "promotional_rebates_tax": df["promotional rebates tax"],
            "marketplace_withheld_tax": df["marketplace withheld tax"],
            "selling_fees": df["selling fees"],
            "fba_fees": df["fba fees"],
            "other_transaction_fees": df["other transaction fees"],
            "other": df["other"],
            "total": df["total"],
            "transaction_status": df["transaction status"].astype(str),
            "sales_o_to_y": df["sales_o_to_y"],
        }
    )


def parse_inventory_upload(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    lower_name = str(file_name or "").lower()
    if lower_name.endswith(".csv"):
        try:
            raw = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8-sig")
        except UnicodeDecodeError:
            raw = pd.read_csv(io.BytesIO(file_bytes), encoding="latin1")
    elif lower_name.endswith(".xlsx"):
        raw = pd.read_excel(io.BytesIO(file_bytes))
    else:
        raise ValueError("Unsupported inventory file type. Use .csv or .xlsx")

    raw.columns = _norm_cols(raw.columns.tolist())
    required = {"sku", "asin", "product-name"}
    if not required.issubset(set(raw.columns)):
        raise ValueError("Inventory file missing required columns: sku, asin, product-name")

    numeric_cols = [
        "your-price",
        "afn-warehouse-quantity",
        "afn-fulfillable-quantity",
        "afn-unsellable-quantity",
        "afn-reserved-quantity",
        "afn-total-quantity",
        "afn-inbound-working-quantity",
        "afn-inbound-shipped-quantity",
        "afn-inbound-receiving-quantity",
        "afn-researching-quantity",
    ]
    for col in numeric_cols:
        if col in raw.columns:
            raw[col] = pd.to_numeric(raw[col], errors="coerce").fillna(0.0)
        else:
            raw[col] = 0.0

    for col in ["sku", "fnsku", "asin", "product-name", "condition"]:
        if col not in raw.columns:
            raw[col] = ""
        raw[col] = raw[col].fillna("").astype(str).str.strip()

    out = pd.DataFrame(
        {
            "sku": raw["sku"],
            "fnsku": raw["fnsku"],
            "asin": raw["asin"],
            "product_name": raw["product-name"],
            "condition": raw["condition"],
            "your_price": raw["your-price"],
            "afn_warehouse_quantity": raw["afn-warehouse-quantity"],
            "afn_fulfillable_quantity": raw["afn-fulfillable-quantity"],
            "afn_unsellable_quantity": raw["afn-unsellable-quantity"],
            "afn_reserved_quantity": raw["afn-reserved-quantity"],
            "afn_total_quantity": raw["afn-total-quantity"],
            "afn_inbound_working_quantity": raw["afn-inbound-working-quantity"],
            "afn_inbound_shipped_quantity": raw["afn-inbound-shipped-quantity"],
            "afn_inbound_receiving_quantity": raw["afn-inbound-receiving-quantity"],
            "afn_researching_quantity": raw["afn-researching-quantity"],
        }
    )
    out["product_line"] = out["product_name"].map(normalize_product_line_from_text)
    out = out[out["sku"] != ""].drop_duplicates(subset=["sku", "asin", "fnsku"], keep="first")
    return out


def save_transactions(df: pd.DataFrame, source_file: str, channel: str = "Amazon") -> tuple[int, int]:
    if df.empty:
        return 0, 0
    ch = normalize_channel(channel)
    conn = db_conn()
    imported_at = datetime.now().isoformat(timespec="seconds")
    to_save = df.copy()
    to_save["tx_key"] = to_save.apply(
        lambda r: build_tx_key(
            r.get("date_time", ""),
            r.get("type", ""),
            r.get("order_id", ""),
            r.get("sku", ""),
            r.get("total", 0.0),
            r.get("quantity", 0.0),
            r.get("description", ""),
        ),
        axis=1,
    )
    to_save = to_save.drop_duplicates(subset=["tx_key"], keep="first").copy()
    incoming = to_save["tx_key"].dropna().astype(str).tolist()
    existing: set[str] = set()
    chunk_size = 1000
    for i in range(0, len(incoming), chunk_size):
        chunk = incoming[i : i + chunk_size]
        if not chunk:
            continue
        placeholders = ",".join(["?"] * len(chunk))
        rows = conn.execute(f"SELECT tx_key FROM transactions WHERE tx_key IN ({placeholders})", tuple(chunk)).fetchall()
        for r in rows or []:
            existing.add(str(r["tx_key"] if isinstance(r, dict) else r[0]))
    before_batch = int(len(to_save))
    if existing:
        to_save = to_save[~to_save["tx_key"].isin(existing)].copy()
    skipped = before_batch - int(len(to_save))

    if to_save.empty:
        conn.execute(
            """
            INSERT INTO imports (imported_at, source_file, row_count, min_date, max_date, total_sales_o_to_y, channel)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (imported_at, source_file, 0, None, None, 0.0, ch),
        )
        conn.commit()
        conn.close()
        return 0, skipped

    conn.executemany(
        """
        INSERT INTO transactions (
            imported_at, source_file, date_time, date, type, order_id, order_state, order_city, order_postal, sku, description, quantity,
            product_sales, product_sales_tax, shipping_credits, shipping_credits_tax, gift_wrap_credits, giftwrap_credits_tax,
            regulatory_fee, tax_on_regulatory_fee, promotional_rebates, promotional_rebates_tax, marketplace_withheld_tax, selling_fees,
            fba_fees, other_transaction_fees, other, total, transaction_status, sales_o_to_y, tx_key, channel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                imported_at,
                source_file,
                str(r.get("date_time") or ""),
                str(r.get("date") or ""),
                str(r.get("type") or ""),
                str(r.get("order_id") or ""),
                str(r.get("order_state") or ""),
                str(r.get("order_city") or ""),
                str(r.get("order_postal") or ""),
                str(r.get("sku") or ""),
                str(r.get("description") or ""),
                float(r.get("quantity") or 0.0),
                float(r.get("product_sales") or 0.0),
                float(r.get("product_sales_tax") or 0.0),
                float(r.get("shipping_credits") or 0.0),
                float(r.get("shipping_credits_tax") or 0.0),
                float(r.get("gift_wrap_credits") or 0.0),
                float(r.get("giftwrap_credits_tax") or 0.0),
                float(r.get("regulatory_fee") or 0.0),
                float(r.get("tax_on_regulatory_fee") or 0.0),
                float(r.get("promotional_rebates") or 0.0),
                float(r.get("promotional_rebates_tax") or 0.0),
                float(r.get("marketplace_withheld_tax") or 0.0),
                float(r.get("selling_fees") or 0.0),
                float(r.get("fba_fees") or 0.0),
                float(r.get("other_transaction_fees") or 0.0),
                float(r.get("other") or 0.0),
                float(r.get("total") or 0.0),
                str(r.get("transaction_status") or ""),
                float(r.get("sales_o_to_y") or 0.0),
                str(r.get("tx_key") or ""),
                ch,
            )
            for _, r in to_save.iterrows()
        ],
    )
    conn.execute(
        """
        INSERT INTO imports (imported_at, source_file, row_count, min_date, max_date, total_sales_o_to_y, channel)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            imported_at,
            source_file,
            int(len(to_save)),
            str(to_save["date"].min()) if len(to_save) else None,
            str(to_save["date"].max()) if len(to_save) else None,
            float(to_save["sales_o_to_y"].sum()),
            ch,
        ),
    )
    conn.commit()
    conn.close()
    return int(len(to_save)), skipped


def save_inventory_snapshot(df: pd.DataFrame, source_file: str) -> tuple[int, int]:
    if df.empty:
        return 0, 0
    conn = db_conn()
    imported_at = datetime.now().isoformat(timespec="seconds")
    cur = conn.execute(
        """
        INSERT INTO inventory_snapshots (imported_at, source_file, row_count)
        VALUES (?, ?, ?)
        """,
        (imported_at, source_file, int(len(df))),
    )
    snapshot_id = int(cur.lastrowid or 0)
    conn.executemany(
        """
        INSERT INTO inventory_items (
            snapshot_id, imported_at, source_file, sku, fnsku, asin, product_name, condition, your_price,
            afn_warehouse_quantity, afn_fulfillable_quantity, afn_unsellable_quantity, afn_reserved_quantity, afn_total_quantity,
            afn_inbound_working_quantity, afn_inbound_shipped_quantity, afn_inbound_receiving_quantity, afn_researching_quantity, product_line
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                snapshot_id,
                imported_at,
                source_file,
                str(r.get("sku") or ""),
                str(r.get("fnsku") or ""),
                str(r.get("asin") or ""),
                str(r.get("product_name") or ""),
                str(r.get("condition") or ""),
                float(r.get("your_price") or 0.0),
                float(r.get("afn_warehouse_quantity") or 0.0),
                float(r.get("afn_fulfillable_quantity") or 0.0),
                float(r.get("afn_unsellable_quantity") or 0.0),
                float(r.get("afn_reserved_quantity") or 0.0),
                float(r.get("afn_total_quantity") or 0.0),
                float(r.get("afn_inbound_working_quantity") or 0.0),
                float(r.get("afn_inbound_shipped_quantity") or 0.0),
                float(r.get("afn_inbound_receiving_quantity") or 0.0),
                float(r.get("afn_researching_quantity") or 0.0),
                str(r.get("product_line") or "Unmapped"),
            )
            for _, r in df.iterrows()
        ],
    )
    conn.commit()
    conn.close()
    return snapshot_id, int(len(df))


def parse_ntb_upload(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    name = (file_name or "").lower()

    def _normalize_wide(df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        if "Month" not in out.columns:
            return pd.DataFrame(columns=["month", "product_line", "ntb_customers"])
        keep = [c for c in ["Month", "IQBAR", "IQMIX", "IQJOE"] if c in out.columns]
        out = out[keep].copy()
        out = out.rename(columns={"Month": "month"})
        out["month"] = pd.to_datetime(out["month"], errors="coerce").dt.to_period("M").dt.to_timestamp()
        out = out.dropna(subset=["month"])
        melted = out.melt(id_vars=["month"], var_name="product_line", value_name="ntb_customers")
        melted["product_line"] = melted["product_line"].astype(str).str.upper().str.strip()
        melted["ntb_customers"] = pd.to_numeric(melted["ntb_customers"], errors="coerce")
        melted = melted.dropna(subset=["ntb_customers"])
        melted = melted[melted["product_line"].isin(["IQBAR", "IQMIX", "IQJOE"])]
        return melted

    if name.endswith((".xlsx", ".xls")):
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        if "NTB" not in xls.sheet_names:
            raise ValueError("Unsupported NTB format. Excel uploads must include an 'NTB' tab.")
        df = pd.read_excel(io.BytesIO(file_bytes), sheet_name="NTB", header=1)
        wide_df = _normalize_wide(df)
        if not wide_df.empty:
            return wide_df
    elif name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes))
        wide_df = _normalize_wide(df)
        if not wide_df.empty:
            return wide_df

    raise ValueError("Unsupported NTB format. Use the NTB tab monthly format (Month, IQBAR, IQMIX, IQJOE).")


def parse_cogs_fee_upload(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    name = (file_name or "").lower()
    if name.endswith((".xlsx", ".xls")):
        raw = pd.read_excel(io.BytesIO(file_bytes))
    elif name.endswith(".csv"):
        raw = pd.read_csv(io.BytesIO(file_bytes))
    else:
        raise ValueError("Unsupported file type. Upload .xlsx/.xls/.csv")

    if raw.empty:
        return pd.DataFrame(columns=["sku", "cogs", "fba_fee"])

    cols = {str(c).strip().lower(): c for c in raw.columns}

    def pick(*candidates: str) -> Optional[str]:
        for c in candidates:
            if c in cols:
                return cols[c]
        return None

    sku_col = pick("sku", "seller sku", "seller_sku", "merchant sku", "merchant_sku", "msku", "sku key", "sku_key")
    cogs_col = pick("cogs", "cogs per unit", "unit cogs", "unit cost", "cost", "cost per unit")
    fba_col = pick("fba fee", "fba fees", "fba_fee", "fba fee per unit", "fba per unit", "fba/unit", "fba")

    if sku_col is None:
        raise ValueError("No SKU column found. Expected one of: SKU, Seller SKU, Merchant SKU.")

    out = pd.DataFrame()
    out["sku"] = raw[sku_col].astype(str).str.strip()
    out = out[out["sku"] != ""]
    out["cogs"] = pd.to_numeric(raw[cogs_col], errors="coerce") if cogs_col else pd.NA
    out["fba_fee"] = pd.to_numeric(raw[fba_col], errors="coerce") if fba_col else pd.NA
    out = out.drop_duplicates(subset=["sku"], keep="last")
    return out[["sku", "cogs", "fba_fee"]]


def parse_shopify_sales_by_day_upload(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    name = (file_name or "").lower()
    if name.endswith((".xlsx", ".xls")):
        raw = pd.read_excel(io.BytesIO(file_bytes))
    elif name.endswith(".csv"):
        raw = pd.read_csv(io.BytesIO(file_bytes))
    else:
        raise ValueError("Unsupported file type. Upload .csv/.xlsx/.xls")

    if raw.empty:
        return pd.DataFrame(columns=["date", "sales", "units", "orders"])

    cols = {str(c).strip().lower(): c for c in raw.columns}

    def pick(*candidates: str) -> Optional[str]:
        for c in candidates:
            if c in cols:
                return cols[c]
        return None

    date_col = pick("date", "day", "month", "order date", "created at", "created_at", "order day")
    sales_col = pick("sales", "net sales", "total sales", "gross sales", "amount", "revenue", "total_sales")
    units_col = pick("units", "quantity", "qty")
    orders_col = pick("orders", "order count")

    if date_col is None or sales_col is None:
        raise ValueError("Could not detect required columns. Need date and sales columns.")

    out = pd.DataFrame()
    out["date"] = pd.to_datetime(raw[date_col], errors="coerce").dt.strftime("%Y-%m-%d")
    out["sales"] = pd.to_numeric(raw[sales_col], errors="coerce").fillna(0.0)
    out["units"] = pd.to_numeric(raw[units_col], errors="coerce").fillna(0.0) if units_col else 0.0
    out["orders"] = pd.to_numeric(raw[orders_col], errors="coerce").fillna(0.0) if orders_col else 0.0
    out = out.dropna(subset=["date"])
    out = out.groupby("date", as_index=False).agg({"sales": "sum", "units": "sum", "orders": "sum"})
    return out.sort_values("date")


def save_shopify_line_daily(df: pd.DataFrame, source_file: str, product_line: str) -> tuple[int, int]:
    line = normalize_product_line(product_line)
    if df.empty:
        return 0, 0
    conn = db_conn()
    imported_at = datetime.now().isoformat(timespec="seconds")
    min_date = str(df["date"].min()) if len(df) else None
    max_date = str(df["date"].max()) if len(df) else None
    cur = conn.execute(
        """
        INSERT INTO shopify_imports (imported_at, source_file, product_line, row_count, min_date, max_date)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (imported_at, source_file, line, int(len(df)), min_date, max_date),
    )
    import_id = int(cur.lastrowid)
    to_save = df.copy()
    to_save["import_id"] = import_id
    to_save["product_line"] = line
    to_save = to_save[["import_id", "date", "product_line", "sales", "units", "orders"]]
    conn.executemany(
        """
        INSERT INTO shopify_line_daily (import_id, date, product_line, sales, units, orders)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                int(r["import_id"]),
                str(r["date"]),
                str(r["product_line"]),
                float(r["sales"] or 0.0),
                float(r["units"] or 0.0),
                float(r["orders"] or 0.0),
            )
            for _, r in to_save.iterrows()
        ],
    )
    conn.commit()
    conn.close()
    return import_id, int(len(to_save))


def save_ntb_snapshot(df: pd.DataFrame, source_file: str, channel: str = "Amazon") -> tuple[int, int]:
    if df.empty:
        return 0, 0
    conn = db_conn()
    imported_at = datetime.now().isoformat(timespec="seconds")
    min_month = str(df["month"].min().date()) if len(df) else None
    max_month = str(df["month"].max().date()) if len(df) else None
    cur = conn.execute(
        """
        INSERT INTO ntb_imports (imported_at, source_file, row_count, min_month, max_month, channel)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (imported_at, source_file, int(len(df)), min_month, max_month, normalize_channel(channel)),
    )
    import_id = int(cur.lastrowid)
    to_save = df.copy()
    to_save["import_id"] = import_id
    to_save["month"] = pd.to_datetime(to_save["month"], errors="coerce").dt.strftime("%Y-%m-01")
    to_save = to_save[["import_id", "month", "product_line", "ntb_customers"]]
    conn.executemany(
        """
        INSERT INTO ntb_monthly (import_id, month, product_line, ntb_customers)
        VALUES (?, ?, ?, ?)
        """,
        [
            (int(r["import_id"]), str(r["month"]), str(r["product_line"]), float(r["ntb_customers"] or 0.0))
            for _, r in to_save.iterrows()
        ],
    )
    conn.commit()
    conn.close()
    return import_id, int(len(to_save))


def read_df(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = db_conn()
    try:
        if _using_postgres():
            cur = conn.execute(sql, params)
            rows = cur.fetchall() or []
            cols = []
            if cur.description:
                cols = [str(d[0]) for d in cur.description if d and d[0]]
            if rows:
                first = rows[0]
                if isinstance(first, dict):
                    if cols:
                        return pd.DataFrame(rows, columns=cols)
                    return pd.DataFrame(rows)
                if cols:
                    return pd.DataFrame(rows, columns=cols)
                return pd.DataFrame(rows)
            return pd.DataFrame(columns=cols)
        return pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()


def parse_iso(d: str) -> date:
    return datetime.strptime(d, "%Y-%m-%d").date()


def clamp_dates(start_date: Optional[str], end_date: Optional[str], channel: str = "Amazon") -> tuple[date, date]:
    ch = normalize_channel(channel)
    if ch == "Shopify":
        conn = db_conn()
        row = conn.execute(
            "SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM shopify_line_daily WHERE date IS NOT NULL"
        ).fetchone()
        conn.close()
        if not row or not row["min_date"] or not row["max_date"]:
            today = date.today()
            return today, today
        min_d = parse_iso(row["min_date"])
        max_d = parse_iso(row["max_date"])
        s = parse_iso(start_date) if start_date else min_d
        e = parse_iso(end_date) if end_date else max_d
        if s > e:
            s, e = e, s
        s = max(s, min_d)
        e = min(e, max_d)
        return s, e

    conn = db_conn()
    row = conn.execute(
        "SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM transactions WHERE date IS NOT NULL AND COALESCE(channel,'Amazon') = ?",
        (ch,),
    ).fetchone()
    conn.close()
    if not row or not row["min_date"] or not row["max_date"]:
        today = date.today()
        return today, today
    min_d = parse_iso(row["min_date"])
    max_d = parse_iso(row["max_date"])
    s = parse_iso(start_date) if start_date else min_d
    e = parse_iso(end_date) if end_date else max_d
    if s > e:
        s, e = e, s
    s = max(s, min_d)
    e = min(e, max_d)
    return s, e


def shopify_daily_rows(start: date, end: date) -> pd.DataFrame:
    return read_df(
        """
        SELECT date, product_line, COALESCE(SUM(sales),0) AS sales, COALESCE(SUM(units),0) AS units, COALESCE(SUM(orders),0) AS orders
        FROM shopify_line_daily
        WHERE date BETWEEN ? AND ?
        GROUP BY date, product_line
        ORDER BY date, product_line
        """,
        (str(start), str(end)),
    )


def compare_window(start: date, end: date, mode: str) -> tuple[Optional[date], Optional[date]]:
    span = (end - start).days + 1
    m = (mode or "previous_period").lower()
    if m == "previous_year":
        try:
            return date(start.year - 1, start.month, start.day), date(end.year - 1, end.month, end.day)
        except ValueError:
            return None, None
    if m == "mom":
        pm = start.month - 1 or 12
        py = start.year - 1 if start.month == 1 else start.year
        start_day = min(start.day, calendar.monthrange(py, pm)[1])
        end_day = min(end.day, calendar.monthrange(py, pm)[1])
        return date(py, pm, start_day), date(py, pm, end_day)
    return start - timedelta(days=span), end - timedelta(days=span)


def pct_delta(curr: float, comp: float) -> Optional[float]:
    if abs(comp) < 1e-9:
        return None
    return (curr - comp) / comp


def get_month_goal(goal_year: int, goal_month: int, channel: str = "Amazon") -> float:
    conn = db_conn()
    try:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(goal), 0) AS total_goal
            FROM monthly_goals
            WHERE year = ? AND month = ? AND LOWER(channel) = LOWER(?)
            """,
            (goal_year, goal_month, channel),
        ).fetchone()
    finally:
        conn.close()
    return float(row["total_goal"] or 0.0) if row else 0.0


def _safe_ratio(numerator: float, denominator: float, default: float = 1.0) -> float:
    if denominator == 0:
        return default
    return numerator / denominator


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _assumption_effective_multiplier(assumptions: dict) -> float:
    manual = float(assumptions.get("manual_multiplier", 1.0))
    promo_lift = float(assumptions.get("promo_lift_pct", 0.0))
    content_lift = float(assumptions.get("content_lift_pct", 0.0))
    instock_rate = float(assumptions.get("instock_rate", 1.0))
    return manual * (1.0 + promo_lift) * (1.0 + content_lift) * instock_rate


def compute_dynamic_month_projection(
    daily_totals: pd.DataFrame,
    as_of_date: date,
    assumptions: Optional[dict] = None,
) -> Optional[dict]:
    if daily_totals.empty:
        return None

    ts = daily_totals.copy()
    ts["date"] = pd.to_datetime(ts["date"], errors="coerce")
    ts = ts.dropna(subset=["date"]).sort_values("date")
    ts = ts[ts["date"].dt.date <= as_of_date].copy()
    if ts.empty:
        return None

    month_start = date(as_of_date.year, as_of_date.month, 1)
    month_days = calendar.monthrange(as_of_date.year, as_of_date.month)[1]
    month_end = date(as_of_date.year, as_of_date.month, month_days)

    current = ts[(ts["date"].dt.date >= month_start) & (ts["date"].dt.date <= as_of_date)].copy()
    if current.empty:
        return None

    mtd_actual = float(current["total"].sum())
    elapsed_days = (as_of_date - month_start).days + 1

    hist = ts[ts["date"].dt.date < month_start].copy()
    if hist.empty:
        return None

    hist_recent_cutoff = month_start - timedelta(days=84)
    hist_recent = hist[hist["date"].dt.date >= hist_recent_cutoff].copy()
    if len(hist_recent) < 14:
        hist_recent = hist.copy()

    hist_recent["weekday"] = hist_recent["date"].dt.weekday
    weekday_avg = hist_recent.groupby("weekday")["total"].mean().to_dict()
    overall_avg = float(hist_recent["total"].mean()) if not hist_recent.empty else 0.0

    r14_start = as_of_date - timedelta(days=13)
    p14_start = as_of_date - timedelta(days=27)
    p14_end = as_of_date - timedelta(days=14)
    recent14 = ts[(ts["date"].dt.date >= r14_start) & (ts["date"].dt.date <= as_of_date)]["total"]
    prior14 = ts[(ts["date"].dt.date >= p14_start) & (ts["date"].dt.date <= p14_end)]["total"]
    recent_growth = _safe_ratio(float(recent14.mean()), float(prior14.mean()), 1.0) if len(prior14) > 0 else 1.0

    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = date(prev_month_end.year, prev_month_end.month, 1)
    prev_month_asof_day = min(elapsed_days, calendar.monthrange(prev_month_end.year, prev_month_end.month)[1])
    prev_month_cutoff = prev_month_start + timedelta(days=prev_month_asof_day - 1)
    prev_month_mtd = ts[(ts["date"].dt.date >= prev_month_start) & (ts["date"].dt.date <= prev_month_cutoff)]["total"]
    mom_growth = _safe_ratio(mtd_actual, float(prev_month_mtd.sum()), 1.0) if len(prev_month_mtd) > 0 else 1.0

    assumptions = assumptions or {}
    recent_weight = float(assumptions.get("recent_weight", 0.6))
    mom_weight = float(assumptions.get("mom_weight", 0.4))
    weekday_strength = float(assumptions.get("weekday_strength", 1.0))
    effective_multiplier = _assumption_effective_multiplier(assumptions)
    growth_floor = float(assumptions.get("growth_floor", 0.5))
    growth_ceiling = float(assumptions.get("growth_ceiling", 1.8))

    factors: list[tuple[float, float]] = []
    if len(prior14) >= 7:
        factors.append((recent_growth, max(recent_weight, 0.0)))
    if len(prev_month_mtd) > 0:
        factors.append((mom_growth, max(mom_weight, 0.0)))
    if not factors:
        factors.append((1.0, 1.0))
    growth_factor = sum(v * w for v, w in factors) / sum(w for _, w in factors)
    growth_factor *= effective_multiplier
    growth_factor = max(growth_floor, min(growth_ceiling, growth_factor))

    future_dates = pd.date_range(as_of_date + timedelta(days=1), month_end, freq="D")
    future_rows = []
    for d in future_dates:
        wd = int(d.weekday())
        baseline = float(weekday_avg.get(wd, overall_avg))
        baseline = overall_avg + weekday_strength * (baseline - overall_avg)
        pred = max(0.0, baseline * growth_factor)
        future_rows.append({"date": d, "predicted_sales": pred})
    future_df = pd.DataFrame(future_rows)
    remaining_projection = float(future_df["predicted_sales"].sum()) if not future_df.empty else 0.0
    projected_total = mtd_actual + remaining_projection

    hist_recent["baseline"] = hist_recent["weekday"].map(weekday_avg).fillna(overall_avg)
    residual_std = float((hist_recent["total"] - hist_recent["baseline"]).std(ddof=1)) if len(hist_recent) > 1 else 0.0
    volatility_multiplier = float(assumptions.get("volatility_multiplier", 1.0))
    forecast_std = (max(len(future_df), 1) ** 0.5) * residual_std * max(volatility_multiplier, 0.1)
    ci_low = max(0.0, projected_total - 1.96 * forecast_std)
    ci_high = projected_total + 1.96 * forecast_std

    full_month_dates = pd.date_range(month_start, month_end, freq="D")
    actual_daily = current.set_index("date")["total"].reindex(full_month_dates).fillna(0.0)
    forecast_daily = pd.Series(0.0, index=full_month_dates)
    if not future_df.empty:
        forecast_daily.loc[future_df["date"]] = future_df["predicted_sales"].values
    chart_df = pd.DataFrame(
        {
            "date": full_month_dates,
            "actual_daily": actual_daily.values,
            "forecast_daily": forecast_daily.values,
        }
    )

    return {
        "mtd_actual": mtd_actual,
        "projected_total": projected_total,
        "growth_factor": growth_factor,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "chart_df": chart_df,
        "elapsed_days": elapsed_days,
        "month_days": month_days,
        "month_start": month_start,
        "month_end": month_end,
    }


def backtest_projection_mape_with_assumptions(
    daily_totals: pd.DataFrame,
    as_of_day: int,
    current_month_start: date,
    assumptions: Optional[dict] = None,
) -> Optional[dict]:
    if daily_totals.empty:
        return None
    ts = daily_totals.copy()
    ts["date"] = pd.to_datetime(ts["date"], errors="coerce")
    ts = ts.dropna(subset=["date"]).sort_values("date")
    ts = ts[ts["date"].dt.date < current_month_start].copy()
    if ts.empty:
        return None

    months = sorted(ts["date"].dt.to_period("M").unique())
    rows = []
    for m in months:
        month_start = m.start_time.date()
        month_end = m.end_time.date()
        cutoff_day = min(as_of_day, calendar.monthrange(month_start.year, month_start.month)[1])
        as_of = month_start + timedelta(days=cutoff_day - 1)
        if as_of >= current_month_start:
            continue
        model_input = ts[ts["date"].dt.date <= as_of][["date", "total"]].copy()
        pred = compute_dynamic_month_projection(model_input, as_of, assumptions=assumptions)
        if pred is None:
            continue
        actual = float(ts[(ts["date"].dt.date >= month_start) & (ts["date"].dt.date <= month_end)]["total"].sum())
        if actual <= 0:
            continue
        ape = abs(pred["projected_total"] - actual) / actual
        rows.append({"month": str(m), "predicted": float(pred["projected_total"]), "actual": actual, "ape": float(ape)})

    if not rows:
        return None
    bt = pd.DataFrame(rows).sort_values("month")
    return {"mape": float(bt["ape"].mean()), "count": int(len(bt)), "details": bt}


def growth_significance(daily_totals: pd.DataFrame, as_of_date: date, assumptions: Optional[dict] = None) -> Optional[dict]:
    if daily_totals.empty:
        return None
    ts = daily_totals.copy()
    ts["date"] = pd.to_datetime(ts["date"], errors="coerce")
    ts = ts.dropna(subset=["date"]).sort_values("date")

    month_start = date(as_of_date.year, as_of_date.month, 1)
    current = ts[(ts["date"].dt.date >= month_start) & (ts["date"].dt.date <= as_of_date)]["total"]
    baseline_start = month_start - timedelta(days=84)
    baseline = ts[(ts["date"].dt.date >= baseline_start) & (ts["date"].dt.date < month_start)]["total"]

    n1, n2 = len(current), len(baseline)
    if n1 < 2 or n2 < 2:
        return None

    assumptions = assumptions or {}
    mean1_raw, mean2 = float(current.mean()), float(baseline.mean())
    mean1 = mean1_raw * _assumption_effective_multiplier(assumptions)
    std1, std2 = float(current.std(ddof=1)), float(baseline.std(ddof=1))
    se = math.sqrt((std1 ** 2) / n1 + (std2 ** 2) / n2)
    if se == 0:
        return None
    z = (mean1 - mean2) / se
    p_value = 2 * (1 - _normal_cdf(abs(z)))
    confidence = 1 - p_value
    return {
        "z": float(z),
        "p_value": float(p_value),
        "confidence": float(confidence),
        "mean_current": mean1,
        "mean_baseline": mean2,
    }


app = FastAPI(title="IQBAR Sales API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
init_api_tables()


def _resolve_date_window(meta: dict, preset: str, start_date: Optional[str], end_date: Optional[str]) -> Tuple[str, str]:
    max_date = str(meta.get("max_date") or "")
    min_date = str(meta.get("min_date") or "")
    if start_date and end_date:
        return str(start_date), str(end_date)
    if not max_date:
        today = date.today()
        return today.replace(day=1).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
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
    return start.strftime("%Y-%m-%d"), max_date


def _safe_call(key: str, errors: dict, fn: Callable[..., Any], *args: Any, fallback: Any = None, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        errors[key] = str(exc)
        return fallback


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
) -> dict:
    errors: dict[str, str] = {}

    meta = _safe_call("meta", errors, meta_date_range, channel, fallback={})
    resolved_start, resolved_end = _resolve_date_window(meta or {}, preset, start_date, end_date)
    common = {"start_date": resolved_start, "end_date": resolved_end, "channel": channel}

    workspace = {
        "settings": _safe_call("workspace.settings", errors, settings_get, fallback={"auto_slack_on_import": True}),
        "import_history": _safe_call("workspace.import_history", errors, import_history, channel=channel, fallback={"rows": []}),
        "import_date_coverage": _safe_call(
            "workspace.import_date_coverage", errors, import_date_coverage,
            start_date="2024-01-01", end_date="2026-12-31", channel=channel, fallback={"rows": []},
        ),
        "ntb_monthly": _safe_call(
            "workspace.ntb_monthly", errors, ntb_monthly, channel=channel,
            fallback={"rows": [], "updated_from": None, "updated_to": None, "imported_at": None},
        ),
        "goals": _safe_call("workspace.goals", errors, goals_get, channel=channel, fallback={"rows": []}),
    }

    if not include_data:
        return {
            "meta": meta,
            "channel": channel,
            "preset": preset,
            "resolved_dates": {"start_date": resolved_start, "end_date": resolved_end},
            "workspace": workspace,
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
            "product.sku_summary", errors, product_sku_summary,
            product_line=product_line, product_tag=product_tag, **common, fallback={"rows": []},
        ),
        "sku_summary_all": {
            "iqbar": _safe_call("product.sku_summary_all.iqbar", errors, product_sku_summary, product_line="IQBAR", **common, fallback={"rows": []}),
            "iqmix": _safe_call("product.sku_summary_all.iqmix", errors, product_sku_summary, product_line="IQMIX", **common, fallback={"rows": []}),
            "iqjoe": _safe_call("product.sku_summary_all.iqjoe", errors, product_sku_summary, product_line="IQJOE", **common, fallback={"rows": []}),
        },
        "top_movers": _safe_call(
            "product.top_movers", errors, product_top_movers,
            product_line=product_line, product_tag=product_tag, **common, fallback={"gainers": [], "decliners": []},
        ),
    }
    business = {
        "monthly": _safe_call("business.monthly", errors, business_monthly, channel=channel, fallback={"rows": [], "summary": {}}),
        "pnl_summary": _safe_call("business.pnl_summary", errors, pnl_summary, start_date=resolved_start, end_date=resolved_end, fallback=None),
    }
    forecast = _safe_call(
        "forecast.mtd", errors, forecast_mtd,
        as_of_date=resolved_end, channel=channel,
        recent_weight=recent_weight, mom_weight=mom_weight, weekday_strength=weekday_strength,
        manual_multiplier=manual_multiplier, promo_lift_pct=promo_lift_pct, content_lift_pct=content_lift_pct,
        instock_rate=instock_rate, growth_floor=growth_floor, growth_ceiling=growth_ceiling,
        volatility_multiplier=volatility_multiplier, fallback={"projection": None},
    )
    inventory = {
        "latest": _safe_call(
            "inventory.latest", errors, inventory_latest,
            w7=w7, w30=w30, w60=w60, w90=w90, target_wos=target_wos,
            fallback={"snapshot": None, "rows": [], "by_line": {}},
        ),
        "history": _safe_call("inventory.history", errors, inventory_history, fallback={"rows": []}),
        "insights": _safe_call(
            "inventory.insights", errors, inventory_insights,
            w7=w7, w30=w30, w60=w60, w90=w90, fallback={"kpis": {}, "insights": []},
        ),
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
        "errors": errors,
    }


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "ts": datetime.now().isoformat(timespec="seconds")}


@app.get("/api/meta/date-range")
def meta_date_range(channel: str = "Amazon") -> dict:
    ch = normalize_channel(channel)
    if ch == "Shopify":
        conn = db_conn()
        row = conn.execute(
            "SELECT MIN(date) AS min_date, MAX(date) AS max_date, COUNT(*) AS tx_count FROM shopify_line_daily WHERE date IS NOT NULL"
        ).fetchone()
        conn.close()
        return {"min_date": row["min_date"] if row else None, "max_date": row["max_date"] if row else None, "tx_count": int(row["tx_count"] or 0) if row else 0}

    conn = db_conn()
    row = conn.execute(
        "SELECT MIN(date) AS min_date, MAX(date) AS max_date, COUNT(*) AS tx_count FROM transactions WHERE date IS NOT NULL AND COALESCE(channel,'Amazon') = ?",
        (ch,),
    ).fetchone()
    conn.close()
    return {"min_date": row["min_date"] if row else None, "max_date": row["max_date"] if row else None, "tx_count": int(row["tx_count"] or 0) if row else 0}


@app.get("/api/sales/summary")
def sales_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    compare_mode: str = "previous_period",
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    cstart, cend = compare_window(start, end, compare_mode)

    if ch == "Shopify":
        curr_df = shopify_daily_rows(start, end)
        comp_df = shopify_daily_rows(cstart, cend) if cstart and cend else pd.DataFrame(columns=["date", "product_line", "sales"])
        def line_total(df: pd.DataFrame, line: str) -> float:
            if df.empty:
                return 0.0
            return float(df[df["product_line"] == line]["sales"].sum())
        curr_iqbar = line_total(curr_df, "IQBAR")
        curr_iqmix = line_total(curr_df, "IQMIX")
        curr_iqjoe = line_total(curr_df, "IQJOE")
        curr_total = curr_iqbar + curr_iqmix + curr_iqjoe
        comp_iqbar = line_total(comp_df, "IQBAR")
        comp_iqmix = line_total(comp_df, "IQMIX")
        comp_iqjoe = line_total(comp_df, "IQJOE")
        comp_total = comp_iqbar + comp_iqmix + comp_iqjoe

        linear = None
        dynamic = None
        if start.day == 1 and start.year == end.year and start.month == end.month:
            lookback_start = end - timedelta(days=210)
            days_in_month = calendar.monthrange(end.year, end.month)[1]
            days_elapsed = max(end.day, 1)
            projected = (curr_total / days_elapsed) * days_in_month if days_elapsed > 0 else 0.0
            goal = get_month_goal(end.year, end.month, ch)
            pace = (projected / goal) if goal > 0 else None
            linear = {"projected_total": projected, "goal": goal, "pace_to_goal": pace, "delta": (pace - 1.0) if pace is not None else None}
            daily_all = read_df(
                """
                SELECT date, COALESCE(SUM(sales),0) AS total
                FROM shopify_line_daily
                WHERE date BETWEEN ? AND ?
                GROUP BY date
                ORDER BY date
                """,
                (str(lookback_start), str(end)),
            )
            dyn = compute_dynamic_month_projection(daily_all, end)
            if dyn is not None:
                dpace = (dyn["projected_total"] / goal) if goal > 0 else None
                dynamic = {
                    "projected_total": float(dyn["projected_total"]),
                    "goal": goal,
                    "pace_to_goal": dpace,
                    "delta": (dpace - 1.0) if dpace is not None else None,
                }
        return {
            "period": {"start_date": str(start), "end_date": str(end)},
            "compare_period": {"start_date": str(cstart) if cstart else None, "end_date": str(cend) if cend else None},
            "current": {"grand_total": curr_total, "iqbar": curr_iqbar, "iqmix": curr_iqmix, "iqjoe": curr_iqjoe, "unmapped": 0.0},
            "compare": {"grand_total": comp_total, "iqbar": comp_iqbar, "iqmix": comp_iqmix, "iqjoe": comp_iqjoe},
            "deltas": {
                "grand_total": pct_delta(curr_total, comp_total),
                "iqbar": pct_delta(curr_iqbar, comp_iqbar),
                "iqmix": pct_delta(curr_iqmix, comp_iqmix),
                "iqjoe": pct_delta(curr_iqjoe, comp_iqjoe),
            },
            "mtd": {"linear": linear, "dynamic": dynamic},
        }

    conn = db_conn()
    curr = conn.execute(
        """
        SELECT
          COALESCE(SUM(CASE WHEN m.product_line='IQBAR' THEN t.sales_o_to_y ELSE 0 END),0) AS iqbar,
          COALESCE(SUM(CASE WHEN m.product_line='IQMIX' THEN t.sales_o_to_y ELSE 0 END),0) AS iqmix,
          COALESCE(SUM(CASE WHEN m.product_line='IQJOE' THEN t.sales_o_to_y ELSE 0 END),0) AS iqjoe,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS mapped_total,
          COALESCE(SUM(CASE WHEN m.product_line IS NULL OR m.product_line='Unmapped' THEN t.sales_o_to_y ELSE 0 END),0) AS unmapped
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
        """,
        (str(start), str(end), ch),
    ).fetchone()

    comp = None
    if cstart and cend:
        comp = conn.execute(
            """
            SELECT
              COALESCE(SUM(CASE WHEN m.product_line='IQBAR' THEN t.sales_o_to_y ELSE 0 END),0) AS iqbar,
              COALESCE(SUM(CASE WHEN m.product_line='IQMIX' THEN t.sales_o_to_y ELSE 0 END),0) AS iqmix,
              COALESCE(SUM(CASE WHEN m.product_line='IQJOE' THEN t.sales_o_to_y ELSE 0 END),0) AS iqjoe,
              COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS mapped_total
            FROM transactions t
            LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
            WHERE t.date BETWEEN ? AND ?
              AND COALESCE(t.channel,'Amazon') = ?
            """,
            (str(cstart), str(cend), ch),
        ).fetchone()
    conn.close()

    curr_total = float(curr["mapped_total"] or 0.0)
    comp_total = float(comp["mapped_total"] or 0.0) if comp else 0.0

    linear = None
    dynamic = None
    if start.day == 1 and start.year == end.year and start.month == end.month:
        lookback_start = end - timedelta(days=210)
        days_in_month = calendar.monthrange(end.year, end.month)[1]
        days_elapsed = max(end.day, 1)
        projected = (curr_total / days_elapsed) * days_in_month if days_elapsed > 0 else 0.0
        goal = get_month_goal(end.year, end.month, ch)
        pace = (projected / goal) if goal > 0 else None
        linear = {"projected_total": projected, "goal": goal, "pace_to_goal": pace, "delta": (pace - 1.0) if pace is not None else None}

        daily = read_df(
            """
            SELECT t.date AS date, COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS total
            FROM transactions t
            LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
            WHERE t.date BETWEEN ? AND ?
              AND COALESCE(t.channel,'Amazon') = ?
            GROUP BY t.date
            ORDER BY t.date
            """,
            (str(lookback_start), str(end), ch),
        )
        dyn = compute_dynamic_month_projection(daily, end)
        if dyn is not None:
            dpace = (dyn["projected_total"] / goal) if goal > 0 else None
            dynamic = {
                "projected_total": float(dyn["projected_total"]),
                "goal": goal,
                "pace_to_goal": dpace,
                "delta": (dpace - 1.0) if dpace is not None else None,
            }

    return {
        "period": {"start_date": str(start), "end_date": str(end)},
        "compare_period": {"start_date": str(cstart) if cstart else None, "end_date": str(cend) if cend else None},
        "current": {
            "grand_total": curr_total,
            "iqbar": float(curr["iqbar"] or 0.0),
            "iqmix": float(curr["iqmix"] or 0.0),
            "iqjoe": float(curr["iqjoe"] or 0.0),
            "unmapped": float(curr["unmapped"] or 0.0),
        },
        "compare": {
            "grand_total": comp_total,
            "iqbar": float(comp["iqbar"] or 0.0) if comp else 0.0,
            "iqmix": float(comp["iqmix"] or 0.0) if comp else 0.0,
            "iqjoe": float(comp["iqjoe"] or 0.0) if comp else 0.0,
        },
        "deltas": {
            "grand_total": pct_delta(curr_total, comp_total),
            "iqbar": pct_delta(float(curr["iqbar"] or 0.0), float(comp["iqbar"] or 0.0) if comp else 0.0),
            "iqmix": pct_delta(float(curr["iqmix"] or 0.0), float(comp["iqmix"] or 0.0) if comp else 0.0),
            "iqjoe": pct_delta(float(curr["iqjoe"] or 0.0), float(comp["iqjoe"] or 0.0) if comp else 0.0),
        },
        "mtd": {"linear": linear, "dynamic": dynamic},
    }


@app.get("/api/sales/daily")
def sales_daily(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        rows = read_df(
            """
            SELECT
              d.date,
              COALESCE(SUM(CASE WHEN d.product_line='IQBAR' THEN d.sales ELSE 0 END),0) AS iqbar,
              COALESCE(SUM(CASE WHEN d.product_line='IQMIX' THEN d.sales ELSE 0 END),0) AS iqmix,
              COALESCE(SUM(CASE WHEN d.product_line='IQJOE' THEN d.sales ELSE 0 END),0) AS iqjoe,
              COALESCE(SUM(d.sales),0) AS total
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY d.date
            ORDER BY d.date
            """,
            (str(start), str(end)),
        )
        return {"rows": rows.to_dict(orient="records")}
    rows = read_df(
        """
        SELECT
          t.date,
          COALESCE(SUM(CASE WHEN m.product_line='IQBAR' THEN t.sales_o_to_y ELSE 0 END),0) AS iqbar,
          COALESCE(SUM(CASE WHEN m.product_line='IQMIX' THEN t.sales_o_to_y ELSE 0 END),0) AS iqmix,
          COALESCE(SUM(CASE WHEN m.product_line='IQJOE' THEN t.sales_o_to_y ELSE 0 END),0) AS iqjoe,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS total
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
        GROUP BY t.date
        ORDER BY t.date
        """,
        (str(start), str(end), ch),
    )
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/sales/pivot")
def sales_pivot(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        rows = read_df(
            """
            SELECT
              d.date,
              COALESCE(SUM(CASE WHEN d.product_line='IQBAR' THEN d.sales ELSE 0 END),0) AS iqbar,
              COALESCE(SUM(CASE WHEN d.product_line='IQMIX' THEN d.sales ELSE 0 END),0) AS iqmix,
              COALESCE(SUM(CASE WHEN d.product_line='IQJOE' THEN d.sales ELSE 0 END),0) AS iqjoe,
              COALESCE(SUM(d.sales),0) AS grand_total
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY d.date
            ORDER BY d.date
            """,
            (str(start), str(end)),
        )
        rows["unmapped"] = 0.0
        rows["date_label"] = pd.to_datetime(rows["date"], errors="coerce").dt.strftime("%B %-d, %Y")
        return {"rows": rows[["date", "date_label", "grand_total", "iqbar", "iqmix", "iqjoe", "unmapped"]].to_dict(orient="records")}
    rows = read_df(
        """
        SELECT
          t.date,
          COALESCE(SUM(CASE WHEN m.product_line='IQBAR' THEN t.sales_o_to_y ELSE 0 END),0) AS iqbar,
          COALESCE(SUM(CASE WHEN m.product_line='IQMIX' THEN t.sales_o_to_y ELSE 0 END),0) AS iqmix,
          COALESCE(SUM(CASE WHEN m.product_line='IQJOE' THEN t.sales_o_to_y ELSE 0 END),0) AS iqjoe,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS grand_total,
          COALESCE(SUM(CASE WHEN m.product_line IS NULL OR m.product_line='Unmapped' THEN t.sales_o_to_y ELSE 0 END),0) AS unmapped
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
        GROUP BY t.date
        ORDER BY t.date
        """,
        (str(start), str(end), ch),
    )
    rows["date_label"] = pd.to_datetime(rows["date"], errors="coerce").dt.strftime("%B %-d, %Y")
    return {"rows": rows[["date", "date_label", "grand_total", "iqbar", "iqmix", "iqjoe", "unmapped"]].to_dict(orient="records")}


@app.get("/api/pnl/summary")
def pnl_summary(start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
    start, end = clamp_dates(start_date, end_date)
    cstart, cend = compare_window(start, end, "previous_period")
    row = read_df(
        """
        SELECT
          COALESCE(SUM(sales_o_to_y),0) AS gross_sales,
          COALESCE(SUM(total),0) AS net_payout,
          COALESCE(SUM(selling_fees),0) AS selling_fees,
          COALESCE(SUM(fba_fees),0) AS fba_fees,
          COALESCE(SUM(other_transaction_fees),0) AS other_transaction_fees,
          COALESCE(SUM(other),0) AS other
        FROM transactions
        WHERE date BETWEEN ? AND ?
        """,
        (str(start), str(end)),
    ).iloc[0]
    cmp_row = read_df(
        """
        SELECT
          COALESCE(SUM(sales_o_to_y),0) AS gross_sales,
          COALESCE(SUM(total),0) AS net_payout,
          COALESCE(SUM(selling_fees),0) AS selling_fees,
          COALESCE(SUM(fba_fees),0) AS fba_fees,
          COALESCE(SUM(other_transaction_fees),0) AS other_transaction_fees,
          COALESCE(SUM(other),0) AS other
        FROM transactions
        WHERE date BETWEEN ? AND ?
        """,
        (str(cstart), str(cend)),
    ).iloc[0]

    reasons = read_df(
        """
        SELECT
          COALESCE(NULLIF(TRIM(description), ''), 'Other') AS reason,
          COALESCE(SUM(other),0) AS amount
        FROM transactions
        WHERE date BETWEEN ? AND ?
          AND COALESCE(other,0) <> 0
        GROUP BY 1
        ORDER BY ABS(COALESCE(SUM(other),0)) DESC
        """,
        (str(start), str(end)),
    )

    fees = pd.DataFrame(
        [
            {
                "label": "Selling Fees",
                "amount": float(row["selling_fees"] or 0.0),
                "compare": float(cmp_row["selling_fees"] or 0.0),
            },
            {
                "label": "FBA Fees",
                "amount": float(row["fba_fees"] or 0.0),
                "compare": float(cmp_row["fba_fees"] or 0.0),
            },
            {
                "label": "Other Txn Fees",
                "amount": float(row["other_transaction_fees"] or 0.0),
                "compare": float(cmp_row["other_transaction_fees"] or 0.0),
            },
            {
                "label": "Other",
                "amount": float(row["other"] or 0.0),
                "compare": float(cmp_row["other"] or 0.0),
            },
        ]
    ).sort_values("amount")
    fees["delta_pct"] = fees.apply(lambda r: pct_delta(float(r["amount"]), float(r["compare"])), axis=1)
    reimbursements = reasons[reasons["amount"] > 0].copy().sort_values("amount", ascending=False)
    fee_reasons = reasons[reasons["amount"] < 0].copy().sort_values("amount")

    gross = float(row["gross_sales"] or 0.0)
    net = float(row["net_payout"] or 0.0)
    cmp_gross = float(cmp_row["gross_sales"] or 0.0)
    cmp_net = float(cmp_row["net_payout"] or 0.0)
    margin = (net / gross) if abs(gross) > 1e-9 else None
    cmp_margin = (cmp_net / cmp_gross) if abs(cmp_gross) > 1e-9 else None
    return {
        "period": {"start_date": str(start), "end_date": str(end)},
        "compare_period": {"start_date": str(cstart), "end_date": str(cend)},
        "kpis": {
            "gross_sales": gross,
            "net_payout": net,
            "margin": margin,
            "gross_sales_delta": pct_delta(gross, cmp_gross),
            "net_payout_delta": pct_delta(net, cmp_net),
            "margin_pp_delta": (margin - cmp_margin) if (margin is not None and cmp_margin is not None) else None,
        },
        "fees": fees.to_dict(orient="records"),
        "fee_reasons": fee_reasons.to_dict(orient="records"),
        "reimbursements": reimbursements.to_dict(orient="records"),
        "other_reasons": reasons.to_dict(orient="records"),
    }


@app.get("/api/product/summary")
def product_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        rows = read_df(
            """
            SELECT
              d.product_line AS product_line,
              COALESCE(SUM(d.sales),0) AS sales,
              COALESCE(SUM(d.units),0) AS units,
              COALESCE(SUM(d.orders),0) AS orders
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY d.product_line
            ORDER BY sales DESC
            """,
            (str(start), str(end)),
        )
        rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
        return {"rows": rows.to_dict(orient="records")}
    rows = read_df(
        """
        SELECT
          COALESCE(m.product_line, 'Unmapped') AS product_line,
          COALESCE(SUM(t.sales_o_to_y),0) AS sales,
          COALESCE(SUM(t.quantity),0) AS units,
          COUNT(DISTINCT t.order_id) AS orders
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
        GROUP BY 1
        ORDER BY sales DESC
        """,
        (str(start), str(end), ch),
    )
    rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/product/trend")
def product_trend(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = "day",
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        bucket = "d.date"
        if granularity == "week":
            bucket = "strftime('%Y-%W', d.date)"
        elif granularity == "month":
            bucket = "substr(d.date, 1, 7)"
        rows = read_df(
            f"""
            SELECT
              {bucket} AS period,
              d.product_line AS product_line,
              COALESCE(SUM(d.sales),0) AS sales,
              COALESCE(SUM(d.units),0) AS units,
              COALESCE(SUM(d.orders),0) AS orders
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY 1,2
            ORDER BY 1,2
            """,
            (str(start), str(end)),
        )
        rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
        return {"rows": rows.to_dict(orient="records")}
    bucket = "t.date"
    if granularity == "week":
        bucket = "strftime('%Y-%W', t.date)"
    elif granularity == "month":
        bucket = "substr(t.date, 1, 7)"

    rows = read_df(
        f"""
        SELECT
          {bucket} AS period,
          COALESCE(m.product_line,'Unmapped') AS product_line,
          COALESCE(SUM(t.sales_o_to_y),0) AS sales,
          COALESCE(SUM(t.quantity),0) AS units,
          COUNT(DISTINCT t.order_id) AS orders
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
        GROUP BY 1,2
        ORDER BY 1,2
        """,
        (str(start), str(end), ch),
    )
    rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/product/sku-summary")
def product_sku_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_line: str = "IQBAR",
    product_tag: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        if product_line not in {"IQBAR", "IQMIX", "IQJOE"}:
            return {"rows": []}
        rows = read_df(
            """
            SELECT
              d.product_line AS sku,
              COALESCE(SUM(d.sales),0) AS sales,
              COALESCE(SUM(d.units),0) AS units,
              COALESCE(SUM(d.orders),0) AS orders
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
              AND d.product_line = ?
            GROUP BY 1
            ORDER BY sales DESC
            """,
            (str(start), str(end), product_line),
        )
        rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
        return {"rows": rows.to_dict(orient="records")}
    rows = read_df(
        """
        SELECT
          t.sku,
          COALESCE(SUM(t.sales_o_to_y),0) AS sales,
          COALESCE(SUM(t.quantity),0) AS units,
          COUNT(DISTINCT t.order_id) AS orders
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
          AND COALESCE(m.product_line, 'Unmapped') = ?
          AND (
            COALESCE(CAST(? AS TEXT), '') = ''
            OR LOWER(TRIM(COALESCE(m.tag, t.sku))) = LOWER(TRIM(CAST(? AS TEXT)))
          )
        GROUP BY 1
        ORDER BY sales DESC
        LIMIT 100
        """,
        (str(start), str(end), ch, product_line, product_tag, product_tag),
    )
    rows["aov"] = rows.apply(lambda r: float(r["sales"]) / float(r["orders"]) if float(r["orders"]) else 0.0, axis=1)
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/product/sku-trend")
def product_sku_trend(
    sku: str = Query(...),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    metric: str = Query(default="sales"),
    channel: str = Query(default="Amazon"),
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        line = normalize_product_line(sku) if str(sku).upper() in {"IQBAR", "IQMIX", "IQJOE"} else str(sku).upper()
        metric_col = "sales" if metric != "units" else "units"
        rows = read_df(
            f"""
            SELECT
              d.date,
              COALESCE(SUM(d.{metric_col}),0) AS value
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
              AND d.product_line = ?
            GROUP BY 1
            ORDER BY 1
            """,
            (str(start), str(end), line),
        )
        return {"rows": rows.to_dict(orient="records")}
    metric_col = "sales_o_to_y" if metric != "units" else "quantity"
    rows = read_df(
        f"""
        SELECT
          t.date,
          COALESCE(SUM(t.{metric_col}),0) AS value
        FROM transactions t
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
          AND UPPER(TRIM(COALESCE(t.sku,''))) = UPPER(TRIM(?))
        GROUP BY 1
        ORDER BY 1
        """,
        (str(start), str(end), ch, sku),
    )
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/product/top-movers")
def product_top_movers(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_line: str = "IQBAR",
    product_tag: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    if ch == "Shopify":
        span = (end - start).days + 1
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span - 1)
        curr = read_df(
            """
            SELECT
              d.product_line AS sku,
              d.product_line AS tag,
              COALESCE(SUM(d.sales),0) AS sales
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY d.product_line
            """,
            (str(start), str(end)),
        )
        prev = read_df(
            """
            SELECT
              d.product_line AS sku,
              COALESCE(SUM(d.sales),0) AS prev_sales
            FROM shopify_line_daily d
            WHERE d.date BETWEEN ? AND ?
            GROUP BY d.product_line
            """,
            (str(prev_start), str(prev_end)),
        )
        if curr.empty:
            return {"gainers": [], "decliners": []}
        merged = curr.merge(prev, on="sku", how="left")
        merged["prev_sales"] = merged["prev_sales"].fillna(0)
        merged["change"] = merged["sales"] - merged["prev_sales"]
        merged["change_pct"] = merged.apply(lambda r: pct_delta(float(r["sales"]), float(r["prev_sales"])), axis=1)
        gainers = merged.sort_values("change", ascending=False).head(5)
        decliners = merged.sort_values("change", ascending=True).head(5)
        return {
            "gainers": gainers[["sku", "tag", "sales", "prev_sales", "change", "change_pct"]].to_dict(orient="records"),
            "decliners": decliners[["sku", "tag", "sales", "prev_sales", "change", "change_pct"]].to_dict(orient="records"),
        }
    span = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)
    curr = read_df(
        """
        SELECT
          t.sku,
          MIN(COALESCE(m.tag, t.sku)) AS tag,
          COALESCE(SUM(t.sales_o_to_y),0) AS sales,
          COALESCE(SUM(t.quantity),0) AS units
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
          AND COALESCE(m.product_line, 'Unmapped') = ?
          AND (
            COALESCE(CAST(? AS TEXT), '') = ''
            OR LOWER(TRIM(COALESCE(m.tag, t.sku))) = LOWER(TRIM(CAST(? AS TEXT)))
          )
        GROUP BY t.sku
        """,
        (str(start), str(end), ch, product_line, product_tag, product_tag),
    )
    prev = read_df(
        """
        SELECT
          t.sku,
          COALESCE(SUM(t.sales_o_to_y),0) AS prev_sales,
          COALESCE(SUM(t.quantity),0) AS prev_units
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date BETWEEN ? AND ?
          AND COALESCE(t.channel,'Amazon') = ?
          AND COALESCE(m.product_line, 'Unmapped') = ?
          AND (
            COALESCE(CAST(? AS TEXT), '') = ''
            OR LOWER(TRIM(COALESCE(m.tag, t.sku))) = LOWER(TRIM(CAST(? AS TEXT)))
          )
        GROUP BY t.sku
        """,
        (str(prev_start), str(prev_end), ch, product_line, product_tag, product_tag),
    )
    if curr.empty:
        return {"gainers": [], "decliners": []}
    merged = curr.merge(prev, on="sku", how="left")
    merged["prev_sales"] = merged["prev_sales"].fillna(0)
    merged["change"] = merged["sales"] - merged["prev_sales"]
    merged["change_pct"] = merged.apply(
        lambda r: pct_delta(float(r["sales"]), float(r["prev_sales"])), axis=1
    )
    gainers = merged.sort_values("change", ascending=False).head(5)
    decliners = merged.sort_values("change", ascending=True).head(5)
    return {
        "gainers": gainers[["sku", "tag", "sales", "prev_sales", "change", "change_pct"]].to_dict(orient="records"),
        "decliners": decliners[["sku", "tag", "sales", "prev_sales", "change", "change_pct"]].to_dict(orient="records"),
    }


@app.get("/api/business/monthly")
def business_monthly(channel: str = "Amazon") -> dict:
    ch = normalize_channel(channel)
    if ch == "Shopify":
        rows = read_df(
            """
            SELECT
              substr(date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN product_line='IQBAR' THEN sales ELSE 0 END),0) AS iqbar,
              COALESCE(SUM(CASE WHEN product_line='IQMIX' THEN sales ELSE 0 END),0) AS iqmix,
              COALESCE(SUM(CASE WHEN product_line='IQJOE' THEN sales ELSE 0 END),0) AS iqjoe,
              COALESCE(SUM(sales),0) AS total
            FROM shopify_line_daily
            WHERE date IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            """
        )
        if rows.empty:
            return {"rows": [], "summary": {"months": 0, "total_sales": 0.0, "avg_monthly_sales": 0.0, "cagr": None}}
        max_month = str(rows["month"].max())
        max_dt = datetime.strptime(f"{max_month}-01", "%Y-%m-%d").date()
        max_day = int(read_df("SELECT MAX(date) AS max_date FROM shopify_line_daily").iloc[0]["max_date"][-2:])
        month_days = calendar.monthrange(max_dt.year, max_dt.month)[1]
        if max_day < month_days:
            rows = rows[rows["month"] != max_month].copy()
        cagr = None
        if len(rows) >= 13:
            first = float(rows.iloc[0]["total"] or 0.0)
            last = float(rows.iloc[-1]["total"] or 0.0)
            years = len(rows) / 12.0
            if first > 0 and years > 0:
                cagr = (last / first) ** (1 / years) - 1
        return {
            "rows": rows.to_dict(orient="records"),
            "summary": {
                "months": int(len(rows)),
                "total_sales": float(rows["total"].sum()),
                "avg_monthly_sales": float(rows["total"].mean()) if len(rows) else 0.0,
                "cagr": cagr,
            },
        }
    rows = read_df(
        """
        SELECT
          substr(date, 1, 7) AS month,
          COALESCE(SUM(CASE WHEN m.product_line='IQBAR' THEN t.sales_o_to_y ELSE 0 END),0) AS iqbar,
          COALESCE(SUM(CASE WHEN m.product_line='IQMIX' THEN t.sales_o_to_y ELSE 0 END),0) AS iqmix,
          COALESCE(SUM(CASE WHEN m.product_line='IQJOE' THEN t.sales_o_to_y ELSE 0 END),0) AS iqjoe,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS total
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE date IS NOT NULL
          AND COALESCE(t.channel,'Amazon') = ?
        GROUP BY 1
        ORDER BY 1
        """,
        (ch,),
    )

    if rows.empty:
        return {"rows": [], "summary": {"months": 0, "total_sales": 0.0, "avg_monthly_sales": 0.0, "cagr": None}}

    max_month = str(rows["month"].max())
    max_dt = datetime.strptime(f"{max_month}-01", "%Y-%m-%d").date()
    max_day = int(read_df("SELECT MAX(date) AS max_date FROM transactions WHERE COALESCE(channel,'Amazon') = ?", (ch,)).iloc[0]["max_date"][-2:])
    month_days = calendar.monthrange(max_dt.year, max_dt.month)[1]
    if max_day < month_days:
        rows = rows[rows["month"] != max_month].copy()

    cagr = None
    if len(rows) >= 13:
        first = float(rows.iloc[0]["total"] or 0.0)
        last = float(rows.iloc[-1]["total"] or 0.0)
        years = len(rows) / 12.0
        if first > 0 and years > 0:
            cagr = (last / first) ** (1 / years) - 1

    return {
        "rows": rows.to_dict(orient="records"),
        "summary": {
            "months": int(len(rows)),
            "total_sales": float(rows["total"].sum()),
            "avg_monthly_sales": float(rows["total"].mean()) if len(rows) else 0.0,
            "cagr": cagr,
        },
    }


@app.get("/api/forecast/mtd")
def forecast_mtd(
    as_of_date: Optional[str] = None,
    recent_weight: float = 0.6,
    mom_weight: float = 0.4,
    weekday_strength: float = 1.0,
    manual_multiplier: float = 1.0,
    promo_lift_pct: float = 0.0,
    content_lift_pct: float = 0.0,
    instock_rate: float = 1.0,
    growth_floor: float = 0.5,
    growth_ceiling: float = 1.8,
    volatility_multiplier: float = 1.0,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    if ch == "Shopify":
        max_date_row = read_df("SELECT MAX(date) AS max_date FROM shopify_line_daily WHERE date IS NOT NULL")
    else:
        max_date_row = read_df("SELECT MAX(date) AS max_date FROM transactions WHERE date IS NOT NULL AND COALESCE(channel,'Amazon') = ?", (ch,))
    if max_date_row.empty or not str(max_date_row.iloc[0]["max_date"]):
        return {"projection": None}
    as_of = parse_iso(as_of_date) if as_of_date else parse_iso(str(max_date_row.iloc[0]["max_date"]))
    month_start = date(as_of.year, as_of.month, 1)

    if ch == "Shopify":
        daily = read_df(
            """
            SELECT date, COALESCE(SUM(sales),0) AS total
            FROM shopify_line_daily
            WHERE date IS NOT NULL
            GROUP BY date
            ORDER BY date
            """
        )
    else:
        daily = read_df(
            """
            SELECT t.date AS date, COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS total
            FROM transactions t
            LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
            WHERE t.date IS NOT NULL
              AND COALESCE(t.channel,'Amazon') = ?
            GROUP BY t.date
            ORDER BY t.date
            """,
            (ch,),
        )
    assumptions = {
        "recent_weight": recent_weight,
        "mom_weight": mom_weight,
        "weekday_strength": weekday_strength,
        "manual_multiplier": manual_multiplier,
        "promo_lift_pct": promo_lift_pct,
        "content_lift_pct": content_lift_pct,
        "instock_rate": instock_rate,
        "growth_floor": growth_floor,
        "growth_ceiling": growth_ceiling,
        "volatility_multiplier": volatility_multiplier,
    }
    projection = compute_dynamic_month_projection(daily, as_of, assumptions=assumptions)
    if projection is None:
        return {"projection": None}

    mape = backtest_projection_mape_with_assumptions(daily, projection["elapsed_days"], month_start, assumptions)
    sig = growth_significance(daily, as_of, assumptions)
    goal = get_month_goal(as_of.year, as_of.month, ch)
    pace = (float(projection["projected_total"]) / goal) if goal > 0 else None

    chart = projection["chart_df"].copy()
    chart["date"] = pd.to_datetime(chart["date"]).dt.strftime("%Y-%m-%d")
    return {
        "projection": {
            "as_of_date": str(as_of),
            "mtd_actual": float(projection["mtd_actual"]),
            "projected_total": float(projection["projected_total"]),
            "ci_low": float(projection["ci_low"]),
            "ci_high": float(projection["ci_high"]),
            "growth_factor": float(projection["growth_factor"]),
            "goal": goal,
            "pace_to_goal": pace,
            "pace_delta": (pace - 1.0) if pace is not None else None,
            "mape": float(mape["mape"]) if mape else None,
            "mape_months": int(mape["count"]) if mape else 0,
            "stat_sig": sig,
            "chart": chart.to_dict(orient="records"),
            "backtest": mape["details"].to_dict(orient="records") if mape else [],
        }
    }


@app.get("/api/seasonality/month-weekday")
def seasonality_month_weekday() -> dict:
    rows = read_df(
        """
        SELECT
          CAST(strftime('%m', t.date) AS INTEGER) AS month_num,
          strftime('%m', t.date) AS month,
          CAST(strftime('%w', t.date) AS INTEGER) AS weekday_num,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS sales,
          COUNT(*) AS days
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE t.date IS NOT NULL
        GROUP BY 1,2,3
        ORDER BY 1,3
        """
    )
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/seasonality/calendar")
def seasonality_calendar(year: int = date.today().year) -> dict:
    rows = read_df(
        """
        SELECT
          t.date AS date,
          COALESCE(SUM(CASE WHEN m.product_line IN ('IQBAR','IQMIX','IQJOE') THEN t.sales_o_to_y ELSE 0 END),0) AS sales
        FROM transactions t
        LEFT JOIN sku_mapping m ON UPPER(TRIM(t.sku)) = m.sku_key
        WHERE substr(t.date,1,4)=?
        GROUP BY t.date
        ORDER BY t.date
        """,
        (str(year),),
    )
    return {"rows": rows.to_dict(orient="records")}


def _inventory_snapshot_payload(
    snapshot_id: int,
    snapshot_meta: sqlite3.Row,
    w7: int = 40,
    w30: int = 30,
    w60: int = 20,
    w90: int = 10,
    target_wos: float = 8.0,
) -> dict:
    inv = read_df(
        """
        SELECT
          UPPER(TRIM(COALESCE(i.sku,''))) AS sku_key,
          i.sku,
          i.fnsku,
          i.asin,
          i.product_name,
          COALESCE(m.product_line, i.product_line, 'Unmapped') AS product_line,
          COALESCE(m.tag, i.product_name, i.sku) AS tag,
          COALESCE(m.unit_count, '') AS unit_count,
          COALESCE(m.size, '') AS size,
          COALESCE(i.afn_total_quantity,0) AS total_inventory,
          COALESCE(i.afn_fulfillable_quantity,0) AS available,
          (COALESCE(i.afn_inbound_working_quantity,0)+COALESCE(i.afn_inbound_shipped_quantity,0)+COALESCE(i.afn_inbound_receiving_quantity,0)) AS inbound,
          COALESCE(i.afn_reserved_quantity,0) AS reserved,
          CASE WHEN m.sku_key IS NOT NULL THEN 1 ELSE 0 END AS in_mapping
        FROM inventory_items i
        LEFT JOIN sku_mapping m ON UPPER(TRIM(i.sku)) = m.sku_key
        WHERE i.snapshot_id = ?
        """,
        (int(snapshot_id),),
    )
    if inv.empty:
        return {"snapshot": dict(snapshot_meta), "rows": [], "by_line": {}}

    inv = inv[inv["in_mapping"] == 1].copy()
    inv = inv[~inv["tag"].astype(str).str.contains("manual override", case=False, na=False)].copy()
    units = read_df(
        """
        WITH bounds AS (SELECT MAX(date) AS max_date FROM transactions)
        SELECT
          UPPER(TRIM(COALESCE(sku, ''))) AS sku_key,
          SUM(CASE WHEN date BETWEEN date(bounds.max_date, '-6 day') AND bounds.max_date AND COALESCE(quantity,0)>0 AND COALESCE(sales_o_to_y,0)>0 THEN quantity ELSE 0 END) AS units_7d,
          SUM(CASE WHEN date BETWEEN date(bounds.max_date, '-29 day') AND bounds.max_date AND COALESCE(quantity,0)>0 AND COALESCE(sales_o_to_y,0)>0 THEN quantity ELSE 0 END) AS units_30d,
          SUM(CASE WHEN date BETWEEN date(bounds.max_date, '-59 day') AND bounds.max_date AND COALESCE(quantity,0)>0 AND COALESCE(sales_o_to_y,0)>0 THEN quantity ELSE 0 END) AS units_60d,
          SUM(CASE WHEN date BETWEEN date(bounds.max_date, '-89 day') AND bounds.max_date AND COALESCE(quantity,0)>0 AND COALESCE(sales_o_to_y,0)>0 THEN quantity ELSE 0 END) AS units_90d
        FROM transactions, bounds
        WHERE bounds.max_date IS NOT NULL
        GROUP BY UPPER(TRIM(COALESCE(sku, '')))
        """
    )
    inv = inv.merge(units, on="sku_key", how="left")
    for c in ["units_7d", "units_30d", "units_60d", "units_90d"]:
        inv[c] = pd.to_numeric(inv[c], errors="coerce").fillna(0.0)

    weight_total = w7 + w30 + w60 + w90
    if weight_total == 0:
        w7, w30, w60, w90, weight_total = 40, 30, 20, 10, 100

    inv["daily_demand"] = (
        (inv["units_7d"] / 7.0) * (w7 / weight_total)
        + (inv["units_30d"] / 30.0) * (w30 / weight_total)
        + (inv["units_60d"] / 60.0) * (w60 / weight_total)
        + (inv["units_90d"] / 90.0) * (w90 / weight_total)
    )
    inv["wos"] = inv.apply(
        lambda r: float(max(r["total_inventory"], r["available"] + r["inbound"])) / (float(r["daily_demand"]) * 7.0)
        if float(r["daily_demand"]) > 0
        else math.nan,
        axis=1,
    )
    inv["pct_avail"] = inv.apply(
        lambda r: (float(r["available"]) / float(r["total_inventory"])) if float(r["total_inventory"]) > 0 else 0.0,
        axis=1,
    )

    def status(r):
        if float(r["available"]) <= 0:
            return "OOS"
        if pd.isna(r["wos"]):
            return "No Demand"
        if float(r["wos"]) < 2:
            return "Critical"
        if float(r["wos"]) < 4:
            return "Restock"
        if float(r["wos"]) < 8:
            return "At Risk"
        return "Healthy"

    inv["status"] = inv.apply(status, axis=1)
    inv["restock_units"] = inv.apply(
        lambda r: max(0.0, (float(r["daily_demand"]) * 7.0 * float(target_wos)) - (float(r["available"]) + float(r["inbound"]))), axis=1
    )
    base_dt = pd.to_datetime(snapshot_meta["imported_at"], errors="coerce")
    if pd.isna(base_dt):
        base_dt = pd.Timestamp.today()
    inv["est_oos_date"] = inv.apply(
        lambda r: None
        if float(r["daily_demand"]) <= 0
        else (base_dt + pd.to_timedelta(float(r["total_inventory"]) / float(r["daily_demand"]), unit="D")).strftime("%B %-d, %Y"),
        axis=1,
    )

    cols = [
        "product_line",
        "tag",
        "sku",
        "wos",
        "status",
        "pct_avail",
        "daily_demand",
        "units_30d",
        "total_inventory",
        "inbound",
        "available",
        "reserved",
        "restock_units",
        "est_oos_date",
    ]
    inv = inv[cols].copy()
    inv = inv.sort_values(["product_line", "wos"], ascending=[True, True], na_position="last")

    by_line = {}
    for line in ["IQBAR", "IQMIX", "IQJOE"]:
        line_df = inv[inv["product_line"] == line]
        by_line[line] = line_df.to_dict(orient="records")

    return {
        "snapshot": dict(snapshot_meta),
        "rows": inv.to_dict(orient="records"),
        "by_line": by_line,
        "weights": {"w7": w7, "w30": w30, "w60": w60, "w90": w90, "target_wos": target_wos},
    }


@app.get("/api/inventory/latest")
def inventory_latest(
    w7: int = 40,
    w30: int = 30,
    w60: int = 20,
    w90: int = 10,
    target_wos: float = 8.0,
) -> dict:
    conn = db_conn()
    snap = conn.execute("SELECT id, imported_at, source_file, row_count FROM inventory_snapshots ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()
    if not snap:
        return {"snapshot": None, "rows": [], "by_line": {}}
    return _inventory_snapshot_payload(int(snap["id"]), snap, w7=w7, w30=w30, w60=w60, w90=w90, target_wos=target_wos)


@app.get("/api/inventory/snapshot")
def inventory_snapshot(
    snapshot_id: int = Query(...),
    w7: int = 40,
    w30: int = 30,
    w60: int = 20,
    w90: int = 10,
    target_wos: float = 8.0,
) -> dict:
    conn = db_conn()
    snap = conn.execute(
        "SELECT id, imported_at, source_file, row_count FROM inventory_snapshots WHERE id = ?",
        (int(snapshot_id),),
    ).fetchone()
    conn.close()
    if not snap:
        return {"snapshot": None, "rows": [], "by_line": {}}
    return _inventory_snapshot_payload(int(snap["id"]), snap, w7=w7, w30=w30, w60=w60, w90=w90, target_wos=target_wos)


@app.get("/api/inventory/history")
def inventory_history() -> dict:
    rows = read_df(
        """
        SELECT
          s.id,
          s.imported_at,
          s.source_file,
          COALESCE(SUM(i.afn_total_quantity),0) AS total_units
        FROM inventory_snapshots s
        LEFT JOIN inventory_items i ON i.snapshot_id = s.id
        GROUP BY s.id, s.imported_at, s.source_file
        ORDER BY s.id
        """
    )
    return {"rows": rows.to_dict(orient="records")}


@app.get("/api/inventory/insights")
def inventory_insights(
    w7: int = 40,
    w30: int = 30,
    w60: int = 20,
    w90: int = 10,
) -> dict:
    latest = inventory_latest(w7=w7, w30=w30, w60=w60, w90=w90)
    rows = pd.DataFrame(latest.get("rows") or [])
    if rows.empty:
        return {"kpis": {}, "insights": []}
    total = len(rows)
    in_zone = int((rows["wos"] >= 8).sum())
    critical = rows[rows["wos"] < 2]
    restock = rows[(rows["wos"] >= 2) & (rows["wos"] < 4)]
    overstock = rows[rows["wos"] >= 16]
    return {
        "kpis": {
            "in_stock_quality": (in_zone / total) if total else None,
            "critical_skus": int(len(critical)),
            "restock_queue": int(len(restock)),
            "overstock_skus": int(len(overstock)),
        },
        "insights": [
            f"{in_zone}/{total} SKUs are at 8+ WOS.",
            f"{len(critical)} SKUs are critical (<2 WOS).",
            f"{len(restock)} SKUs are in restock range (2-4 WOS).",
        ],
    }


def _get_setting(key: str, default: str = "") -> str:
    conn = db_conn()
    row = conn.execute("SELECT setting_value FROM app_settings WHERE setting_key = ?", (key,)).fetchone()
    conn.close()
    return str(row["setting_value"]) if row else default


def _set_setting(key: str, value: str) -> None:
    conn = db_conn()
    conn.execute(
        """
        INSERT INTO app_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value=excluded.setting_value,
          updated_at=excluded.updated_at
        """,
        (key, value, datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    conn.close()


@app.get("/api/settings")
def settings_get() -> dict:
    auto = _get_setting("auto_slack_on_import", "true").lower() == "true"
    return {"auto_slack_on_import": auto}


@app.post("/api/settings")
def settings_set(auto_slack_on_import: bool = Query(default=True)) -> dict:
    _set_setting("auto_slack_on_import", "true" if auto_slack_on_import else "false")
    return {"ok": True, "auto_slack_on_import": auto_slack_on_import}


@app.get("/api/goals")
def goals_get(channel: str = "Amazon", year: Optional[int] = None) -> dict:
    params: list[object] = [channel]
    where = "LOWER(channel) = LOWER(?)"
    if year is not None:
        where += " AND year = ?"
        params.append(int(year))
    rows = read_df(
        f"""
        SELECT year, month, channel, product_line, goal, source_file, updated_at
        FROM monthly_goals
        WHERE {where}
        ORDER BY year, month, product_line
        """,
        tuple(params),
    )
    return {"rows": rows.to_dict(orient="records")}


@app.post("/api/goals/upsert")
def goals_upsert(
    year: int = Query(...),
    month: int = Query(...),
    product_line: str = Query(...),
    goal: float = Query(...),
    channel: str = Query(default="Amazon"),
) -> dict:
    m = int(month)
    if m < 1 or m > 12:
        return {"ok": False, "error": "Month must be between 1 and 12."}
    g = float(goal)
    if g < 0:
        return {"ok": False, "error": "Goal must be non-negative."}
    now = datetime.now().isoformat(timespec="seconds")
    conn = db_conn()
    try:
        cur = conn.execute(
            """
            UPDATE monthly_goals
            SET goal = ?, source_file = ?, updated_at = ?
            WHERE year = ? AND month = ? AND LOWER(channel) = LOWER(?) AND UPPER(product_line) = UPPER(?)
            """,
            (g, "ui_edit", now, int(year), m, channel, product_line),
        )
        if int(cur.rowcount or 0) == 0:
            conn.execute(
                """
                INSERT INTO monthly_goals (year, month, channel, product_line, goal, source_file, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (int(year), m, channel, product_line, g, "ui_edit", now),
            )
        conn.commit()
    finally:
        conn.close()
    return {
        "ok": True,
        "row": {
            "year": int(year),
            "month": m,
            "channel": channel,
            "product_line": product_line,
            "goal": g,
            "source_file": "ui_edit",
            "updated_at": now,
        },
    }


@app.get("/api/import/history")
def import_history(channel: str = "Amazon") -> dict:
    ch = normalize_channel(channel)
    if ch == "Shopify":
        rows = read_df(
            """
            SELECT id, imported_at, source_file, row_count, min_date, max_date, NULL AS total_sales_o_to_y, 'Shopify' AS channel
            FROM shopify_imports
            ORDER BY imported_at DESC
            """
        )
        return {"rows": rows.to_dict(orient="records")}
    rows = read_df(
        """
        SELECT id, imported_at, source_file, row_count, min_date, max_date, total_sales_o_to_y, COALESCE(channel,'Amazon') AS channel
        FROM imports
        WHERE COALESCE(channel,'Amazon') = ?
        ORDER BY imported_at DESC
        """,
        (ch,),
    )
    return {"rows": rows.to_dict(orient="records")}


@app.delete("/api/import/payments")
def delete_import_payment(import_id: int = Query(..., gt=0), channel: str = Query(default="Amazon")) -> dict:
    ch = normalize_channel(channel)
    conn = db_conn()
    try:
        if ch == "Shopify":
            row = conn.execute(
                "SELECT id FROM shopify_imports WHERE id = ?",
                (import_id,),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "Import not found."}
            deleted_tx = conn.execute("DELETE FROM shopify_line_daily WHERE import_id = ?", (import_id,)).rowcount
            deleted_imports = conn.execute("DELETE FROM shopify_imports WHERE id = ?", (import_id,)).rowcount
            conn.commit()
            return {
                "ok": True,
                "deleted_import_id": int(import_id),
                "deleted_import_rows": int(deleted_imports or 0),
                "deleted_transaction_rows": int(deleted_tx or 0),
            }

        row = conn.execute(
            """
            SELECT id, imported_at, source_file
            FROM imports
            WHERE id = ? AND COALESCE(channel,'Amazon') = ?
            """,
            (import_id, ch),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Import not found."}

        deleted_tx = conn.execute(
            """
            DELETE FROM transactions
            WHERE imported_at = ? AND source_file = ?
              AND COALESCE(channel,'Amazon') = ?
            """,
            (row["imported_at"], row["source_file"], ch),
        ).rowcount
        deleted_imports = conn.execute("DELETE FROM imports WHERE id = ? AND COALESCE(channel,'Amazon') = ?", (import_id, ch)).rowcount
        conn.commit()
        return {
            "ok": True,
            "deleted_import_id": int(import_id),
            "deleted_import_rows": int(deleted_imports or 0),
            "deleted_transaction_rows": int(deleted_tx or 0),
        }
    finally:
        conn.close()


@app.get("/api/import/date-coverage")
def import_date_coverage(
    start_date: str = "2024-01-01",
    end_date: Optional[str] = None,
    channel: str = "Amazon",
) -> dict:
    ch = normalize_channel(channel)
    end = parse_iso(end_date) if end_date else date.today()
    start = parse_iso(start_date)
    if start > end:
        start, end = end, start
    if ch == "Shopify":
        tx_dates = set(read_df("SELECT DISTINCT date FROM shopify_line_daily WHERE date IS NOT NULL")["date"].astype(str).tolist())
    else:
        tx_dates = set(
            read_df(
                "SELECT DISTINCT date FROM transactions WHERE date IS NOT NULL AND COALESCE(channel,'Amazon') = ?",
                (ch,),
            )["date"].astype(str).tolist()
        )
    rows = []
    d = start
    while d <= end:
        k = str(d)
        rows.append({"date": k, "uploaded": k in tx_dates})
        d += timedelta(days=1)
    return {"rows": rows}


@app.post("/api/import/payments")
async def import_payments(files: list[UploadFile] = File(...), channel: str = "Amazon") -> dict:
    ch = normalize_channel(channel)
    imported = 0
    duplicates_skipped = 0
    details = []
    for f in files:
        try:
            raw = await f.read()
            raw_path = persist_raw_upload(f.filename or "", raw, data_type="payments", channel=ch)
            parsed = parse_payments_upload(f.filename, raw)
            ins, dup = save_transactions(parsed, f.filename, channel=ch)
        except Exception as exc:
            return {"ok": False, "error": f"Payments import failed for {f.filename}: {exc}"}
        imported += int(ins)
        duplicates_skipped += int(dup)
        details.append({"file": f.filename, "inserted": int(ins), "duplicates_skipped": int(dup), "raw_path": raw_path})
    return {"ok": True, "channel": ch, "inserted": imported, "duplicates_skipped": duplicates_skipped, "details": details}


@app.post("/api/import/shopify-line")
async def import_shopify_line(
    product_line: str = Query(...),
    files: list[UploadFile] = File(...),
) -> dict:
    line = normalize_product_line(product_line)
    if not files:
        return {"ok": False, "error": "No files uploaded."}
    imports = []
    total_rows = 0
    for f in files:
        raw = await f.read()
        raw_path = persist_raw_upload(f.filename or "", raw, data_type="shopify_line_daily", channel="Shopify")
        try:
            parsed = parse_shopify_sales_by_day_upload(f.filename or "", raw)
        except Exception as exc:
            return {
                "ok": False,
                "error": f"Shopify parse failed for {f.filename}: {exc}",
                "channel": "Shopify",
                "product_line": line,
            }
        import_id, row_count = save_shopify_line_daily(parsed, f.filename or "", line)
        imports.append({"file": f.filename, "import_id": int(import_id), "rows": int(row_count), "product_line": line, "raw_path": raw_path})
        total_rows += int(row_count)
    return {"ok": True, "channel": "Shopify", "product_line": line, "rows": int(total_rows), "imports": imports}


@app.post("/api/import/inventory")
async def import_inventory(files: list[UploadFile] = File(...)) -> dict:
    snapshots = []
    for f in files:
        raw = await f.read()
        raw_path = persist_raw_upload(f.filename or "", raw, data_type="inventory", channel="Amazon")
        parsed = parse_inventory_upload(f.filename, raw)
        snap_id, row_count = save_inventory_snapshot(parsed, f.filename)
        snapshots.append({"file": f.filename, "snapshot_id": int(snap_id), "rows": int(row_count), "raw_path": raw_path})
    return {"ok": True, "snapshots": snapshots}


@app.post("/api/import/ntb")
async def import_ntb(files: list[UploadFile] = File(...), channel: str = "Amazon") -> dict:
    if not files:
        return {"ok": False, "error": "No files uploaded."}
    ch = normalize_channel(channel)
    imports = []
    total_rows = 0
    for f in files:
        raw = await f.read()
        raw_path = persist_raw_upload(f.filename or "", raw, data_type="ntb", channel=ch)
        parsed = parse_ntb_upload(f.filename, raw)
        import_id, row_count = save_ntb_snapshot(parsed, f.filename, channel=ch)
        imports.append({"file": f.filename, "import_id": int(import_id), "rows": int(row_count), "raw_path": raw_path})
        total_rows += int(row_count)
    return {"ok": True, "channel": ch, "rows": int(total_rows), "imports": imports}


@app.post("/api/import/cogs-fees")
async def import_cogs_fees(file: UploadFile = File(...)) -> dict:
    if file is None:
        return {"ok": False, "error": "No file uploaded.", "rows": [], "row_count": 0}
    raw = await file.read()
    raw_path = persist_raw_upload(file.filename or "", raw, data_type="cogs_fees", channel="Amazon")
    try:
        parsed = parse_cogs_fee_upload(file.filename or "", raw)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "rows": [], "row_count": 0}
    return {"ok": True, "rows": parsed.to_dict(orient="records"), "row_count": int(len(parsed)), "raw_path": raw_path}


@app.get("/api/ntb/monthly")
def ntb_monthly(channel: str = "Amazon") -> dict:
    ch = normalize_channel(channel)
    conn = db_conn()
    latest = conn.execute(
        "SELECT MAX(id) AS latest_id FROM ntb_imports WHERE COALESCE(channel,'Amazon') = ?",
        (ch,),
    ).fetchone()
    latest_id = int(latest["latest_id"]) if latest and latest["latest_id"] is not None else 0
    if latest_id == 0:
        conn.close()
        return {"rows": [], "updated_from": None, "updated_to": None, "imported_at": None}
    meta = conn.execute(
        "SELECT imported_at, min_month, max_month FROM ntb_imports WHERE id = ?",
        (latest_id,),
    ).fetchone()
    rows = read_df(
        """
        SELECT
            month,
            SUM(CASE WHEN product_line = 'IQBAR' THEN ntb_customers ELSE 0 END) AS iqbar,
            SUM(CASE WHEN product_line = 'IQMIX' THEN ntb_customers ELSE 0 END) AS iqmix,
            SUM(CASE WHEN product_line = 'IQJOE' THEN ntb_customers ELSE 0 END) AS iqjoe
        FROM ntb_monthly
        WHERE import_id = ?
        GROUP BY month
        ORDER BY month
        """,
        (latest_id,),
    )
    conn.close()
    if rows.empty:
        return {
            "rows": [],
            "updated_from": meta["min_month"] if meta else None,
            "updated_to": meta["max_month"] if meta else None,
            "imported_at": meta["imported_at"] if meta else None,
        }
    rows["iqbar"] = pd.to_numeric(rows["iqbar"], errors="coerce").fillna(0.0)
    rows["iqmix"] = pd.to_numeric(rows["iqmix"], errors="coerce").fillna(0.0)
    rows["iqjoe"] = pd.to_numeric(rows["iqjoe"], errors="coerce").fillna(0.0)
    rows["total_ntb"] = rows["iqbar"] + rows["iqmix"] + rows["iqjoe"]
    rows["mom_growth"] = rows["total_ntb"].pct_change()
    rows["month_label"] = pd.to_datetime(rows["month"], errors="coerce").dt.strftime("%b %Y")
    return {
        "rows": rows[["month", "month_label", "iqbar", "iqmix", "iqjoe", "total_ntb", "mom_growth"]].to_dict(orient="records"),
        "updated_from": meta["min_month"] if meta else None,
        "updated_to": meta["max_month"] if meta else None,
        "imported_at": meta["imported_at"] if meta else None,
    }


@app.post("/api/slack/send-summary")
def slack_send_summary(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    channel: str = Query(default="Amazon"),
) -> dict:
    ch = normalize_channel(channel)
    start, end = clamp_dates(start_date, end_date, ch)
    summary = sales_summary(start_date=str(start), end_date=str(end), compare_mode="mom", channel=ch)
    webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        return {"ok": False, "error": "SLACK_WEBHOOK_URL not set"}
    linear = (summary.get("mtd") or {}).get("linear") or {}
    dynamic = (summary.get("mtd") or {}).get("dynamic") or {}
    linear_pace = linear.get("pace_to_goal")
    dynamic_pace = dynamic.get("pace_to_goal")
    linear_text = (
        f"Proj ${float(linear.get('projected_total') or 0):,.2f} | Goal ${float(linear.get('goal') or 0):,.2f} | To Goal {linear_pace:.1%}"
        if isinstance(linear_pace, (int, float))
        else "n/a"
    )
    dynamic_text = (
        f"Proj ${float(dynamic.get('projected_total') or 0):,.2f} | Goal ${float(dynamic.get('goal') or 0):,.2f} | To Goal {dynamic_pace:.1%}"
        if isinstance(dynamic_pace, (int, float))
        else "n/a"
    )
    cmp_start = (summary.get("compare_period") or {}).get("start_date")
    cmp_end = (summary.get("compare_period") or {}).get("end_date")
    compare_label = f"{cmp_start} to {cmp_end}" if cmp_start and cmp_end else "n/a"

    # Simple narrative insight using current period mix + MoM deltas.
    deltas = summary.get("deltas") or {}
    best_line = max(
        [("IQBAR", deltas.get("iqbar")), ("IQMIX", deltas.get("iqmix")), ("IQJOE", deltas.get("iqjoe"))],
        key=lambda x: (x[1] if isinstance(x[1], (int, float)) else float("-inf")),
    )
    worst_line = min(
        [("IQBAR", deltas.get("iqbar")), ("IQMIX", deltas.get("iqmix")), ("IQJOE", deltas.get("iqjoe"))],
        key=lambda x: (x[1] if isinstance(x[1], (int, float)) else float("inf")),
    )
    ai_line = (
        f"MoM leader: {best_line[0]} ({fmt_pct(best_line[1])}); laggard: {worst_line[0]} ({fmt_pct(worst_line[1])}). "
        f"Linear pace is {linear_pace:.1%} to goal."
        if isinstance(linear_pace, (int, float))
        else f"MoM leader: {best_line[0]} ({fmt_pct(best_line[1])}); laggard: {worst_line[0]} ({fmt_pct(worst_line[1])})."
    )
    payload = {
        "text": f"IQBAR {ch} Sales Summary",
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": f"IQBAR {ch} Sales Summary"}},
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Period*\n{summary['period']['start_date']} to {summary['period']['end_date']}"},
                    {"type": "mrkdwn", "text": f"*Compare*\n{compare_label}"},
                    {"type": "mrkdwn", "text": f"*Grand Total*\n${summary['current']['grand_total']:,.2f} ({fmt_pct(summary['deltas']['grand_total'])})"},
                    {"type": "mrkdwn", "text": f"*IQBAR*\n${summary['current']['iqbar']:,.2f} ({fmt_pct(summary['deltas']['iqbar'])})"},
                    {"type": "mrkdwn", "text": f"*IQMIX*\n${summary['current']['iqmix']:,.2f} ({fmt_pct(summary['deltas']['iqmix'])})"},
                    {"type": "mrkdwn", "text": f"*IQJOE*\n${summary['current']['iqjoe']:,.2f} ({fmt_pct(summary['deltas']['iqjoe'])})"},
                ],
            },
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*MTD Linear Pace:*\n{linear_text}"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*MTD Dynamic Pace:*\n{dynamic_text}"}},
            {"type": "context", "elements": [{"type": "mrkdwn", "text": "Automated sales snapshot from the dashboard."}]},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*AI Insight:*\n{ai_line}"}},
        ],
    }
    resp = requests.post(webhook, json=payload, timeout=20)
    if resp.status_code >= 300:
        return {"ok": False, "error": f"Slack response {resp.status_code}: {resp.text}"}
    return {"ok": True}


def fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return "n/a"
    return f"{v:+.1%}"


@app.get("/api/export/sales-pdf")
def export_sales_pdf(start_date: Optional[str] = Query(default=None), end_date: Optional[str] = Query(default=None)):
    if build_sales_pdf_report is None:
        return {"ok": False, "error": "PDF builder unavailable in API runtime"}
    start, end = clamp_dates(start_date, end_date)
    s = sales_summary(start_date=str(start), end_date=str(end), compare_mode="previous_period")
    filtered_daily = pd.DataFrame(sales_daily(start_date=str(start), end_date=str(end))["rows"])
    if filtered_daily.empty:
        filtered_daily = pd.DataFrame(columns=["date", "iqbar", "iqmix", "iqjoe", "total", "GrandTotal"])
    filtered_daily["date"] = pd.to_datetime(filtered_daily.get("date"), errors="coerce")
    filtered_daily["iqbar"] = pd.to_numeric(filtered_daily.get("iqbar", 0), errors="coerce").fillna(0.0)
    filtered_daily["iqmix"] = pd.to_numeric(filtered_daily.get("iqmix", 0), errors="coerce").fillna(0.0)
    filtered_daily["iqjoe"] = pd.to_numeric(filtered_daily.get("iqjoe", 0), errors="coerce").fillna(0.0)
    filtered_daily["GrandTotal"] = pd.to_numeric(filtered_daily.get("total", 0), errors="coerce").fillna(0.0)

    insight_bullets = []
    days = int(len(filtered_daily))
    avg_daily = float(filtered_daily["GrandTotal"].mean()) if days else 0.0
    if days:
        best_idx = filtered_daily["GrandTotal"].idxmax()
        worst_idx = filtered_daily["GrandTotal"].idxmin()
        best_day = pd.to_datetime(filtered_daily.loc[best_idx, "date"], errors="coerce")
        worst_day = pd.to_datetime(filtered_daily.loc[worst_idx, "date"], errors="coerce")
        best_day_label = best_day.strftime("%b %d") if pd.notnull(best_day) else "n/a"
        worst_day_label = worst_day.strftime("%b %d") if pd.notnull(worst_day) else "n/a"
        best_sales = float(filtered_daily.loc[best_idx, "GrandTotal"])
        worst_sales = float(filtered_daily.loc[worst_idx, "GrandTotal"])
        insight_bullets.append(
            f"Average daily sales were ${avg_daily:,.0f}; peak day was {best_day_label} at ${best_sales:,.0f}, with trough at ${worst_sales:,.0f} on {worst_day_label}."
        )
        if days >= 14:
            trailing_7 = float(filtered_daily.sort_values("date")["GrandTotal"].tail(7).mean())
            prior_7 = float(filtered_daily.sort_values("date")["GrandTotal"].tail(14).head(7).mean())
            if prior_7 > 0:
                week_delta = (trailing_7 - prior_7) / prior_7
                insight_bullets.append(
                    f"Recent momentum: trailing 7-day average is ${trailing_7:,.0f} vs prior 7-day ${prior_7:,.0f} ({week_delta:+.1%})."
                )
    mix_total = float(s["current"]["iqbar"] + s["current"]["iqmix"] + s["current"]["iqjoe"])
    if mix_total > 0:
        shares = [
            ("IQBAR", float(s["current"]["iqbar"]) / mix_total),
            ("IQMIX", float(s["current"]["iqmix"]) / mix_total),
            ("IQJOE", float(s["current"]["iqjoe"]) / mix_total),
        ]
        top_share = max(shares, key=lambda x: x[1])
        insight_bullets.append(
            f"{top_share[0]} leads the period mix at {top_share[1] * 100:.1f}% of sales; total sales delta vs compare period is {fmt_pct(s['deltas']['grand_total'])}."
        )
    insight_bullets = insight_bullets[:3]
    pdf_bytes = build_sales_pdf_report(
        start_date=start,
        end_date=end,
        compare_text=f"Compare: {s['compare_period']['start_date']} to {s['compare_period']['end_date']}",
        logo_path=get_logo_path() if get_logo_path else None,
        current_total=float(s["current"]["grand_total"]),
        current_iqbar=float(s["current"]["iqbar"]),
        current_iqmix=float(s["current"]["iqmix"]),
        current_iqjoe=float(s["current"]["iqjoe"]),
        total_delta=s["deltas"]["grand_total"],
        iqbar_delta=s["deltas"]["iqbar"],
        iqmix_delta=s["deltas"]["iqmix"],
        iqjoe_delta=s["deltas"]["iqjoe"],
        filtered_daily=filtered_daily[["date", "iqbar", "iqmix", "iqjoe", "GrandTotal"]],
        insight_bullets=insight_bullets,
    )
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=iqbar_sales_report_{start}_to_{end}.pdf"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=True)
