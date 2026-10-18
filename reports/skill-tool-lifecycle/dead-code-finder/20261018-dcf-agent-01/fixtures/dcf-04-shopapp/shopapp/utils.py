import datetime

DATE_FMT = "%Y-%m-%d"
OLD_DATE_FMT = "%d/%m/%Y"


def today():
    return datetime.date.today().strftime(DATE_FMT)


def slug(text):
    return text.lower().replace(" ", "-")
