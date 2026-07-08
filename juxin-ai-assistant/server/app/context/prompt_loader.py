from functools import lru_cache
from pathlib import Path


class PromptLoader:
    def __init__(self, server_root: Path | None = None) -> None:
        self.server_root = server_root or Path(__file__).resolve().parents[2]

    def _read(self, path: Path) -> str:
        return path.read_text(encoding="utf-8").strip()

    @lru_cache(maxsize=1)
    def base_system_prompt(self) -> str:
        return self._read(self.server_root / "prompts" / "base_system_prompt.md")

    @lru_cache(maxsize=1)
    def company_profile(self) -> str:
        return self._read(self.server_root / "company_profile" / "juxin_profile.md")

    @lru_cache(maxsize=32)
    def role_prompt(self, mode: str) -> str:
        role_file = self.server_root / "prompts" / "roles" / f"{mode}.md"
        if not role_file.exists():
            role_file = self.server_root / "prompts" / "roles" / "normal.md"
        return self._read(role_file)

