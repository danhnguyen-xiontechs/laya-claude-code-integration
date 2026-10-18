"""Roles and what each role may do."""

PERMISSIONS = {
    "admin": {"unlock", "delete_user", "assign_role", "view_audit"},
    "support": {"view_audit"},
    "member": set(),
}


class PermissionDenied(Exception):
    pass


def can(user, action):
    return action in PERMISSIONS.get(user.role, set())


def require(user, action):
    if not can(user, action):
        raise PermissionDenied(f"{user.role} may not {action}")


def assign_role(actor, user, role, audit=None):
    require(actor, "assign_role")
    if role not in PERMISSIONS:
        raise ValueError(f"unknown role: {role!r}")
    user.role = role
    if audit is not None:
        audit.record("role_change", user.id, role=role, by=actor.id)


def delete_user(actor, store, user):
    require(actor, "delete_user")
    store.remove(user.id)
