"""One-off check of Command actions against the live census. Rolls data back."""

from sqlalchemy import select, text

from app.db import SessionLocal, engine, init_db
from app.models import HospitalState, Housekeeper, Room
from app.ops_snapshot import build_ops
from app.sim import (
    assign_housekeeper,
    call_physicians,
    complete_clean,
    declare_incoming,
    divert_overflow,
    reset_demo,
    tick_seconds,
)


def main():
    init_db()
    with engine.connect() as conn:
        cols = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'hospital_state' ORDER BY ordinal_position"
                )
            )
        ]
    needed = {"incoming_notice", "called_physicians", "diverted_count", "demo_room_id"}
    missing = needed - set(cols)
    print("columns", ",".join(cols))
    print("missing", ",".join(sorted(missing)) or "none")

    db = SessionLocal()
    real_commit = db.commit

    def dry_commit():
        db.flush()

    db.commit = dry_commit
    try:
        state = db.get(HospitalState, 1)
        if state is None:
            raise SystemExit("hospital_state row 1 is missing")
        before = (bool(state.surge), state.incoming_notice, state.tick_count)
        print("before", before)

        room_id = reset_demo(db)
        room = db.get(Room, room_id)
        free = [
            keeper.name
            for keeper in db.scalars(select(Housekeeper)).all()
            if keeper.room_id is None
        ]
        state = db.get(HospitalState, 1)
        print(
            "reset",
            room_id,
            room.status,
            room.hold_for,
            "surge",
            state.surge,
            "notice",
            state.incoming_notice,
            "free",
            len(free),
        )
        ops = build_ops(db)
        cleans = [item for item in ops["items"] if item["room_id"] == room_id and item["kind"] == "clean"]
        print("queue", bool(cleans), cleans[0]["reason"] if cleans else "missing")
        print("usable_before", ops["counts"]["usable"])

        if not free:
            raise SystemExit("reset left no free housekeeper")
        keeper = next(keeper for keeper in db.scalars(select(Housekeeper)).all() if keeper.room_id is None)
        err = assign_housekeeper(db, room_id, keeper.id)
        print("assign", err or keeper.name)

        _reason, opened = complete_clean(db, room_id)
        room = db.get(Room, room_id)
        ops = build_ops(db)
        print("complete", opened, room.status, "usable_after", ops["counts"]["usable"])

        admitted = declare_incoming(db, "Plane crash on the runway. About 40 critical.")
        state = db.get(HospitalState, 1)
        print("incoming", admitted, state.surge, state.incoming_notice, "tick", tick_seconds(db))
        called = call_physicians(db)
        diverted = divert_overflow(db)
        state = db.get(HospitalState, 1)
        ops = build_ops(db)
        print("called", called, "diverted", diverted, "stored", state.called_physicians, state.diverted_count)
        print("ops_notice", ops["incoming_notice"])
        print("ops_called", ops["called_physicians"], "ops_diverted", ops["diverted_count"])
    finally:
        db.rollback()
        db.close()
    print("rolled_back")

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT surge, incoming_notice FROM hospital_state WHERE id = 1")
        ).one()
    print("live_after", bool(row[0]), row[1])


if __name__ == "__main__":
    main()
