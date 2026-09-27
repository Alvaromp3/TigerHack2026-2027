"""Indexes for the reads that grow with time.

flow_events gains a row for every move the simulator makes, forever. Insights, the ambulance
summary and the assistant filter it by time and kind; without these indexes each of those reads
scans the whole table. IF NOT EXISTS makes this safe to run on every start.
"""

import logging

from sqlalchemy import text

from app.db import engine

log = logging.getLogger(__name__)

STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS ix_flow_events_created_at ON flow_events (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_flow_events_kind_created_at ON flow_events (kind, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_ambulance_runs_eta_at ON ambulance_runs (eta_at)",
)


def ensure_indexes() -> None:
    for statement in STATEMENTS:
        try:
            with engine.begin() as conn:
                conn.execute(text(statement))
        except Exception:
            # A missing index only costs speed; never block startup for it.
            log.warning("index not created: %s", statement, exc_info=True)
