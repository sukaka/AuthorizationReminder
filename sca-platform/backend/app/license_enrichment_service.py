from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .license_policy import is_unknown_license, license_requires_review, normalize_license_name
from .models import Component, PackageLicenseCache

GENERIC_LICENSE_TEXTS = {"dual license", "see license", "see license file", "other/proprietary license", "unknown"}


@dataclass(frozen=True)
class LicenseEnrichmentResult:
    license_name: str
    license_raw: str
    license_source: str
    license_confidence: float
    license_needs_review: bool = False


def needs_license_enrichment(component: Component) -> bool:
    return is_unknown_license(component.license_name) or bool(component.license_needs_review)


def _package_version(component: Component) -> str:
    value = component.version_normalized or component.resolved_version or component.package_version or ""
    return "" if value == "unknown" else value


def _cache_key(component: Component) -> tuple[str, str, str]:
    return ((component.ecosystem or "").lower(), component.normalized_name or component.package_name, _package_version(component))


def _from_cache(db: Session, component: Component) -> LicenseEnrichmentResult | None:
    ecosystem, package_name, package_version = _cache_key(component)
    row = (
        db.query(PackageLicenseCache)
        .filter(
            PackageLicenseCache.ecosystem == ecosystem,
            PackageLicenseCache.package_name == package_name,
            PackageLicenseCache.package_version == package_version,
        )
        .first()
    )
    if not row:
        row = (
            db.query(PackageLicenseCache)
            .filter(
                PackageLicenseCache.ecosystem == ecosystem,
                PackageLicenseCache.package_name == package_name,
                PackageLicenseCache.package_version == "",
            )
            .first()
        )
    if not row:
        return None
    result = LicenseEnrichmentResult(
        license_name=row.license_name,
        license_raw=row.license_raw,
        license_source=row.license_source,
        license_confidence=row.license_confidence,
        license_needs_review=row.license_needs_review,
    )
    return None if result.license_needs_review else result


def _store_cache(db: Session, component: Component, result: LicenseEnrichmentResult) -> None:
    ecosystem, package_name, package_version = _cache_key(component)
    row = (
        db.query(PackageLicenseCache)
        .filter(
            PackageLicenseCache.ecosystem == ecosystem,
            PackageLicenseCache.package_name == package_name,
            PackageLicenseCache.package_version == package_version,
        )
        .first()
    )
    if not row:
        row = PackageLicenseCache(ecosystem=ecosystem, package_name=package_name, package_version=package_version)
        db.add(row)
    row.license_name = result.license_name
    row.license_raw = result.license_raw
    row.license_source = result.license_source
    row.license_confidence = result.license_confidence
    row.license_needs_review = result.license_needs_review


def _license_result(raw: str, source: str, confidence: float) -> LicenseEnrichmentResult | None:
    license_raw = (raw or "").strip()
    license_name = normalize_license_name(license_raw)
    if is_unknown_license(license_name):
        return None
    return LicenseEnrichmentResult(
        license_name=license_name,
        license_raw=license_raw,
        license_source=source,
        license_confidence=confidence,
        license_needs_review=license_requires_review(license_name),
    )


