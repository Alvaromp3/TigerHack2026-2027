import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# One session lock so overlapping deploys don't ALTER the same tables together.
_MIGRATION_LOCK = 742026

# (table, column, type clause). Names are fixed; never passed in from a request.
_COLUMN_PATCHES = (
    ("patients", "age", "INTEGER"),
    ("patients", "chief_complaint", "VARCHAR(160)"),
    ("patients", "diagnosis", "VARCHAR(160)"),
    ("patients", "stay_ticks", "INTEGER"),
    ("patients", "heart_rate", "INTEGER"),
    ("patients", "systolic", "INTEGER"),
    ("patients", "diastolic", "INTEGER"),
    ("patients", "spo2", "INTEGER"),
    ("patients", "respiratory_rate", "INTEGER"),
    ("patients", "temperature", "INTEGER"),
    ("flow_events", "kind", "VARCHAR(16) DEFAULT 'move'"),
    ("rooms", "clean_type", "VARCHAR(16)"),
    ("rooms", "clean_priority", "INTEGER"),
    ("rooms", "ticks_left", "INTEGER"),
    ("rooms", "queued_tick", "INTEGER"),
    ("rooms", "linen_stage", "VARCHAR(16)"),
    ("rooms", "linen_ticks", "INTEGER"),
    ("rooms", "hold_for", "VARCHAR(80)"),
    ("hospital_state", "incoming_notice", "VARCHAR(240)"),
    ("hospital_state", "called_physicians", "INTEGER"),
    ("hospital_state", "diverted_count", "INTEGER"),
    ("hospital_state", "demo_room_id", "VARCHAR(16)"),
)

_BACKFILLS = (
    "UPDATE patients SET stay_ticks = 3 WHERE stay_ticks IS NULL",
    "UPDATE hospital_state SET called_physicians = 0 WHERE called_physicians IS NULL",
    "UPDATE hospital_state SET diverted_count = 0 WHERE diverted_count IS NULL",
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _column_exists(conn, table, column):
    found = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = :table
              AND column_name = :column
            """
        ),
        {"table": table, "column": column},
    ).first()
    return found is not None


def _retry(conn, statement):
    for attempt in range(5):
        try:
            conn.execute(statement)
            return
        except OperationalError:
            if attempt == 4:
                raise
            time.sleep(0.4 * (attempt + 1))


def _add_column(conn, table, column, ddl):
    """Add one column and commit it before touching the next table.

    Postgres takes AccessExclusiveLock for ADD COLUMN even with IF NOT EXISTS.
    Doing every ALTER in one transaction held those locks across tables, which
    deadlocked the still-running instance on deploy.
    """
    if _column_exists(conn, table, column):
        return
    statement = text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {ddl}')
    for attempt in range(5):
        try:
            conn.execute(statement)
            return
        except OperationalError:
            if _column_exists(conn, table, column):
                return
            if attempt == 4:
                raise
            time.sleep(0.4 * (attempt + 1))


def _ensure_columns():
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _MIGRATION_LOCK})
        try:
            conn.execute(text("SET lock_timeout = '2s'"))
            for table, column, ddl in _COLUMN_PATCHES:
                _add_column(conn, table, column, ddl)
            for sql in _BACKFILLS:
                _retry(conn, text(sql))
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK})


def init_db():
    from app.catalog import random_case
    from app.db_seed import seed_if_empty
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    with SessionLocal() as db:
        seed_if_empty(db)
        pending = db.scalars(select_missing_cases()).all()
        for patient in pending:
            case = random_case()
            patient.age = case["age"]
            patient.chief_complaint = case["chief_complaint"]
            patient.diagnosis = case["diagnosis"]
        from app.sim import fill_missing_vitals

        fill_missing_vitals(db)
        seed_staff_if_empty(db)
        seed_housekeepers_if_empty(db)
        seed_linen_aides_if_empty(db)
        db.commit()
        from app.sim import repair_census

        repair_census(db)


def seed_staff_if_empty(db):
    from sqlalchemy import func, select

    from app.models import Staff

    existing = db.scalar(select(func.count()).select_from(Staff))
    if existing:
        return
    roster = [
        ("Dr. Leena Patel", "physician", "icu", "Critical care", "day", True, "4101"),
        ("RN Maya Chen", "nurse", "icu", "ICU", "day", True, "4102"),
        ("RN Chris Novak", "nurse", "icu", "ICU", "day", True, "4103"),
        ("RN Adeyemi Cole", "charge", "icu", "Charge nurse", "day", True, "4100"),
        ("Dr. Jonah Okonkwo", "physician", "ed", "Emergency medicine", "day", True, "1101"),
        ("RN Elena Brooks", "nurse", "ed", "Emergency", "day", True, "1102"),
        ("RN Jonah Blake", "nurse", "ed", "Trauma", "day", True, "1103"),
        ("RN Weiss Adler", "charge", "ed", "Charge nurse", "day", True, "1100"),
        ("Dr. Amir Shah", "physician", "med", "Hospital medicine", "day", True, "2101"),
        ("RN Luis Ibarra", "nurse", "med", "Med/Surg", "day", True, "2102"),
        ("RN Priya Raman", "nurse", "med", "Med/Surg", "day", True, "2103"),
        ("Dr. Camila Alvarez", "physician", "surg", "General surgery", "day", True, "3101"),
        ("Dr. Helen Cho", "physician", "surg", "Orthopedics", "night", False, "3104"),
        ("RN Nora Kim", "nurse", "icu", "ICU", "night", False, "4108"),
        ("RN Mateo Ruiz", "nurse", "ed", "Emergency", "night", False, "1108"),
    ]
    for name, role, unit, specialty, shift, on_duty, extension in roster:
        db.add(Staff(
            name=name,
            role=role,
            unit=unit,
            specialty=specialty,
            shift=shift,
            on_duty=on_duty,
            extension=extension,
        ))


def seed_housekeepers_if_empty(db):
    from sqlalchemy import func, select

    from app.models import Housekeeper

    existing = db.scalar(select(func.count()).select_from(Housekeeper))
    if existing:
        return
    for name in ("Ana Ruiz", "Ben Cole", "Chris Adey"):
        db.add(Housekeeper(name=name, room_id=None))


def seed_linen_aides_if_empty(db):
    from sqlalchemy import func, select

    from app.models import LinenAide

    existing = db.scalar(select(func.count()).select_from(LinenAide))
    if existing:
        return
    for name in ("Dana Ibarra", "Eli March"):
        db.add(LinenAide(name=name, room_id=None))


def select_missing_cases():
    from sqlalchemy import select

    from app.models import Patient

    return select(Patient).where(Patient.chief_complaint.is_(None))
