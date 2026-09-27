import logging
import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

log = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=280,
    pool_timeout=10,
    connect_args={
        # Fail a blocked query instead of pinning a pooled connection for 30s.
        "options": (
            "-c lock_timeout=4000 "
            "-c statement_timeout=20000 "
            "-c idle_in_transaction_session_timeout=20000"
        ),
    },
)
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
    except Exception:
        if db.in_transaction():
            db.rollback()
        raise
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


def _lock_conflict(exc: BaseException) -> bool:
    orig = getattr(exc, "orig", None)
    state = getattr(orig, "sqlstate", None)
    # 55P03 lock_not_available, 40P01 deadlock_detected
    if state in {"55P03", "40P01"}:
        return True
    name = type(orig).__name__ if orig is not None else ""
    return name in {"LockNotAvailable", "DeadlockDetected"}


def _schema_current(conn) -> bool:
    return all(_column_exists(conn, table, column) for table, column, _ddl in _COLUMN_PATCHES)


def _ensure_columns():
    """Patch columns left behind by older deploys.

    A normal restart, when every column already exists, takes no lock. The
    instance still serving holds table locks while it ticks; waiting on those
    used to deadlock or time out and kill startup before the port opened.
    """
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        if _schema_current(conn):
            return
        locked = False
        for _ in range(12):
            locked = bool(conn.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": _MIGRATION_LOCK}))
            if locked:
                break
            time.sleep(0.5)
        if not locked:
            log.warning("schema patch skipped; another process is migrating")
            return
        try:
            if _schema_current(conn):
                return
            conn.execute(text("SET lock_timeout = '2s'"))
            for table, column, ddl in _COLUMN_PATCHES:
                _add_column(conn, table, column, ddl)
            for sql in _BACKFILLS:
                _retry(conn, text(sql))
        except OperationalError as exc:
            if not _lock_conflict(exc):
                raise
            log.warning("schema patch hit a lock held by the instance still serving")
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK})


def init_db():
    try:
        _open_database()
    except OperationalError as exc:
        if not _lock_conflict(exc):
            raise
        log.warning("database startup hit a lock held by the instance still serving; continuing")


def _open_database():
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

        try:
            repair_census(db)
        except OperationalError as exc:
            db.rollback()
            if not _lock_conflict(exc):
                raise
            log.warning("census repair skipped; another process holds the census lock")


def seed_staff_if_empty(db):
    from sqlalchemy import select

    from app.models import Staff

    roster = [
        ("Dr. Leena Patel", "physician", "icu", "Critical care", "day", True, "4101"),
        ("Dr. Omar Desta", "physician", "icu", "Critical care", "day", True, "4104"),
        ("RN Maya Chen", "nurse", "icu", "ICU", "day", True, "4102"),
        ("RN Chris Novak", "nurse", "icu", "ICU", "day", True, "4103"),
        ("RN Imani Diaz", "nurse", "icu", "ICU", "day", True, "4105"),
        ("RN Adeyemi Cole", "charge", "icu", "Charge nurse", "day", True, "4100"),
        ("Dr. Jonah Okonkwo", "physician", "ed", "Emergency medicine", "day", True, "1101"),
        ("Dr. Amina Diallo", "physician", "ed", "Emergency medicine", "day", True, "1111"),
        ("Dr. Keisha Ward", "physician", "ed", "Emergency medicine", "day", True, "1112"),
        ("Dr. Luis Ortega", "physician", "ed", "Emergency medicine", "day", True, "1113"),
        ("Dr. Hannah Berg", "physician", "ed", "Emergency medicine", "day", True, "1114"),
        ("Dr. Samuel Cho", "physician", "ed", "Emergency medicine", "day", True, "1115"),
        ("Dr. Fatima Okeke", "physician", "ed", "Emergency medicine", "day", True, "1116"),
        ("RN Elena Brooks", "nurse", "ed", "Emergency", "day", True, "1102"),
        ("RN Jonah Blake", "nurse", "ed", "Trauma", "day", True, "1103"),
        ("RN Sofia Lang", "nurse", "ed", "Emergency", "day", True, "1104"),
        ("RN Owen Clarke", "nurse", "ed", "Emergency", "day", True, "1105"),
        ("RN Ruth Ferreira", "nurse", "ed", "Emergency", "day", True, "1106"),
        ("RN Malik Santos", "nurse", "ed", "Emergency", "day", True, "1107"),
        ("RN Chloe Reddy", "nurse", "ed", "Emergency", "day", True, "1109"),
        ("RN Yara Nguyen", "nurse", "ed", "Emergency", "day", True, "1117"),
        ("RN Weiss Adler", "charge", "ed", "Charge nurse", "day", True, "1100"),
        ("Dr. Amir Shah", "physician", "med", "Hospital medicine", "day", True, "2101"),
        ("Dr. Elena Voss", "physician", "med", "Hospital medicine", "day", True, "2104"),
        ("Dr. Andre Nair", "physician", "med", "Hospital medicine", "day", True, "2105"),
        ("Dr. Mei Ortiz", "physician", "med", "Hospital medicine", "day", True, "2106"),
        ("Dr. Daniel Ibrahim", "physician", "med", "Hospital medicine", "day", True, "2110"),
        ("RN Luis Ibarra", "nurse", "med", "Med/Surg", "day", True, "2102"),
        ("RN Priya Raman", "nurse", "med", "Med/Surg", "day", True, "2103"),
        ("RN Felix Haddad", "nurse", "med", "Med/Surg", "day", True, "2107"),
        ("RN Ines Keller", "nurse", "med", "Med/Surg", "day", True, "2108"),
        ("RN Ravi Petrov", "nurse", "med", "Med/Surg", "day", True, "2109"),
        ("RN Amara Cohen", "nurse", "med", "Med/Surg", "day", True, "2111"),
        ("Dr. Camila Alvarez", "physician", "surg", "General surgery", "day", True, "3101"),
        ("Dr. Paul Kim", "physician", "surg", "General surgery", "day", True, "3102"),
        ("Dr. Nora Abebe", "physician", "surg", "General surgery", "day", True, "3103"),
        ("Dr. Victor Santos", "physician", "surg", "General surgery", "day", True, "3105"),
        ("RN Grace Walsh", "nurse", "surg", "Surgical", "day", True, "3106"),
        ("RN Diego Tanaka", "nurse", "surg", "Surgical", "day", True, "3107"),
        ("RN Leah Moreau", "nurse", "surg", "Surgical", "day", True, "3108"),
        ("RN Hassan Cole", "nurse", "surg", "Surgical", "day", True, "3109"),
        ("Dr. Helen Cho", "physician", "surg", "Orthopedics", "night", False, "3104"),
        ("RN Nora Kim", "nurse", "icu", "ICU", "night", False, "4108"),
        ("RN Mateo Ruiz", "nurse", "ed", "Emergency", "night", False, "1108"),
    ]
    known = set(db.scalars(select(Staff.name)).all())
    for name, role, unit, specialty, shift, on_duty, extension in roster:
        if name in known:
            continue
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
