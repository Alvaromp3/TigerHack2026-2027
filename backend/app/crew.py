"""Enough cleaning staff that every room being turned over has someone on it.

The first seed made three housekeepers and two linen aides, while eight to ten rooms can be in
turnover at once, so most sat "waiting for a housekeeper". This tops both crews up by name on
every start: nothing is duplicated, and people already assigned keep their rooms.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Housekeeper, LinenAide

HOUSEKEEPERS = (
    "Ana Ruiz", "Ben Cole", "Chris Adey", "Maya Chen", "Luis Ortega", "Grace Mensah",
    "Omar Haddad", "Sofia Rossi", "Tom Becker", "Nia Johnson", "Raj Patel", "Elena Novak",
)
LINEN_AIDES = ("Dana Ibarra", "Eli March", "Farah Aziz", "Jon Price", "Lena Park", "Marco Silva")


def ensure_cleaning_crew(db: Session) -> int:
    added = 0
    for model, names in ((Housekeeper, HOUSEKEEPERS), (LinenAide, LINEN_AIDES)):
        present = set(db.scalars(select(model.name)).all())
        for name in names:
            if name not in present:
                db.add(model(name=name, room_id=None))
                added += 1
    db.commit()
    return added
