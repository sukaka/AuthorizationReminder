from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Component, ComponentDependency, Project, RiskMonitorSnapshot, VulnerabilityRecord


SEVERITY_SCORE = {"critical": 5, "high": 4, "medium": 3, "low": 2, "unknown": 1}
RISKY_LICENSES = {"GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-3.0", "unknown"}


def highest_severity(values: list[str]) -> str:
    if not values:
        return "unknown"
    return max(values, key=lambda item: SEVERITY_SCORE.get(item, 0))


def asset_dashboard(db: Session) -> dict:
    components = list(db.scalars(select(Component)))
    vulnerabilities = list(db.scalars(select(VulnerabilityRecord)))
    snapshots = list(db.scalars(select(RiskMonitorSnapshot)))
    by_ecosystem = Counter(component.ecosystem for component in components)
    by_severity = Counter(vulnerability.severity for vulnerability in vulnerabilities)
    return {
        "project_total": db.scalar(select(func.count(Project.id))) or 0,
        "component_total": len(components),
        "vulnerability_total": len(vulnerabilities),
        "high_risk_total": sum(1 for item in vulnerabilities if item.severity in {"critical", "high"}),
        "eol_total": sum(1 for item in snapshots if item.eol_status in {"eol", "review"}),
        "license_risk_total": sum(1 for item in components if item.license_name in RISKY_LICENSES),
        "by_ecosystem": dict(by_ecosystem),
        "by_severity": dict(by_severity),
    }


def asset_components(db: Session, search: str = "") -> list[dict]:
    components = list(db.scalars(select(Component)))
    vulnerabilities = list(db.scalars(select(VulnerabilityRecord)))
    snapshots = list(db.scalars(select(RiskMonitorSnapshot)))
    grouped: dict[tuple[str, str], dict] = {}
    vuln_by_package: dict[tuple[str, str], list[VulnerabilityRecord]] = defaultdict(list)
    for vulnerability in vulnerabilities:
        vuln_by_package[(vulnerability.ecosystem, vulnerability.package_name)].append(vulnerability)
    eol_by_package = {(snapshot.component_name, snapshot.project_id): snapshot.eol_status for snapshot in snapshots}
    for component in components:
        if search and search.lower() not in component.package_name.lower():
            continue
        key = (component.ecosystem, component.package_name)
        item = grouped.setdefault(
            key,
            {
                "package_name": component.package_name,
                "ecosystem": component.ecosystem,
                "project_ids": set(),
                "versions": set(),
                "license_name": component.license_name,
                "eol_status": "unknown",
            },
        )
        item["project_ids"].add(component.project_id)
        item["versions"].add(component.package_version)
        if eol_by_package.get((component.package_name, component.project_id)) in {"eol", "review"}:
            item["eol_status"] = eol_by_package[(component.package_name, component.project_id)]
    result = []
    for key, item in grouped.items():
        vulns = vuln_by_package.get(key, [])
        result.append(
            {
                "package_name": item["package_name"],
                "ecosystem": item["ecosystem"],
                "project_count": len(item["project_ids"]),
                "version_count": len(item["versions"]),
                "vulnerability_count": len(vulns),
                "highest_severity": highest_severity([vulnerability.severity for vulnerability in vulns]),
                "eol_status": item["eol_status"],
                "license_name": item["license_name"],
            }
        )
    return sorted(result, key=lambda item: (SEVERITY_SCORE.get(item["highest_severity"], 0), item["vulnerability_count"]), reverse=True)


def asset_graph(db: Session) -> dict:
    projects = list(db.scalars(select(Project)))
    components = list(db.scalars(select(Component)))
    dependencies = list(db.scalars(select(ComponentDependency)))
    vulnerabilities = list(db.scalars(select(VulnerabilityRecord)))
    vuln_by_component = defaultdict(list)
    for vulnerability in vulnerabilities:
        vuln_by_component[vulnerability.component_id].append(vulnerability.severity)
    nodes = []
    edges = []
    for project in projects:
        nodes.append({"id": f"project:{project.id}", "label": project.name, "type": "project", "risk": "low"})
    for component in components:
        severity = highest_severity(vuln_by_component.get(component.id, []))
        node_id = f"component:{component.id}"
        nodes.append({"id": node_id, "label": component.package_name, "type": "component", "risk": severity})
        edges.append({"source": f"project:{component.project_id}", "target": node_id, "label": "uses"})
    for dependency in dependencies:
        if dependency.parent_component_id:
            edges.append(
                {
                    "source": f"component:{dependency.parent_component_id}",
                    "target": f"component:{dependency.child_component_id}",
                    "label": dependency.relationship_type,
                }
            )
    return {"nodes": nodes, "edges": edges}
