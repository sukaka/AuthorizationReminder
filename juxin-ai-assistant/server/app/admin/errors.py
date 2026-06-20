from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class GovernanceError(Exception):
    status_code: int
    code: str
    message: str

    def __str__(self) -> str:
        return self.message
