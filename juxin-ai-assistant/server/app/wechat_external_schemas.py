from pydantic import BaseModel, ConfigDict, Field


class ExternalQuestionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)


class ExternalSourceOut(BaseModel):
    file_uuid: str
    file_name: str
    section_title: str = ""
    page_number: int | None = None


class ExternalDocumentOut(BaseModel):
    file_uuid: str
    file_name: str
    summary: str = ""
    file_type: str
    file_size: int
    updated_at: str
