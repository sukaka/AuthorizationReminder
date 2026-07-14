from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .admin.route_common import write_request_audit
from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .project_access import require_project_access, require_project_manager
from .project_initialization_models import (
    ProjectAsset,
    ProjectBusinessSystem,
    ProjectContract,
    ProjectExecutionRule,
    ProjectServiceScope,
    ProjectServiceScopeVersion,
    ProjectServiceTarget,
    ProjectTargetGroup,
)
from .project_workspace_models import Project
from .schemas import SessionPayload


router = APIRouter(prefix="/api/ai/projects", tags=["project-initialization"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContractCreateIn(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    contract_no: str = Field(default="", max_length=96)
    customer_name: str = Field(default="", max_length=160)
    source_file_uuid: str | None = Field(default=None, max_length=36)
    extracted_payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name", "contract_no", "customer_name", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ConfirmIn(StrictModel):
    change_summary: str = Field(default="", max_length=2000)


class ServiceScopeCreateIn(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    category: str = Field(default="", max_length=96)
    description: str = Field(default="", max_length=4000)
    frequency: str = Field(default="", max_length=48)
    deliverable: str = Field(default="", max_length=160)
    acceptance_criteria: str = Field(default="", max_length=4000)
    contract_uuid: str | None = Field(default=None, max_length=36)

    @field_validator("name", "category", "description", "frequency", "deliverable", "acceptance_criteria", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ScopeVersionCreateIn(StrictModel):
    snapshot_json: dict[str, Any] = Field(default_factory=dict)
    change_summary: str = Field(default="", max_length=2000)


class SystemCreateIn(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    system_type: str = Field(default="", max_length=96)
    department: str = Field(default="", max_length=128)
    owner: str = Field(default="", max_length=128)
    deployment: str = Field(default="", max_length=96)
    criticality: str = Field(default="medium", max_length=24)
    internet_exposed: bool = False
    in_scope: bool = True
    notes: str = Field(default="", max_length=4000)


class AssetCreateIn(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    asset_type: str = Field(default="", max_length=96)
    identifier: str = Field(default="", max_length=160)
    network_location: str = Field(default="", max_length=160)
    purpose: str = Field(default="", max_length=256)
    owner: str = Field(default="", max_length=128)
    operating_system: str = Field(default="", max_length=128)
    vendor_model: str = Field(default="", max_length=160)
    criticality: str = Field(default="medium", max_length=24)
    business_system_uuid: str | None = Field(default=None, max_length=36)
    in_scope: bool = True
    notes: str = Field(default="", max_length=4000)


class TargetGroupCreateIn(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    group_type: str = Field(default="custom", max_length=48)
    description: str = Field(default="", max_length=4000)
    selection_rule: dict[str, Any] = Field(default_factory=dict)


class ServiceTargetCreateIn(StrictModel):
    target_type: str = Field(min_length=1, max_length=48)
    target_value: str = Field(default="", max_length=256)
    scope_uuid: str | None = Field(default=None, max_length=36)
    target_group_uuid: str | None = Field(default=None, max_length=36)


class ExecutionRuleCreateIn(StrictModel):
    frequency: str = Field(default="", max_length=48)
    first_execution_date: date | None = None
    execution_day: str = Field(default="", max_length=48)
    time_window: str = Field(default="", max_length=96)
    responsible_user_id: str = Field(default="", max_length=64)
    collaborator_user_ids: list[str] = Field(default_factory=list, max_length=50)
    customer_contact: str = Field(default="", max_length=160)
    material_due_rule: str = Field(default="", max_length=256)
    template_name: str = Field(default="", max_length=160)
    skill_name: str = Field(default="", max_length=160)
    deliverable_type: str = Field(default="", max_length=96)
    due_rule: str = Field(default="", max_length=256)
    reviewer_user_id: str = Field(default="", max_length=64)
    acceptance_criteria: str = Field(default="", max_length=4000)
    allow_ai_execution: bool = False
    needs_approval: bool = True
    scope_uuid: str | None = Field(default=None, max_length=36)
    target_group_uuid: str | None = Field(default=None, max_length=36)


class ContractOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contract_uuid: str
    name: str
    contract_no: str
    customer_name: str
    source_file_uuid: str | None
    extraction_status: str
    extracted_payload: dict[str, Any]
    status: str
    confirmed_by: str | None
    confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ServiceScopeOut(BaseModel):
    scope_uuid: str
    contract_uuid: str | None
    name: str
    category: str
    description: str
    frequency: str
    deliverable: str
    acceptance_criteria: str
    status: str
    confirmation_status: str
    current_version: int
    confirmed_by: str | None
    confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ServiceScopeVersionOut(BaseModel):
    version_uuid: str
    scope_uuid: str
    version: int
    snapshot_json: dict[str, Any]
    change_summary: str
    created_by: str
    created_at: datetime


class SystemOut(BaseModel):
    system_uuid: str
    name: str
    system_type: str
    department: str
    owner: str
    deployment: str
    criticality: str
    internet_exposed: bool
    in_scope: bool
    status: str
    confirmation_status: str
    notes: str
    created_at: datetime
    updated_at: datetime


class AssetOut(BaseModel):
    asset_uuid: str
    business_system_uuid: str | None
    name: str
    asset_type: str
    identifier: str
    network_location: str
    purpose: str
    owner: str
    operating_system: str
    vendor_model: str
    criticality: str
    in_scope: bool
    status: str
    confirmation_status: str
    notes: str
    created_at: datetime
    updated_at: datetime


class TargetGroupOut(BaseModel):
    group_uuid: str
    name: str
    group_type: str
    description: str
    selection_rule: dict[str, Any]
    status: str
    created_at: datetime
    updated_at: datetime


class ServiceTargetOut(BaseModel):
    target_uuid: str
    scope_uuid: str | None
    target_group_uuid: str | None
    target_type: str
    target_value: str
    status: str
    created_at: datetime
    updated_at: datetime


class ExecutionRuleOut(BaseModel):
    rule_uuid: str
    scope_uuid: str | None
    target_group_uuid: str | None
    frequency: str
    first_execution_date: date | None
    execution_day: str
    time_window: str
    responsible_user_id: str
    collaborator_user_ids: list[str]
    customer_contact: str
    material_due_rule: str
    template_name: str
    skill_name: str
    deliverable_type: str
    due_rule: str
    reviewer_user_id: str
    acceptance_criteria: str
    allow_ai_execution: bool
    needs_approval: bool
    status: str
    created_at: datetime
    updated_at: datetime


class InitializationOut(BaseModel):
    project_uuid: str
    initialization_complete: bool
    counts: dict[str, int]


async def _require_ai_use(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action("ai_assistant:use", request, session_payload, current_settings)


def _require_project(
    db: Session,
    project_uuid: str,
    session_payload: SessionPayload,
) -> tuple[Project, Any]:
    return require_project_access(db, project_uuid, str(session_payload.user.id))


def _require_manager(
    db: Session,
    project_uuid: str,
    session_payload: SessionPayload,
) -> Project:
    project, member = _require_project(db, project_uuid, session_payload)
    require_project_manager(member)
    return project


def _audit(
    db: Session,
    session_payload: SessionPayload,
    request: Request,
    current_settings: Settings,
    *,
    action: str,
    entity_uuid: str,
    project_uuid: str,
) -> None:
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action=action,
        entity_type="project",
        entity_uuid=project_uuid,
        metadata={"resource_uuid": entity_uuid},
    )


def _contract_out(row: ProjectContract) -> ContractOut:
    return ContractOut(
        contract_uuid=row.uuid,
        name=row.name,
        contract_no=row.contract_no,
        customer_name=row.customer_name,
        source_file_uuid=row.source_file_uuid,
        extraction_status=row.extraction_status,
        extracted_payload=row.extracted_payload,
        status=row.status,
        confirmed_by=row.confirmed_by,
        confirmed_at=row.confirmed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _scope_out(db: Session, row: ProjectServiceScope) -> ServiceScopeOut:
    contract = db.get(ProjectContract, row.contract_id) if row.contract_id else None
    return ServiceScopeOut(
        scope_uuid=row.uuid,
        contract_uuid=contract.uuid if contract else None,
        name=row.name,
        category=row.category,
        description=row.description,
        frequency=row.frequency,
        deliverable=row.deliverable,
        acceptance_criteria=row.acceptance_criteria,
        status=row.status,
        confirmation_status=row.confirmation_status,
        current_version=row.current_version,
        confirmed_by=row.confirmed_by,
        confirmed_at=row.confirmed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _system_out(row: ProjectBusinessSystem) -> SystemOut:
    return SystemOut(
        system_uuid=row.uuid,
        name=row.name,
        system_type=row.system_type,
        department=row.department,
        owner=row.owner,
        deployment=row.deployment,
        criticality=row.criticality,
        internet_exposed=row.internet_exposed,
        in_scope=row.in_scope,
        status=row.status,
        confirmation_status=row.confirmation_status,
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _asset_out(db: Session, row: ProjectAsset) -> AssetOut:
    system = db.get(ProjectBusinessSystem, row.business_system_id) if row.business_system_id else None
    return AssetOut(
        asset_uuid=row.uuid,
        business_system_uuid=system.uuid if system else None,
        name=row.name,
        asset_type=row.asset_type,
        identifier=row.identifier,
        network_location=row.network_location,
        purpose=row.purpose,
        owner=row.owner,
        operating_system=row.operating_system,
        vendor_model=row.vendor_model,
        criticality=row.criticality,
        in_scope=row.in_scope,
        status=row.status,
        confirmation_status=row.confirmation_status,
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _group_out(row: ProjectTargetGroup) -> TargetGroupOut:
    return TargetGroupOut(
        group_uuid=row.uuid,
        name=row.name,
        group_type=row.group_type,
        description=row.description,
        selection_rule=row.selection_rule,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _target_out(db: Session, row: ProjectServiceTarget) -> ServiceTargetOut:
    scope = db.get(ProjectServiceScope, row.service_scope_id) if row.service_scope_id else None
    group = db.get(ProjectTargetGroup, row.target_group_id) if row.target_group_id else None
    return ServiceTargetOut(
        target_uuid=row.uuid,
        scope_uuid=scope.uuid if scope else None,
        target_group_uuid=group.uuid if group else None,
        target_type=row.target_type,
        target_value=row.target_value,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _rule_out(db: Session, row: ProjectExecutionRule) -> ExecutionRuleOut:
    scope = db.get(ProjectServiceScope, row.service_scope_id) if row.service_scope_id else None
    group = db.get(ProjectTargetGroup, row.target_group_id) if row.target_group_id else None
    return ExecutionRuleOut(
        rule_uuid=row.uuid,
        scope_uuid=scope.uuid if scope else None,
        target_group_uuid=group.uuid if group else None,
        frequency=row.frequency,
        first_execution_date=row.first_execution_date,
        execution_day=row.execution_day,
        time_window=row.time_window,
        responsible_user_id=row.responsible_user_id,
        collaborator_user_ids=row.collaborator_user_ids,
        customer_contact=row.customer_contact,
        material_due_rule=row.material_due_rule,
        template_name=row.template_name,
        skill_name=row.skill_name,
        deliverable_type=row.deliverable_type,
        due_rule=row.due_rule,
        reviewer_user_id=row.reviewer_user_id,
        acceptance_criteria=row.acceptance_criteria,
        allow_ai_execution=row.allow_ai_execution,
        needs_approval=row.needs_approval,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _owned_by_project(
    db: Session,
    model: Any,
    uuid: str,
    project_id: int,
    label: str,
) -> Any:
    row = db.scalar(select(model).where(model.uuid == uuid, model.project_id == project_id))
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label}不存在")
    return row


@router.get("/{project_uuid}/initialization", response_model=InitializationOut)
async def get_initialization(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> InitializationOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    models = {
        "contracts": ProjectContract,
        "service_scopes": ProjectServiceScope,
        "business_systems": ProjectBusinessSystem,
        "assets": ProjectAsset,
        "target_groups": ProjectTargetGroup,
        "service_targets": ProjectServiceTarget,
        "execution_rules": ProjectExecutionRule,
    }
    counts = {
        key: int(db.scalar(select(func.count()).select_from(model).where(model.project_id == project.id)) or 0)
        for key, model in models.items()
    }
    confirmed_contracts = db.scalar(
        select(func.count()).select_from(ProjectContract).where(
            ProjectContract.project_id == project.id,
            ProjectContract.status == "confirmed",
        )
    ) or 0
    confirmed_scopes = db.scalar(
        select(func.count()).select_from(ProjectServiceScope).where(
            ProjectServiceScope.project_id == project.id,
            ProjectServiceScope.confirmation_status == "confirmed",
        )
    ) or 0
    return InitializationOut(
        project_uuid=project.uuid,
        initialization_complete=bool(
            confirmed_contracts
            and confirmed_scopes
            and counts["business_systems"]
            and counts["assets"]
            and counts["target_groups"]
            and counts["service_targets"]
            and counts["execution_rules"]
        ),
        counts=counts,
    )


@router.get("/{project_uuid}/contracts", response_model=list[ContractOut])
async def list_contracts(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ContractOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectContract).where(ProjectContract.project_id == project.id).order_by(ProjectContract.id)).all()
    return [_contract_out(row) for row in rows]


@router.post("/{project_uuid}/contracts", response_model=ContractOut, status_code=201)
async def create_contract(
    project_uuid: str,
    body: ContractCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ContractOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    row = ProjectContract(
        project_id=project.id,
        name=body.name,
        contract_no=body.contract_no,
        customer_name=body.customer_name,
        source_file_uuid=body.source_file_uuid,
        extracted_payload=body.extracted_payload,
    )
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.contract.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _contract_out(row)


@router.post("/{project_uuid}/contracts/{contract_uuid}/confirm", response_model=ContractOut)
async def confirm_contract(
    project_uuid: str,
    contract_uuid: str,
    body: ConfirmIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ContractOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    row = _owned_by_project(db, ProjectContract, contract_uuid, project.id, "合同")
    row.status = "confirmed"
    row.extraction_status = "confirmed"
    row.confirmed_by = str(session_payload.user.id)
    row.confirmed_at = datetime.now(UTC).replace(tzinfo=None)
    _audit(db, session_payload, request, current_settings, action="project.initialization.contract.confirm", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _contract_out(row)


@router.get("/{project_uuid}/service-scopes", response_model=list[ServiceScopeOut])
async def list_service_scopes(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ServiceScopeOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectServiceScope).where(ProjectServiceScope.project_id == project.id).order_by(ProjectServiceScope.id)).all()
    return [_scope_out(db, row) for row in rows]


@router.post("/{project_uuid}/service-scopes", response_model=ServiceScopeOut, status_code=201)
async def create_service_scope(
    project_uuid: str,
    body: ServiceScopeCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ServiceScopeOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    contract_id = None
    if body.contract_uuid:
        contract_id = _owned_by_project(db, ProjectContract, body.contract_uuid, project.id, "合同").id
    row = ProjectServiceScope(
        project_id=project.id,
        contract_id=contract_id,
        name=body.name,
        category=body.category,
        description=body.description,
        frequency=body.frequency,
        deliverable=body.deliverable,
        acceptance_criteria=body.acceptance_criteria,
    )
    db.add(row)
    db.flush()
    db.add(
        ProjectServiceScopeVersion(
            project_id=project.id,
            service_scope_id=row.id,
            version=1,
            snapshot_json={
                "name": row.name,
                "category": row.category,
                "description": row.description,
                "frequency": row.frequency,
                "deliverable": row.deliverable,
                "acceptance_criteria": row.acceptance_criteria,
            },
            created_by=str(session_payload.user.id),
        )
    )
    _audit(db, session_payload, request, current_settings, action="project.initialization.scope.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _scope_out(db, row)


@router.post("/{project_uuid}/service-scopes/{scope_uuid}/confirm", response_model=ServiceScopeOut)
async def confirm_service_scope(
    project_uuid: str,
    scope_uuid: str,
    body: ConfirmIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ServiceScopeOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    row = _owned_by_project(db, ProjectServiceScope, scope_uuid, project.id, "服务范围")
    row.confirmation_status = "confirmed"
    row.confirmed_by = str(session_payload.user.id)
    row.confirmed_at = datetime.now(UTC).replace(tzinfo=None)
    _audit(db, session_payload, request, current_settings, action="project.initialization.scope.confirm", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _scope_out(db, row)


@router.post("/{project_uuid}/service-scopes/{scope_uuid}/versions", response_model=ServiceScopeVersionOut, status_code=201)
async def create_scope_version(
    project_uuid: str,
    scope_uuid: str,
    body: ScopeVersionCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ServiceScopeVersionOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    scope = _owned_by_project(db, ProjectServiceScope, scope_uuid, project.id, "服务范围")
    latest = db.scalar(
        select(ProjectServiceScopeVersion)
        .where(ProjectServiceScopeVersion.service_scope_id == scope.id)
        .order_by(ProjectServiceScopeVersion.version.desc())
    )
    version = (latest.version if latest else 0) + 1
    row = ProjectServiceScopeVersion(
        project_id=project.id,
        service_scope_id=scope.id,
        version=version,
        snapshot_json=body.snapshot_json,
        change_summary=body.change_summary,
        created_by=str(session_payload.user.id),
    )
    scope.current_version = version
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.scope.version.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return ServiceScopeVersionOut(
        version_uuid=row.uuid,
        scope_uuid=scope.uuid,
        version=row.version,
        snapshot_json=row.snapshot_json,
        change_summary=row.change_summary,
        created_by=row.created_by,
        created_at=row.created_at,
    )


@router.get("/{project_uuid}/systems", response_model=list[SystemOut])
async def list_systems(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SystemOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectBusinessSystem).where(ProjectBusinessSystem.project_id == project.id).order_by(ProjectBusinessSystem.id)).all()
    return [_system_out(row) for row in rows]


@router.post("/{project_uuid}/systems", response_model=SystemOut, status_code=201)
async def create_system(
    project_uuid: str,
    body: SystemCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> SystemOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    row = ProjectBusinessSystem(project_id=project.id, **body.model_dump())
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.system.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _system_out(row)


@router.get("/{project_uuid}/assets", response_model=list[AssetOut])
async def list_assets(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[AssetOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectAsset).where(ProjectAsset.project_id == project.id).order_by(ProjectAsset.id)).all()
    return [_asset_out(db, row) for row in rows]


@router.post("/{project_uuid}/assets", response_model=AssetOut, status_code=201)
async def create_asset(
    project_uuid: str,
    body: AssetCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    payload = body.model_dump()
    system_uuid = payload.pop("business_system_uuid")
    system_id = None
    if system_uuid:
        system_id = _owned_by_project(db, ProjectBusinessSystem, system_uuid, project.id, "业务系统").id
    row = ProjectAsset(project_id=project.id, business_system_id=system_id, **payload)
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.asset.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _asset_out(db, row)


@router.get("/{project_uuid}/target-groups", response_model=list[TargetGroupOut])
async def list_target_groups(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[TargetGroupOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectTargetGroup).where(ProjectTargetGroup.project_id == project.id).order_by(ProjectTargetGroup.id)).all()
    return [_group_out(row) for row in rows]


@router.post("/{project_uuid}/target-groups", response_model=TargetGroupOut, status_code=201)
async def create_target_group(
    project_uuid: str,
    body: TargetGroupCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TargetGroupOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    row = ProjectTargetGroup(project_id=project.id, **body.model_dump())
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.target_group.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _group_out(row)


@router.get("/{project_uuid}/service-targets", response_model=list[ServiceTargetOut])
async def list_service_targets(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ServiceTargetOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectServiceTarget).where(ProjectServiceTarget.project_id == project.id).order_by(ProjectServiceTarget.id)).all()
    return [_target_out(db, row) for row in rows]


@router.post("/{project_uuid}/service-targets", response_model=ServiceTargetOut, status_code=201)
async def create_service_target(
    project_uuid: str,
    body: ServiceTargetCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ServiceTargetOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    scope_uuid = body.scope_uuid
    group_uuid = body.target_group_uuid
    scope_id = _owned_by_project(db, ProjectServiceScope, scope_uuid, project.id, "服务范围").id if scope_uuid else None
    group_id = _owned_by_project(db, ProjectTargetGroup, group_uuid, project.id, "目标组").id if group_uuid else None
    row = ProjectServiceTarget(
        project_id=project.id,
        service_scope_id=scope_id,
        target_group_id=group_id,
        target_type=body.target_type,
        target_value=body.target_value,
    )
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.service_target.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _target_out(db, row)


@router.get("/{project_uuid}/execution-rules", response_model=list[ExecutionRuleOut])
async def list_execution_rules(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ExecutionRuleOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _require_project(db, project_uuid, session_payload)
    rows = db.scalars(select(ProjectExecutionRule).where(ProjectExecutionRule.project_id == project.id).order_by(ProjectExecutionRule.id)).all()
    return [_rule_out(db, row) for row in rows]


@router.post("/{project_uuid}/execution-rules", response_model=ExecutionRuleOut, status_code=201)
async def create_execution_rule(
    project_uuid: str,
    body: ExecutionRuleCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExecutionRuleOut:
    await _require_ai_use(request, session_payload, current_settings)
    project = _require_manager(db, project_uuid, session_payload)
    payload = body.model_dump()
    scope_uuid = payload.pop("scope_uuid")
    group_uuid = payload.pop("target_group_uuid")
    scope_id = _owned_by_project(db, ProjectServiceScope, scope_uuid, project.id, "服务范围").id if scope_uuid else None
    group_id = _owned_by_project(db, ProjectTargetGroup, group_uuid, project.id, "目标组").id if group_uuid else None
    row = ProjectExecutionRule(
        project_id=project.id,
        service_scope_id=scope_id,
        target_group_id=group_id,
        **payload,
    )
    db.add(row)
    db.flush()
    _audit(db, session_payload, request, current_settings, action="project.initialization.execution_rule.create", entity_uuid=row.uuid, project_uuid=project.uuid)
    db.commit()
    db.refresh(row)
    return _rule_out(db, row)
