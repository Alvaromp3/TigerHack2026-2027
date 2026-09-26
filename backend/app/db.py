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
        conn.execute(text("ALTER TABLE flow_events ADD COLUMN IF NOT EXISTS kind VARCHAR(16) DEFAULT 'move'"))
    with SessionLocal() as db:
        seed_if_empty(db)
        pending = db.scalars(select_missing_cases()).all()
        for patient in pending:
            case = random_case()
            patient.age = case["age"]
            patient.chief_complaint = case["chief_complaint"]
            patient.diagnosis = case["diagnosis"]
        db.commit()


def select_missing_cases():
    from sqlalchemy import select

    from app.models import Patient

    return select(Patient).where(Patient.chief_complaint.is_(None))
