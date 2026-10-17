import hashlib
import os

MAX_BYTES = 5 * 1024 * 1024
ALLOWED = {"image/png", "image/jpeg"}


class Store:
    def __init__(self):
        self.files = {}
        self.owners = {}


def sanitize(name):
    return os.path.basename(name.replace("\\", "/")).lstrip(".") or "file"


def upload(store, owner, name, mime, data, scanner=None):
    if len(data) > MAX_BYTES:
        return 413, {"error": "too large"}
    if mime not in ALLOWED:
        return 415, {"error": "unsupported type"}
    if scanner is not None and not scanner(data):
        return 422, {"error": "infected"}
    digest = hashlib.sha256(data).hexdigest()
    if digest in store.files:
        return 200, {"id": digest, "duplicate": True}
    store.files[digest] = {"name": sanitize(name), "data": data}
    store.owners[digest] = owner
    return 201, {"id": digest, "name": store.files[digest]["name"]}


def delete(store, user, file_id):
    if store.owners.get(file_id) != user:
        return 403, {"error": "not the owner"}
    del store.files[file_id]
    del store.owners[file_id]
    return 204, {}
