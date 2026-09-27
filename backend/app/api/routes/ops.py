from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.ops_snapshot import build_ops

router = APIRouter()


@router.get("/ops")
def operations(db: Session = Depends(get_db)):
    return build_ops(db)
