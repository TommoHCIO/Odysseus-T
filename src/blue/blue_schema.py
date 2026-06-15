"""Schemas for the B.L.U.E. learning workflow."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


BlueCommand = Literal["learn", "path", "map", "methods", "verify", "absorb", "debate", "build"]


class BlueRequest(BaseModel):
    command: BlueCommand = "learn"
    topic: str = Field(..., min_length=1, max_length=1000)


class BlueMethod(BaseModel):
    name: str
    best_for: str = ""
    tradeoffs: List[str] = Field(default_factory=list)


class BlueVerification(BaseModel):
    status: Literal["unverified", "partially_verified", "verified"] = "unverified"
    checks: List[str] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)


class BlueArtifact(BaseModel):
    skill_tree: List[str] = Field(default_factory=list)
    learning_levels: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    methods: List[BlueMethod] = Field(default_factory=list)
    verification: BlueVerification = Field(default_factory=BlueVerification)
    council_verdict: Optional[str] = None
