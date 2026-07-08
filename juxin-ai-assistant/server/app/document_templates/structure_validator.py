from __future__ import annotations

import re
from typing import Sequence


HEADING_PATTERN = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
NUMBER_PREFIX_PATTERN = re.compile(
    r"^[一二三四五六七八九十百千万零〇两]+、\s*|^\d+[.)]\s*|^（\d+）\s*"
)


def normalize_heading_text(text: str) -> str:
    cleaned = text.strip().replace("*", "").replace("`", "")
    return NUMBER_PREFIX_PATTERN.sub("", cleaned).strip()


def strip_duplicate_template_headings(
    markdown: str,
    *,
    fixed_headings: Sequence[str],
) -> str:
    fixed = {normalize_heading_text(heading) for heading in fixed_headings}
    output_lines: list[str] = []
    for line in markdown.splitlines():
        match = HEADING_PATTERN.match(line.strip())
        if match and normalize_heading_text(match.group(2)) in fixed:
            continue
        output_lines.append(line)
    return "\n".join(output_lines).strip()
