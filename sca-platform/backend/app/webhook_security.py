import hashlib
import hmac

from fastapi import HTTPException, Request

from .config import Settings


def _platform_secret(platform: str, settings: Settings) -> str:
    configured = {
        "github": settings.github_webhook_secret,
        "gitlab": settings.gitlab_webhook_secret,
        "jenkins": settings.jenkins_webhook_secret,
    }.get(platform, "")
    return configured or settings.sca_webhook_secret


async def verify_webhook_request(request: Request, platform: str, settings: Settings) -> None:
    secret = _platform_secret(platform, settings)
    if not secret:
        return

    if platform == "github":
        provided = request.headers.get("x-hub-signature-256", "")
        expected = "sha256=" + hmac.new(secret.encode(), await request.body(), hashlib.sha256).hexdigest()
    elif platform == "gitlab":
        provided = request.headers.get("x-gitlab-token", "")
        expected = secret
    else:
        provided = request.headers.get("x-sca-webhook-token", "")
        if not provided:
            provided = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        expected = secret

    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Webhook 签名或共享密钥校验失败")
