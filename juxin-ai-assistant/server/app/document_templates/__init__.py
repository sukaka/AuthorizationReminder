def get_document_template(template_code: str | None):
    from .registry import get_document_template as _get_document_template

    return _get_document_template(template_code)

__all__ = ["get_document_template"]
