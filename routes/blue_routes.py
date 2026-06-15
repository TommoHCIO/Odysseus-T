"""Routes for B.L.U.E. learning workflow composition."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth_helpers import get_current_user
from src.blue.blue_engine import compose_blue_request


class BlueComposeRequest(BaseModel):
    input: str = Field("", max_length=1200)


def setup_blue_routes() -> APIRouter:
    router = APIRouter(prefix="/api/blue", tags=["blue"])

    @router.post("/compose")
    async def compose_blue(request: Request, body: BlueComposeRequest):
        owner = get_current_user(request)
        try:
            result = compose_blue_request(body.input, owner=owner)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        result["owner"] = owner
        return result

    return router
