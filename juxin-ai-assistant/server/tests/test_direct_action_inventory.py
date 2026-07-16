import re
from pathlib import Path

from app.direct_action_inventory import DIRECT_ACTION_CONTRACTS


SERVER_ROOT = Path(__file__).resolve().parents[1]


def test_direct_action_inventory_matches_guarded_route_actions() -> None:
    declared_by_file: dict[str, set[str]] = {}
    for contract in DIRECT_ACTION_CONTRACTS:
        declared_by_file.setdefault(contract.source_file, set()).add(contract.action_name)

    for source_file, expected_actions in declared_by_file.items():
        source = (SERVER_ROOT / source_file).read_text(encoding="utf-8")
        actual_actions = set(re.findall(r'action_name="([a-z0-9_]+)"', source))

        assert "DirectActionService" in source
        assert actual_actions == expected_actions
