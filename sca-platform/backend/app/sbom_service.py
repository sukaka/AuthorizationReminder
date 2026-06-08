from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import Component, ImageScan, ImageScanFinding, Project


def _tool_path(value: str) -> str | None:
    if "/" in value:
        return value if Path(value).exists() else None
    return shutil.which(value)


def _components(db: Session, project_id: int) -> list[Component]:
    return list(db.scalars(select(Component).where(Component.project_id == project_id).order_by(Component.ecosystem, Component.package_name)))


def cyclonedx_from_database(project: Project, components: list[Component]) -> dict:
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {"component": {"type": "application", "name": project.name}},
        "components": [
            {
                "type": "library" if component.ecosystem != "docker" else "container",
                "name": component.package_name,
                "version": component.package_version,
                "purl": component.purl or f"pkg:{component.ecosystem}/{component.package_name}@{component.package_version}",
                "licenses": [{"license": {"name": component.license_name}}],
                "evidence": {
                    "source": {
                        "name": component.evidence_file or component.source_path,
                        "line": component.evidence_line,
                    }
                },
            }
            for component in components
        ],
    }


def spdx_from_database(project: Project, components: list[Component]) -> dict:
    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": project.name,
        "documentNamespace": f"https://juxin.local/sca/{project.id}/{int(datetime.now(timezone.utc).timestamp())}",
        "creationInfo": {"creators": ["Tool: 聚信SCA"], "created": datetime.now(timezone.utc).isoformat()},
        "packages": [
            {
                "SPDXID": f"SPDXRef-Package-{component.id}",
                "name": component.package_name,
                "versionInfo": component.package_version,
                "licenseConcluded": component.license_name or "NOASSERTION",
            }
            for component in components
        ],
    }


def generate_sbom(db: Session, project_id: int, fmt: str, settings: Settings) -> tuple[Path, int, str]:
    project = db.get(Project, project_id)
    if not project:
        raise ValueError("项目不存在")
    output_dir = Path(settings.sbom_root) / "documents"
    output_dir.mkdir(parents=True, exist_ok=True)
    extension = "json"
    path = output_dir / f"juxin-sca-sbom-{project_id}-{fmt}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.{extension}"
    components = _components(db, project_id)
    document = cyclonedx_from_database(project, components) if fmt == "cyclonedx" else spdx_from_database(project, components)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    return path, len(components), "database"


def _risk_score(severity_counts: dict[str, int]) -> float:
    score = severity_counts.get("critical", 0) * 10
    score += severity_counts.get("high", 0) * 7
    score += severity_counts.get("medium", 0) * 4
    score += severity_counts.get("low", 0)
    return min(float(score), 100.0)


def scan_image(db: Session, payload: ImageScan, settings: Settings) -> ImageScan:
    scanner_path = _tool_path(settings.tool_trivy_path if payload.scanner == "trivy" else settings.tool_grype_path)
    if not scanner_path:
        payload.status = "tool_missing"
        payload.summary = f"{payload.scanner} 未安装，Docker 编排已预留工具集成路径"
        payload.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(payload)
        return payload

    target = payload.tar_path if payload.tar_path else payload.image_ref
    if payload.scanner == "trivy":
        command = [scanner_path, "image", "--format", "json", target]
    else:
        command = [scanner_path, target, "-o", "json"]
    output_dir = Path(settings.sbom_root) / "image-scans"
    output_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = output_dir / f"{payload.id or 'pending'}-{payload.scanner}.stdout.log"
    stderr_path = output_dir / f"{payload.id or 'pending'}-{payload.scanner}.stderr.log"
    try:
        with stdout_path.open("w", encoding="utf-8") as stdout_handle, stderr_path.open("w", encoding="utf-8") as stderr_handle:
            completed = subprocess.run(
                command,
                check=False,
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                timeout=300,
            )
        raw_output = stdout_path.read_text(encoding="utf-8", errors="replace")
        error_output = stderr_path.read_text(encoding="utf-8", errors="replace")
        payload.raw_json = raw_output[:200000]
        if completed.returncode != 0:
            payload.status = "failed"
            payload.summary = error_output[-1000:] or "镜像扫描失败"
        else:
            severity_counts = _save_findings(db, payload, raw_output)
            payload.status = "success"
            payload.risk_score = _risk_score(severity_counts)
            payload.summary = "镜像扫描完成：" + ", ".join(f"{key}={value}" for key, value in severity_counts.items())
    except Exception as exc:
        payload.status = "failed"
        payload.summary = str(exc)
    payload.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(payload)
    return payload


def _save_findings(db: Session, scan: ImageScan, raw: str) -> dict[str, int]:
    data = json.loads(raw or "{}")
    findings = []
    if scan.scanner == "trivy":
        for result in data.get("Results") or []:
            findings.extend(result.get("Vulnerabilities") or [])
    else:
        findings = data.get("matches") or []
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for item in findings:
        vuln = item.get("vulnerability") or item
        artifact = item.get("artifact") or item
        severity = str(vuln.get("Severity") or vuln.get("severity") or "unknown").lower()
        if severity not in counts:
            severity = "unknown"
        counts[severity] += 1
        db.add(
            ImageScanFinding(
                image_scan_id=scan.id,
                package_name=str(artifact.get("PkgName") or artifact.get("name") or ""),
                package_version=str(artifact.get("InstalledVersion") or artifact.get("version") or ""),
                vulnerability_id=str(vuln.get("VulnerabilityID") or vuln.get("id") or ""),
                severity=severity,
                fixed_version=str(vuln.get("FixedVersion") or vuln.get("fix", {}).get("versions", "") or ""),
                description=str(vuln.get("Description") or vuln.get("description") or ""),
            )
        )
    return counts
