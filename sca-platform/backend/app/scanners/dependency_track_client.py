from __future__ import annotations

import base64
from pathlib import Path

import httpx

from ..config import Settings


def _json_or_empty(response: httpx.Response) -> dict[str, object]:
    if not response.content or not response.text.strip():
        return {}
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


class DependencyTrackClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.dependency_track_url.rstrip("/")
        self.timeout = settings.dependency_track_timeout
        self.headers = {"X-Api-Key": settings.dependency_track_api_key} if settings.dependency_track_api_key else {}

    def enabled(self) -> bool:
        return bool(self.settings.dependency_track_enabled and self.settings.dependency_track_api_key)

    def create_project(self, name: str, version: str = "latest") -> dict[str, object]:
        payload = {"name": name, "version": version, "classifier": "APPLICATION", "active": True}
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.put(f"{self.base_url}/api/v1/project", json=payload)
            response.raise_for_status()
            return response.json()

    def find_projects(self, name: str) -> list[dict[str, object]]:
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.get(f"{self.base_url}/api/v1/project/lookup", params={"name": name})
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else [data]

    def upload_bom(self, project_uuid: str, bom_path: Path) -> dict[str, object]:
        payload = {
            "project": project_uuid,
            "bom": base64.b64encode(bom_path.read_bytes()).decode("ascii"),
            "autoCreate": False,
        }
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.put(f"{self.base_url}/api/v1/bom", json=payload)
            response.raise_for_status()
            return _json_or_empty(response)

    def fetch_components(self, project_uuid: str) -> list[dict[str, object]]:
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.get(f"{self.base_url}/api/v1/component/project/{project_uuid}")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []

    def fetch_findings(self, project_uuid: str) -> list[dict[str, object]]:
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.get(f"{self.base_url}/api/v1/finding/project/{project_uuid}")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []

    def fetch_metrics(self, project_uuid: str) -> dict[str, object]:
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            response = client.get(f"{self.base_url}/api/v1/metrics/project/{project_uuid}/current")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, dict) else {}
