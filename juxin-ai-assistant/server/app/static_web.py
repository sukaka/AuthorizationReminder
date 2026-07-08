from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_static_web(app: FastAPI, *, static_dir: str, enabled: bool) -> None:
    root = Path(static_dir).resolve()
    assets_dir = root / "assets"
    index_file = root / "index.html"

    if enabled and assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="web-assets")

    @app.get("/{full_path:path}")
    async def serve_web_spa(full_path: str, request: Request) -> FileResponse:
        if request.url.path.startswith("/api/"):
            raise HTTPException(status_code=404)
        if not enabled or not index_file.exists():
            raise HTTPException(status_code=404)

        requested_path = (root / full_path).resolve()
        if (
            full_path
            and requested_path.is_file()
            and requested_path.is_relative_to(root)
        ):
            return FileResponse(requested_path)

        return FileResponse(index_file)
