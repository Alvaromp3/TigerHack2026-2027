from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.catalog import random_case
    from app.db_seed import seed_if_empty
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS age INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS chief_complaint VARCHAR(160)"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS diagnosis VARCHAR(160)"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS stay_ticks INTEGER"))
        conn.execute(text("UPDATE patients SET stay_ticks = 3 WHERE stay_ticks IS NULL"))
        conn.execute(text("ALTER TABLE flow_events ADD COLUMN IF NOT EXISTS kind VARCHAR(16) DEFAULT 'move'"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS clean_type VARCHAR(16)"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS clean_priority INTEGER"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ticks_left INTEGER"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS queued_tick INTEGER"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS linen_stage VARCHAR(16)"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS linen_ticks INTEGER"))
        conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hold_for VARCHAR(80)"))
        conn.execute(text("ALTER TABLE hospital_state ADD COLUMN IF NOT EXISTS incoming_notice VARCHAR(240)"))
        conn.execute(text("ALTER TABLE hospital_state ADD COLUMN IF NOT EXISTS called_physicians INTEGER"))
        conn.execute(text("ALTER TABLE hospital_state ADD COLUMN IF NOT EXISTS diverted_count INTEGER"))
        conn.execute(text("ALTER TABLE hospital_state ADD COLUMN IF NOT EXISTS demo_room_id VARCHAR(16)"))
        conn.execute(text("UPDATE hospital_state SET called_physicians = 0 WHERE called_physicians IS NULL"))
        conn.execute(text("UPDATE hospital_state SET diverted_count = 0 WHERE diverted_count IS NULL"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS heart_rate INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS systolic INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS diastolic INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS spo2 INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS respiratory_rate INTEGER"))
        conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS temperature INTEGER"))
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
        from app.sim import ensure_cleaning_queue

        ensure_cleaning_queue(db)
        db.commit()


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
