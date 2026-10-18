"""Booking confirmations and calendar export."""

from dataclasses import dataclass


@dataclass
class Clinic:
    name: str
    address: str
    phone: str


def confirmation_text(appt, provider, clinic, patient):
    when = appt.start.strftime("%A %d %B %Y, %H:%M")
    return (
        f"Booking confirmed\n"
        f"Dear {patient.name},\n"
        f"your appointment with {provider.name} is on {when}.\n"
        f"{clinic.name}, {clinic.address}\n"
        f"Questions? Call {clinic.phone}.\n"
    )


def confirmation_message(appt, provider, clinic, patient):
    return {
        "to": patient.email,
        "subject": "Booking confirmed",
        "reference": f"BK-{appt.id:05d}",
        "body": confirmation_text(appt, provider, clinic, patient),
    }


def to_ics(appt):
    fmt = "%Y%m%dT%H%M%S"
    return "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        f"UID:appt-{appt.id}@clinic.example",
        f"DTSTART:{appt.start.strftime(fmt)}",
        f"DTEND:{appt.end.strftime(fmt)}",
        "SUMMARY:Appointment",
        "END:VEVENT",
        "END:VCALENDAR",
    ]) + "\r\n"
