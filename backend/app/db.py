from sqlalchemy import create_engine
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
    from app.db_seed import seed_if_empty
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_if_empty(db)
        db.commit()
