from .registry import Plugin
from .text import normalize


class Upper(Plugin):
    name = "upper"

    def run(self, data):
        return normalize(data).upper()


class Reverse(Plugin):
    name = "reverse"

    def run(self, data):
        return normalize(data)[::-1]


class Experimental(Plugin):
    def run(self, data):
        return data