def _json_license(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("type", "name", "id"):
            text = _json_license(value.get(key))
            if text:
                return text
    if isinstance(value, list):
        values = [text for item in value if (text := _json_license(item))]
        return " OR ".join(dict.fromkeys(values))
    return ""


def _lookup_npm(client: httpx.Client, component: Component, settings: Settings) -> LicenseEnrichmentResult | None:
    package_name = component.normalized_name or component.package_name
    response = client.get(f"{settings.npm_registry_url.rstrip('/')}/{quote(package_name, safe='')}")
    response.raise_for_status()
    payload = response.json()
    raw_license = _json_license(payload.get("license"))
    version = _package_version(component)
    versions = payload.get("versions") if isinstance(payload, dict) else {}
    if version and isinstance(versions, dict) and isinstance(versions.get(version), dict):
        raw_license = _json_license(versions[version].get("license")) or raw_license
    return _license_result(raw_license, "npm_registry", 0.94)


def _lookup_pypi(client: httpx.Client, component: Component, settings: Settings) -> LicenseEnrichmentResult | None:
    package_name = component.normalized_name or component.package_name
    response = client.get(f"{settings.pypi_api_url.rstrip('/')}/{quote(package_name, safe='')}/json")
    response.raise_for_status()
    payload = response.json()
    info = payload.get("info") if isinstance(payload, dict) else {}
    if not isinstance(info, dict):
        return None
    raw_license = _json_license(info.get("license"))
    classifiers = info.get("classifiers") or []
    classifier_license = next(
        (
            str(classifier).rsplit("::", 1)[-1].strip()
            for classifier in classifiers
            if str(classifier).lower().startswith("license ::") and str(classifier).rsplit("::", 1)[-1].strip()
        ),
        "",
    )
    if is_unknown_license(raw_license) or raw_license.strip().lower() in GENERIC_LICENSE_TEXTS:
        raw_license = classifier_license or raw_license
    return _license_result(raw_license, "pypi_registry", 0.9)


def _xml_text(element: ET.Element, local_name: str) -> str:
    for child in element.iter():
        if child.tag.rsplit("}", 1)[-1] == local_name and child.text:
            return child.text.strip()
    return ""


def _lookup_maven(client: httpx.Client, component: Component, settings: Settings) -> LicenseEnrichmentResult | None:
    group_id = component.group_id
    artifact_id = component.artifact_id
    if not group_id or not artifact_id:
        group_id, _, artifact_id = component.package_name.partition(":")
    version = _package_version(component)
    if not group_id or not artifact_id or not version:
        return None
    group_path = group_id.replace(".", "/")
    pom_url = f"{settings.maven_repository_url.rstrip('/')}/{group_path}/{artifact_id}/{version}/{artifact_id}-{version}.pom"
    response = client.get(pom_url)
    response.raise_for_status()
    root = ET.fromstring(response.text)
    license_nodes = [item for item in root.iter() if item.tag.rsplit("}", 1)[-1] == "license"]
    raw_license = next((_xml_text(item, "name") for item in license_nodes if _xml_text(item, "name")), "")
    return _license_result(raw_license, "maven_pom", 0.88)


def lookup_component_license(component: Component, settings: Settings | None = None) -> LicenseEnrichmentResult | None:
    settings = settings or get_settings()
    timeout = max(settings.license_enrichment_timeout_ms / 1000, 1)
    with httpx.Client(timeout=timeout) as client:
        if component.ecosystem == "npm":
            return _lookup_npm(client, component, settings)
        if component.ecosystem == "pypi":
            return _lookup_pypi(client, component, settings)
        if component.ecosystem == "maven":
            return _lookup_maven(client, component, settings)
    return None


def apply_license_result(component: Component, result: LicenseEnrichmentResult) -> None:
    component.license_name = result.license_name
    component.license_raw = result.license_raw
    component.license_source = result.license_source
    component.license_confidence = result.license_confidence
    component.license_needs_review = result.license_needs_review


def enrich_missing_component_licenses(db: Session, project_id: int, settings: Settings | None = None) -> dict[str, int]:
    settings = settings or get_settings()
    if not settings.license_enrichment_enabled:
        return {"total": 0, "updated": 0, "cached": 0, "failed": 0}
    components = db.query(Component).filter(Component.project_id == project_id).order_by(Component.id.asc()).all()
    candidates = [component for component in components if needs_license_enrichment(component)]
    stats = {"total": len(candidates), "updated": 0, "cached": 0, "failed": 0}
    for component in candidates:
        result = _from_cache(db, component)
        if result:
            apply_license_result(component, result)
            stats["updated"] += 1
            stats["cached"] += 1
            continue
        try:
            result = lookup_component_license(component, settings)
        except Exception:
            stats["failed"] += 1
            continue
        if not result:
            stats["failed"] += 1
            continue
        apply_license_result(component, result)
        _store_cache(db, component, result)
        stats["updated"] += 1
    db.flush()
    return stats
