from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from .skill_definition import SkillDefinition, SkillManifest


REQUIRED_SKILL_FILES = (
    "skill.json",
    "SKILL.md",
    "prompts/system.md",
    "prompts/task.md",
    "prompts/output.md",
    "schemas/input.schema.json",
    "schemas/output.schema.json",
    "examples/good.md",
    "examples/bad.md",
    "eval/checklist.md",
)


def default_skill_root() -> Path:
    return Path(__file__).resolve().parents[2] / "agent-harness" / "skills"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


class SkillRegistry:
    def __init__(self, root: Path | str | None = None) -> None:
        self.root = Path(root) if root is not None else default_skill_root()
        self._skills: dict[str, SkillDefinition] | None = None

    @classmethod
    def default(cls) -> "SkillRegistry":
        return get_default_skill_registry()

    def reload(self) -> None:
        self._skills = None

    def _load(self) -> dict[str, SkillDefinition]:
        if self._skills is not None:
            return self._skills
        skills: dict[str, SkillDefinition] = {}
        if not self.root.exists():
            self._skills = {}
            return skills
        for skill_dir in sorted(item for item in self.root.iterdir() if item.is_dir()):
            missing = [name for name in REQUIRED_SKILL_FILES if not (skill_dir / name).exists()]
            if missing:
                raise ValueError(f"skill {skill_dir.name} missing files: {', '.join(missing)}")
            manifest = SkillManifest.model_validate(_read_json(skill_dir / "skill.json"))
            if manifest.id in skills:
                raise ValueError(f"duplicate skill id: {manifest.id}")
            skills[manifest.id] = SkillDefinition(
                manifest=manifest,
                root=skill_dir,
                readme=_read_text(skill_dir / "SKILL.md"),
                system_prompt=_read_text(skill_dir / "prompts" / "system.md"),
                task_prompt=_read_text(skill_dir / "prompts" / "task.md"),
                output_prompt=_read_text(skill_dir / "prompts" / "output.md"),
                input_schema=_read_json(skill_dir / "schemas" / "input.schema.json"),
                output_schema=_read_json(skill_dir / "schemas" / "output.schema.json"),
                good_example=_read_text(skill_dir / "examples" / "good.md"),
                bad_example=_read_text(skill_dir / "examples" / "bad.md"),
                checklist=_read_text(skill_dir / "eval" / "checklist.md"),
            )
        self._skills = skills
        return skills

    def list_skills(self, *, include_unpublished: bool = True) -> list[SkillDefinition]:
        values: Iterable[SkillDefinition] = self._load().values()
        if not include_unpublished:
            values = [item for item in values if item.status == "published"]
        return sorted(values, key=lambda item: (item.manifest.category, item.name))

    def get(self, skill_id: str) -> SkillDefinition:
        try:
            return self._load()[skill_id]
        except KeyError as exc:
            raise KeyError(f"skill not found: {skill_id}") from exc

    def match(self, text: str) -> list[SkillDefinition]:
        normalized = text.casefold()
        matches = []
        for item in self.list_skills(include_unpublished=False):
            parts = [
                item.id,
                item.name,
                item.manifest.description,
                item.manifest.category,
                " ".join(item.manifest.tags),
            ]
            haystack = " ".join(parts).casefold()
            direct = any(part and part.casefold() in normalized for part in parts)
            token_hit = any(token and token in haystack for token in normalized.split())
            cjk_overlap = len(set(normalized) & set(haystack)) >= 4
            if direct or token_hit or cjk_overlap:
                matches.append(item)
        return matches


@lru_cache(maxsize=1)
def get_default_skill_registry() -> SkillRegistry:
    return SkillRegistry(default_skill_root())
