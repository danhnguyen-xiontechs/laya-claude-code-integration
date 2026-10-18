"""Appointment reminders."""

from datetime import timedelta

REMINDER_LEAD = timedelta(hours=24)


def plan_reminder(notifier, appt):
    return notifier.schedule(
        appt.id,
        "reminder",
        appt.start - REMINDER_LEAD,
        appt.patient_id,
        {"start": appt.start.isoformat(timespec="minutes"), "provider": appt.provider_id},
    )


def reminder_text(appt, provider_name):
    when = appt.start.strftime("%A %d %B at %H:%M")
    return f"Reminder: your appointment with {provider_name} is on {when}."
