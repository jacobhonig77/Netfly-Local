#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path
from typing import Iterable

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SQLITE = ROOT / "data" / "sales_dashboard.db"
SCHEMA_SQL = Path(__file__).resolve().parents[1] / "sql" / "postgres_schema.sql"

TABLES_IN_ORDER = [
    "transactions",
    "sku_mapping",
    "imports",
    "monthly_goals",
    "asin_cogs",
    "state_updates",
    "_state_updates_small",
    "_location_backfill_updates_small",
    "_location_backfill_updates_hist",
    "slack_daily_alerts",
    "inventory_snapshots",
    "inventory_items",
    "app_settings",
    "ntb_imports",
    "ntb_monthly",
    "shopify_imports",
    "shopify_line_daily",
]


def sqlite_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def pg_conn(database_url: str):
    return psycopg.connect(database_url)


def apply_schema(pg, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    with pg.cursor() as cur:
        cur.execute(sql)
    pg.commit()


def fetch_sqlite_table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(r[1]) for r in rows]


def chunked(rows: Iterable[tuple], size: int = 2000):
    batch = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def copy_table(sqlite: sqlite3.Connection, pg, table: str) -> int:
    cols = fetch_sqlite_table_columns(sqlite, table)
    if not cols:
        print(f"- skip {table}: table missing in sqlite")
        return 0

    col_csv = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    insert_sql = f"INSERT INTO {table} ({col_csv}) VALUES ({placeholders})"

    src_cur = sqlite.execute(f"SELECT {col_csv} FROM {table}")
    total = 0
    with pg.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE")
        for batch in chunked((tuple(row[c] for c in cols) for row in src_cur), size=2000):
            cur.executemany(insert_sql, batch)
            total += len(batch)
    pg.commit()
    return total


def reset_sequences(pg) -> None:
    sql = """
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_name = 'id'
      LOOP
        EXECUTE format(
          'SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE((SELECT MAX(id) FROM %I), 1), true)',
          r.table_name,
          r.column_name,
          r.table_name
        );
      END LOOP;
    END $$;
    """
    with pg.cursor() as cur:
        cur.execute(sql)
    pg.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="One-time migration: SQLite -> Postgres")
    parser.add_argument("--sqlite", default=str(DEFAULT_SQLITE), help="Path to sqlite db")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""), help="Postgres DATABASE_URL")
    parser.add_argument("--schema", default=str(SCHEMA_SQL), help="Path to postgres schema sql")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    schema_path = Path(args.schema)
    database_url = (args.database_url or "").strip()

    if not sqlite_path.exists():
        raise SystemExit(f"SQLite db not found: {sqlite_path}")
    if not schema_path.exists():
        raise SystemExit(f"Schema file not found: {schema_path}")
    if not database_url:
        raise SystemExit("DATABASE_URL missing. Pass --database-url or set env var.")

    print(f"Using sqlite: {sqlite_path}")
    print(f"Using schema: {schema_path}")

    sq = sqlite_conn(sqlite_path)
    pg = pg_conn(database_url)

    try:
        print("Applying Postgres schema...")
        apply_schema(pg, schema_path)

        print("Copying tables...")
        for table in TABLES_IN_ORDER:
            n = copy_table(sq, pg, table)
            print(f"- {table}: {n} rows")

        print("Resetting id sequences...")
        reset_sequences(pg)
        print("Migration complete.")
    finally:
        sq.close()
        pg.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
