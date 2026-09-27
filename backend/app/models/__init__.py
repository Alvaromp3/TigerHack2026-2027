from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    floor_id: Mapped[str] = mapped_column(String(8), index=True)
    kind: Mapped[str] = mapped_column(String(8))
    dept: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    surge: Mapped[bool] = mapped_column(Boolean, default=False)
    clean_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    clean_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ticks_left: Mapped[int | None] = mapped_column(Integer, nullable=True)
    queued_tick: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linen_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    linen_ticks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hold_for: Mapped[str | None] = mapped_column(String(80), nullable=True)

    patient: Mapped["Patient | None"] = relationship(back_populates="room", uselist=False)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    acuity: Mapped[str] = mapped_column(String(16))
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), unique=True)
    needs_or: Mapped[bool] = mapped_column(Boolean, default=False)
    physician: Mapped[str] = mapped_column(String(80))
    nurse: Mapped[str] = mapped_column(String(80))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chief_complaint: Mapped[str | None] = mapped_column(String(160), nullable=True)
    diagnosis: Mapped[str | None] = mapped_column(String(160), nullable=True)
    stay_ticks: Mapped[int] = mapped_column(Integer, default=0)
    heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    systolic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2: Mapped[int | None] = mapped_column(Integer, nullable=True)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    temperature: Mapped[int | None] = mapped_column(Integer, nullable=True)

    room: Mapped[Room] = relationship(back_populates="patient")


class FlowEvent(Base):
    __tablename__ = "flow_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_name: Mapped[str] = mapped_column(String(80))
    message: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="move", server_default="move")
    room_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Transfer(Base):
    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_name: Mapped[str] = mapped_column(String(80))
    destination: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Death(Base):
    __tablename__ = "deaths"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_name: Mapped[str] = mapped_column(String(80))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diagnosis: Mapped[str | None] = mapped_column(String(160), nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Housekeeper(Base):
    __tablename__ = "housekeepers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    room_id: Mapped[str | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)


class LinenAide(Base):
    __tablename__ = "linen_aides"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    room_id: Mapped[str | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(16))
    unit: Mapped[str] = mapped_column(String(16))
    specialty: Mapped[str] = mapped_column(String(80))
    shift: Mapped[str] = mapped_column(String(16))
    on_duty: Mapped[bool] = mapped_column(Boolean, default=True)
    extension: Mapped[str] = mapped_column(String(8))


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="open")
    baseline_status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HospitalState(Base):
    __tablename__ = "hospital_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    surge: Mapped[bool] = mapped_column(Boolean, default=False)
    admit_index: Mapped[int] = mapped_column(default=0)
    tick_count: Mapped[int] = mapped_column(default=0)
    incoming_notice: Mapped[str | None] = mapped_column(String(240), nullable=True)
    called_physicians: Mapped[int] = mapped_column(Integer, default=0)
    diverted_count: Mapped[int] = mapped_column(Integer, default=0)
    demo_room_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
