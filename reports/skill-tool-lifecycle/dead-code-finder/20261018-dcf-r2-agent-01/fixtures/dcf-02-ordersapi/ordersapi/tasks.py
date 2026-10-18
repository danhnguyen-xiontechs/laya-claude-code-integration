TASKS = {}


def task(fn):
    TASKS[fn.__name__] = fn
    return fn


@task
def nightly_cleanup():
    return "cleaned"


@task
def rebuild_index():
    return "indexed"


def send_digest(users):
    return [f"digest for {u}" for u in users]
