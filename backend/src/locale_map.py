"""Who the class is for, by default.

The teacher follows whatever language the student picks or speaks; this only
sets the starting language and the dialect guide it teaches Telugu in.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LocaleProfile:
    name: str = ""
    language: str = "te"  # ISO 639-1
    dialect_register: str = "telangana"  # -> registers/<language>_<register>.md

    @property
    def register_pack(self) -> str:
        return f"{self.language}_{self.dialect_register}"


DEFAULT_PROFILE = LocaleProfile()
