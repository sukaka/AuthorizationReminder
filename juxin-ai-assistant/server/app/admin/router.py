from fastapi import APIRouter

from .desktop_update_routes import create_desktop_update_admin_router
from .external_support_ticket_routes import create_external_support_ticket_router
from .assistant_mode_routes import create_assistant_mode_router
from .governance_routes import create_governance_write_router
from .faq_routes import create_faq_admin_router
from .hot_question_routes import create_hot_question_router
from .knowledge_routes import create_knowledge_router
from .reporting_routes import create_reporting_router
from .route_common import CipherDependency, PromptDependency
from .task_routes import create_task_router


def create_governance_router(
    prompt_dependency: PromptDependency,
    cipher_dependency: CipherDependency,
) -> APIRouter:
    router = APIRouter(prefix="/api/ai")
    router.include_router(create_task_router(prompt_dependency))
    router.include_router(create_knowledge_router(cipher_dependency))
    router.include_router(create_governance_write_router(cipher_dependency))
    router.include_router(create_hot_question_router(cipher_dependency))
    router.include_router(create_external_support_ticket_router(cipher_dependency))
    router.include_router(create_faq_admin_router(cipher_dependency))
    router.include_router(create_reporting_router())
    router.include_router(create_desktop_update_admin_router())
    router.include_router(create_assistant_mode_router())
    return router
