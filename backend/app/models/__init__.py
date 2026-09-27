from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
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


class WebhookSubscription(Base):
    """An outside system that wants hospital events pushed to it."""

    __tablename__ = "webhook_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(String(120), nullable=True)
    secret: Mapped[str] = mapped_column(String(80))
    # Comma-separated event types; "bed.*" style wildcards allowed; empty means every event.
    event_types: Mapped[str] = mapped_column(String(400), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    cursor_event_id: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(Integer, index=True)
    event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    event_type: Mapped[str] = mapped_column(String(80))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SandboxMessage(Base):
    """What the built-in webhook receiver got, so a demo can show delivery end to end."""

    __tablename__ = "sandbox_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    event_type: Mapped[str] = mapped_column(String(80))
    event_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    signature_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditEntry(Base):
    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40), index=True)
    target: Mapped[str | None] = mapped_column(String(40), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CareActivity(Base):
    """What is being done to a patient right now: the operation in theatre, or the current step of care.

    One row per patient in a bed, kept by app/care.py. A table of its own (no foreign key) so the
    simulator can admit, move and discharge patients without ever waiting on it.
    """

    __tablename__ = "care_activities"

    patient_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(16))  # "surgery" or "care"
    title: Mapped[str] = mapped_column(String(120))
    step: Mapped[int] = mapped_column(Integer, default=0)
    steps: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    minutes: Mapped[int] = mapped_column(Integer)


class AmbulanceRun(Base):
    """One ambulance transport: the pre-alert, the hospital's answer, arrival and handoff."""

    __tablename__ = "ambulance_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), index=True)
    unit: Mapped[str] = mapped_column(String(40))
    agency: Mapped[str] = mapped_column(String(80))
    zone: Mapped[str] = mapped_column(String(24))
    esi: Mapped[int] = mapped_column(Integer)
    complaint: Mapped[str] = mapped_column(String(16))
    summary: Mapped[str] = mapped_column(String(200))
    patient_name: Mapped[str] = mapped_column(String(80))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    systolic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2: Mapped[int | None] = mapped_column(Integer, nullable=True)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    destination: Mapped[str] = mapped_column(String(80), index=True)
    # pending -> accepted -> arrived -> handed_off, or diverted at any point before arrival.
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    bed_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    diverted_to: Mapped[str | None] = mapped_column(String(80), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=True)
    eta_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    handed_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FacilityStatus(Base):
    """The hospital's public ambulance status, published to the regional network."""

    __tablename__ = "facility_status"

    id: Mapped[int] = mapped_column(primary_key=True)
    ems_status: Mapped[str] = mapped_column(String(16), default="accepting")
    reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
