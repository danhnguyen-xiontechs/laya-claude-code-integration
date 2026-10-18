"""Cancelling appointments."""

from datetime import timedelta

FREE_NOTICE = timedelta(hours=24)
LATE_FEE = 2500


def notice_hours(appt, now):
    return (appt.start - now) / timedelta(hours=1)


def fee_for_notice(hours):
    return 0 if hours > FREE_NOTICE / timedelta(hours=1) else LATE_FEE


def cancel(service, appt, by="patient"):
    """Cancel a booked appointment; returns the fee charged in cents."""
    now = service.clock.now()
    if appt.status != "booked":
        raise ValueError(f"appointment is {appt.status}")
    if appt.start <= now:
        raise ValueError("appointment has already started")
    appt.fee = fee_for_notice(notice_hours(appt, now)) if by == "patient" else 0
    appt.status = "cancelled"
    service.notifier.drop(appt.id)
    if service.waitlist is not None:
        service.waitlist.offer_freed(appt.provider_id, appt.start, service.notifier.outbox)
    return appt.fee
