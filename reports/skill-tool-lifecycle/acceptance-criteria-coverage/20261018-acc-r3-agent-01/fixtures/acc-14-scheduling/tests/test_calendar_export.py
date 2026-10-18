"""Calendar export (iCalendar).

Patients can add an appointment to their own calendar; to_ics() writes one
VEVENT with CRLF line endings.
"""

from clinic.confirmation import to_ics
from tests.helpers import TUE, at
from tests.snap import match_snapshot


class TestIcsExport:
    def test_wrapped_in_calendar(self, service):
        appt = service.book("pat-1", "p1", at(TUE, "09:20"))

        lines = to_ics(appt).splitlines()

        assert lines[0] == "BEGIN:VCALENDAR"
        assert lines[-1] == "END:VCALENDAR"
        assert "BEGIN:VEVENT" in lines
        assert "SUMMARY:Appointment" in lines

    def test_start_and_end(self, service):
        appt = service.book("pat-1", "p1", at(TUE, "09:20"))

        ics = to_ics(appt)

        assert "DTSTART:20260303T092000" in ics
        assert "DTEND:20260303T094000" in ics

        later = service.book("pat-2", "p2", at(TUE, "16:40"))

        assert "DTEND:20260303T170000" in to_ics(later)

    def test_uid_names_appointment(self, service):
        service.book("pat-2", "p1", at(TUE, "09:00"))
        appt = service.book("pat-1", "p1", at(TUE, "09:20"))

        assert "UID:appt-2@clinic.example" in to_ics(appt)

    def test_lines_end_with_crlf(self, service):
        appt = service.book("pat-1", "p1", at(TUE, "09:20"))

        ics = to_ics(appt)

        assert ics.endswith("\r\n")
        assert "\n" not in ics.replace("\r\n", "")

    def test_ics_snapshot(self, service):
        appt = service.book("pat-1", "p1", at(TUE, "09:20"))

        match_snapshot("appointment_ics", to_ics(appt))
