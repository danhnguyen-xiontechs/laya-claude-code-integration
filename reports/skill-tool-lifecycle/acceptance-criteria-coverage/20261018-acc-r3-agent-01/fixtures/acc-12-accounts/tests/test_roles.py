"""Roles and permissions.

Every user has a role: member, support or admin. PERMISSIONS lists the
actions each role may take; require() raises PermissionDenied otherwise.
"""

import pytest

from accounts.roles import PERMISSIONS, PermissionDenied, assign_role, can, delete_user


def test_non_admin_cannot_delete_user(store, ann, bob):
    with pytest.raises(PermissionDenied):
        delete_user(bob, store, ann)

    assert store.get(ann.id) is ann


def test_admin_can_delete_user(store, ann, bob, admin):
    assert len(store.users) == 3

    delete_user(admin, store, ann)

    assert store.get(ann.id) is None
    assert store.by_email("ann@example.com") is None
    assert store.get(bob.id) is bob
    assert len(store.users) == 2


class TestRolePermissions:
    def test_admin_permissions(self, admin, bob):
        for action in ("delete_user", "assign_role", "view_audit"):
            assert can(admin, action)
            assert not can(bob, action)

        assert can(admin, "delete_user")
        assert can(admin, "assign_role")
        assert PERMISSIONS["admin"] >= {"delete_user", "assign_role", "view_audit"}

    def test_support_can_view_audit(self, admin, bob):
        assign_role(admin, bob, "support")

        assert bob.role == "support"
        assert can(bob, "view_audit")
        assert not can(bob, "delete_user")

    def test_member_cannot_assign_role(self, ann, bob):
        with pytest.raises(PermissionDenied):
            assign_role(bob, ann, "admin")

        assert ann.role == "member"

    def test_unknown_role_rejected(self, admin, bob):
        with pytest.raises(ValueError):
            assign_role(admin, bob, "superuser")

        assert bob.role == "member"
