from urllib.parse import urlencode

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from .config import Settings


class DesktopBootstrap(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    product: str
    protocol_version: int = Field(alias="protocolVersion")
    auth_portal_url: HttpUrl = Field(alias="authPortalUrl")
    workspace_url: HttpUrl = Field(alias="workspaceUrl")


def build_desktop_bootstrap(settings: Settings) -> DesktopBootstrap:
    query = urlencode({"system": settings.auth_system_key})
    return DesktopBootstrap(
        product="juxin-ai-assistant",
        protocol_version=1,
        auth_portal_url=f"{settings.auth_public_url}/portal?{query}",
        workspace_url=settings.public_url,
    )
