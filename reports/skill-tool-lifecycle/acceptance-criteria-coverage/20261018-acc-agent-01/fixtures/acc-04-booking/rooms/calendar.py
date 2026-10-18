from datetime import timedelta


class Conflict(Exception):
    pass


class Rejected(Exception):
    pass


class Calendar:
    def __init__(self, now):
        self.now = now
        self.items = {}
        self._n = 0

    def book(self, room, start, end):
        if start < self.now:
            raise Rejected("in the past")
        if end - start > timedelta(hours=4):
            raise Rejected("too long")
        for r, s, e in self.items.values():
            if r == room and start < e and s < end:
                raise Conflict(room)
        self._n += 1
        self.items[self._n] = (room, start, end)
        return self._n

    def cancel(self, booking_id):
        room, start, end = self.items[booking_id]
        if start - self.now < timedelta(hours=1):
            raise Rejected("too late to cancel")
        del self.items[booking_id]
