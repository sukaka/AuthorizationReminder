from pydantic import BaseModel, ConfigDict, Field


class UserPayload(BaseModel):
    id: int | str
    username: str
    role: str


class AuthScope(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    department: str | None = None
    managed_departments: list[str] = Field(default_factory=list, alias="managedDepartments")


class SessionPayload(BaseModel):
    user: UserPayload
    scope: AuthScope
    apps: list[str]
