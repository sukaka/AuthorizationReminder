from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Callable

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import (
    Component,
    MergedComponent,
    MergedVulnerability,
    NormalizedComponent,
    NormalizedVulnerability,
    ScanTask,
    VulnerabilityRecord,
)
from .scanners.base import NormalizedComponentData, NormalizedVulnerabilityData
from .scanners.identity import stable_component_keys
from .scanners.merger.component_merger import merge_components
from .scanners.merger.vulnerability_merger import merge_vulnerabilities
from .scanners.normalizers.dependency_check_normalizer import normalize_dependency_check
from .scanners.normalizers.dependency_track_normalizer import (
    normalize_dependency_track_components,
    normalize_dependency_track_findings,
)
from .scanners.normalizers.opensca_normalizer import normalize_opensca
from .scanners.normalizers.syft_normalizer import normalize_syft_cyclonedx
from .scanners.normalizers.trivy_normalizer import normalize_trivy


Normalizer = Callable[
    [Path],
    tuple[list[NormalizedComponentData], list[NormalizedVulnerabilityData]],
]

NORMALIZERS: dict[str, Normalizer] = {
    "opensca": normalize_opensca,
    "syft": lambda path: (normalize_syft_cyclonedx(path), []),
    "trivy": normalize_trivy,
    "dependency-check": normalize_dependency_check,
}


def persist_scan_results(
    db: Session,
    scan_task: ScanTask,
    report_paths: dict[str, Path],
) -> dict[str, int]:
    db.execute(delete(MergedVulnerability).where(MergedVulnerability.scan_id == scan_task.id))
    db.execute(delete(MergedComponent).where(MergedComponent.scan_id == scan_task.id))
    db.execute(delete(NormalizedVulnerability).where(NormalizedVulnerability.scan_id == scan_task.id))
    db.execute(delete(NormalizedComponent).where(NormalizedComponent.scan_id == scan_task.id))
    db.flush()

    components: list[NormalizedComponentData] = []
    vulnerabilities: list[NormalizedVulnerabilityData] = []
    for engine, path in report_paths.items():
        if not path.exists():
            continue
        if engine == "dependency-track-components":
            payload = json.loads(path.read_text(encoding="utf-8"))
            engine_components = normalize_dependency_track_components(
                payload if isinstance(payload, list) else []
            )
            engine_vulnerabilities: list[NormalizedVulnerabilityData] = []
        elif engine == "dependency-track-findings":
            payload = json.loads(path.read_text(encoding="utf-8"))
            engine_components = []
            engine_vulnerabilities = normalize_dependency_track_findings(
                payload if isinstance(payload, list) else []
            )
        elif engine in NORMALIZERS:
            engine_components, engine_vulnerabilities = NORMALIZERS[engine](path)
        else:
            continue
        components.extend(engine_components)
        vulnerabilities.extend(engine_vulnerabilities)

    for item in components:
        db.add(
            NormalizedComponent(
                project_id=scan_task.project_id,
                scan_id=scan_task.id,
                **asdict(item),
            )
        )
    for item in vulnerabilities:
        payload = asdict(item)
        payload["fixed_versions"] = json.dumps(payload.pop("fixed_versions"), ensure_ascii=False)
        payload["references_json"] = json.dumps(payload.pop("references"), ensure_ascii=False)
        db.add(
            NormalizedVulnerability(
                project_id=scan_task.project_id,
                scan_id=scan_task.id,
                **payload,
            )
        )
    db.flush()
    _persist_merged_rows(db, scan_task, components, vulnerabilities)
    return {"components": len(components), "vulnerabilities": len(vulnerabilities)}


def _persist_merged_rows(
    db: Session,
    scan_task: ScanTask,
    components: list[NormalizedComponentData],
    vulnerabilities: list[NormalizedVulnerabilityData],
) -> None:
    for item in merge_components(components):
        db.add(
            MergedComponent(
                project_id=scan_task.project_id,
                scan_id=scan_task.id,
                package_name=str(item["package_name"]),
                normalized_name=str(item["normalized_name"]),
                ecosystem=str(item["ecosystem"]),
                package_manager=str(item["package_manager"]),
                version=str(item["version"]),
                purl=str(item["purl"]),
                cpe=str(item["cpe"]),
                sha1=str(item["sha1"]),
                gav=str(item["gav"]),
                license=str(item["license"]),
                detected_by_engines=json.dumps(item["detected_by_engines"], ensure_ascii=False),
                engine_count=int(item["engine_count"]),
                evidence_list_json=json.dumps(item["evidence_list"], ensure_ascii=False),
                merged_confidence_score=float(item["merged_confidence_score"]),
                confidence_level=str(item["confidence_level"]),
            )
        )

    for item in merge_vulnerabilities(vulnerabilities):
        db.add(
            MergedVulnerability(
                project_id=scan_task.project_id,
                scan_id=scan_task.id,
                vulnerability_id=str(item["vulnerability_id"]),
                cve_id=str(item["cve_id"]),
                ghsa_id=str(item["ghsa_id"]),
                osv_id=str(item["osv_id"]),
                title=str(item["title"]),
                description=str(item["description"]),
                severity=str(item["severity"]),
                cvss_score=float(item["cvss_score"]),
                affected_version_range=str(item["affected_version_range"]),
                current_version=str(item["current_version"]),
                fixed_versions_json=json.dumps(item["fixed_versions"], ensure_ascii=False),
                detected_by_engines=json.dumps(item["detected_by_engines"], ensure_ascii=False),
                engine_count=int(item["engine_count"]),
                vulnerability_sources_json=json.dumps(
                    item["vulnerability_sources"],
                    ensure_ascii=False,
                ),
                multi_engine_confidence_score=float(item["multi_engine_confidence_score"]),
                confidence_level=str(item["confidence_level"]),
                confidence_reason=str(item["confidence_reason"]),
                engine_agreement=str(item["engine_agreement"]),
                disagreement_summary=str(item["disagreement_summary"]),
                need_manual_review=bool(item["need_manual_review"]),
                manual_review_reason=str(item["manual_review_reason"]),
                confirmation_status=str(item["confirmation_status"]),
                confirmation_engines=json.dumps(item["confirmation_engines"], ensure_ascii=False),
                gate_eligible=bool(item["gate_eligible"]),
                review_reason=str(item["review_reason"]),
            )
        )
    db.flush()


