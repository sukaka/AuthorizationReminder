from .types import Observation, ToolResult


class Observer:
    def observe(self, result: ToolResult) -> Observation:
        if result.error:
            return Observation(
                is_empty=True,
                sufficient=False,
                has_sources=False,
                summary=f"工具失败：{result.error}",
            )
        has_sources = bool(result.chunks)
        return Observation(
            is_empty=not has_sources and not result.content,
            sufficient=has_sources or bool(result.content),
            has_sources=has_sources,
            summary="检索到资料" if has_sources else "未检索到资料",
        )

