"""Static guardrails for the platform-admin route surface.

These checks intentionally inspect the route source rather than exercising every
handler through HTTP.  They make the security review repeatable when a new
admin route is added or a role check is edited.
"""

from __future__ import annotations

import ast
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1] / "app"
ADMIN_ROUTE_ROOT = APP_ROOT / "admin"
ROUTE_DECORATOR_METHODS = {"get", "post", "put", "patch", "delete"}
ADMIN_GUARD_CALLS = {
    "require_action",
    "require_admin",
    "_require_admin",
    "_require_admin_access",
    "change_status",
}


def _route_decorator_method(decorator: ast.expr) -> str | None:
    if not isinstance(decorator, ast.Call):
        return None
    target = decorator.func
    if not isinstance(target, ast.Attribute) or target.attr not in ROUTE_DECORATOR_METHODS:
        return None
    if not isinstance(target.value, ast.Name) or target.value.id != "router":
        return None
    return target.attr


def _call_name(call: ast.Call) -> str | None:
    target = call.func
    if isinstance(target, ast.Name):
        return target.id
    if isinstance(target, ast.Attribute):
        return target.attr
    return None


def test_admin_route_handlers_have_an_explicit_admin_guard() -> None:
    """Every handler registered by ``app/admin`` must enforce admin access."""

    missing: list[str] = []
    for path in sorted(ADMIN_ROUTE_ROOT.glob("*_routes.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            if not any(_route_decorator_method(dec) for dec in node.decorator_list):
                continue
            calls = {
                name
                for call in ast.walk(node)
                if isinstance(call, ast.Call)
                for name in [_call_name(call)]
                if name is not None
            }
            if not calls & ADMIN_GUARD_CALLS:
                missing.append(f"{path.relative_to(APP_ROOT)}:{node.name}")

    assert not missing, "admin route handlers missing admin guard: " + ", ".join(missing)


def test_app_does_not_use_exact_admin_role_comparisons() -> None:
    """Role aliases must flow through ``is_platform_admin_role``."""

    matches: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            if not any(isinstance(op, (ast.Eq, ast.NotEq)) for op in node.ops):
                continue
            if not any(
                isinstance(value, ast.Constant) and value.value == "admin"
                for value in node.comparators
            ):
                continue
            if not any(
                isinstance(value, ast.Name) and value.id == "role"
                or isinstance(value, ast.Attribute) and value.attr == "role"
                for value in ast.walk(node.left)
            ):
                continue
            matches.append(
                f"{path.relative_to(APP_ROOT)}:{node.lineno}: {ast.unparse(node)}"
            )

    assert not matches, "exact admin role comparisons found: " + ", ".join(matches)