def _json_list(value: str) -> list[object]:
    try:
        parsed = json.loads(value or "[]")
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []


def _first_json_value(value: str) -> str:
    return next((str(item) for item in _json_list(value) if item), "")


def _first_dependency_check_reference(value: str) -> str:
    for source in _json_list(value):
        if not isinstance(source, dict) or source.get("source_engine") != "dependency-check":
            continue
        references = source.get("references")
        if isinstance(references, list):
            return next((str(item) for item in references if item), "")
    return ""


def _source_identity(row: MergedVulnerability) -> set[str]:
    keys: set[str] = set()
    for source in _json_list(row.vulnerability_sources_json):
        if not isinstance(source, dict):
            continue
        keys.update(
            stable_component_keys(
                sha1=str(source.get("affected_sha1") or ""),
                gav=str(source.get("affected_gav") or ""),
                purl=str(source.get("affected_purl") or ""),
                ecosystem="maven" if source.get("affected_gav") else "",
                name=str(source.get("affected_package") or ""),
                version=str(source.get("current_version") or ""),
            )
        )
    return keys


def match_project_component(
    components: list[Component],
    row: MergedVulnerability,
) -> Component | None:
    source_keys = _source_identity(row)
    if not source_keys:
        return None
    for component in components:
        gav = (
            f"{component.group_id}:{component.artifact_id}:"
            f"{component.version_normalized or component.package_version}"
            if component.group_id and component.artifact_id
            else ""
        )
        component_keys = set(
            stable_component_keys(
                sha1=component.sha1,
                gav=gav,
                purl=component.purl,
                ecosystem=component.ecosystem,
                name=component.normalized_name or component.package_name,
                version=component.version_normalized or component.package_version,
            )
        )
        if source_keys & component_keys:
            return component
    return None


def promote_dependency_check_findings(db: Session, project_id: int, scan_id: int) -> int:
    rows = db.query(MergedVulnerability).filter_by(project_id=project_id, scan_id=scan_id).all()
    components = db.query(Component).filter_by(project_id=project_id).all()
    created = 0
    for row in rows:
        engines = {str(item) for item in _json_list(row.detected_by_engines)}
        if "dependency-check" not in engines or row.confirmation_status == "rejected":
            continue
        component = match_project_component(components, row)
        if not component:
            continue
        query = db.query(VulnerabilityRecord).filter_by(
            project_id=project_id,
            component_id=component.id,
        )
        if row.cve_id:
            existing = query.filter_by(cve_id=row.cve_id).first()
        else:
            existing = query.filter_by(advisory_id=row.vulnerability_id).first()
        if existing:
            if existing.source != "dependency-check":
                engines.add(existing.source)
                existing.confirmation_status = "cross_confirmed"
                existing.confirmation_engines = json.dumps(sorted(engines), ensure_ascii=False)
                existing.review_reason = ""
            else:
                existing.confirmation_status = row.confirmation_status
                existing.confirmation_engines = row.detected_by_engines
                existing.gate_eligible = row.gate_eligible
                existing.review_reason = row.review_reason
                existing.match_status = "affected" if row.gate_eligible else "unknown"
                existing.matched_by = "multi_engine" if row.gate_eligible else "dependency_check_only"
                existing.needs_human_review = not row.gate_eligible or row.need_manual_review
            component.vulnerability_status = "vulnerable"
            continue

        db.add(
            VulnerabilityRecord(
                project_id=project_id,
                component_id=component.id,
                source="dependency-check",
                advisory_id=row.vulnerability_id,
                cve_id=row.cve_id,
                package_name=component.package_name,
                package_version=component.package_version,
                ecosystem=component.ecosystem,
                cvss_score=row.cvss_score,
                severity=row.severity,
                confidence_score=row.multi_engine_confidence_score / 100,
                match_status="affected" if row.gate_eligible else "unknown",
                matched_by="multi_engine" if row.gate_eligible else "dependency_check_only",
                match_reason=row.confidence_reason,
                needs_human_review=not row.gate_eligible or row.need_manual_review,
                false_positive_possibility="medium" if row.gate_eligible else "high",
                risk_priority=row.risk_priority if row.gate_eligible else "Review",
                description=row.description,
                fixed_version=_first_json_value(row.fixed_versions_json),
                detail_url=_first_dependency_check_reference(row.vulnerability_sources_json),
                raw_json=row.vulnerability_sources_json,
                confirmation_status=row.confirmation_status,
                confirmation_engines=row.detected_by_engines,
                gate_eligible=row.gate_eligible,
                review_reason=row.review_reason,
            )
        )
        component.vulnerability_status = "vulnerable"
        created += 1
    return created


def latest_completed_project_scan(db: Session, project_id: int) -> ScanTask | None:
    return (
        db.query(ScanTask)
        .filter(
            ScanTask.project_id == project_id,
            ScanTask.parent_task_id.is_(None),
            ScanTask.status.in_(["success", "completed", "partial_completed"]),
        )
        .order_by(ScanTask.created_at.desc(), ScanTask.id.desc())
        .first()
    )
