"""Preferred Obsidian-backed knowledge API aliases.

The legacy /api/memory routes remain for compatibility. These routes expose
the same durable store with vocabulary that matches the Obsidian cockpit.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Form, HTTPException, Request

from src.auth_helpers import get_current_user, require_privilege
from src.request_models import MemoryAddRequest


def setup_knowledge_routes(memory_manager, memory_vector=None) -> APIRouter:
    router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

    def _owner(request: Request) -> Optional[str]:
        return get_current_user(request)

    @router.get("")
    def get_knowledge(request: Request):
        user = _owner(request)
        return {"knowledge": memory_manager.load(owner=user)}

    @router.post("/add", response_model=Dict[str, Any])
    async def add_knowledge(request: Request, knowledge_data: Optional[MemoryAddRequest] = None):
        require_privilege(request, "can_manage_memory")
        if knowledge_data is None:
            form = await request.form()
            knowledge_data = MemoryAddRequest(
                text=form.get("text"),
                category=form.get("category", "fact"),
                source=form.get("source", "user"),
                session_id=form.get("session_id"),
            )
        user = _owner(request)
        text = (knowledge_data.text or "").strip()
        if not text:
            raise HTTPException(400, "empty knowledge")
        existing = memory_manager.load(owner=user)
        if memory_manager.find_duplicates(text, existing):
            return {"ok": True, "count": len(existing), "message": "Knowledge already exists"}
        entry = memory_manager.add_entry(text, knowledge_data.source, knowledge_data.category, owner=user)
        if knowledge_data.session_id:
            entry["session_id"] = knowledge_data.session_id
        all_entries = memory_manager.load_all()
        all_entries.append(entry)
        memory_manager.save(all_entries)
        if memory_vector and getattr(memory_vector, "healthy", False):
            memory_vector.add(entry["id"], text)
        return {"ok": True, "knowledge": entry, "count": len(memory_manager.load(owner=user))}

    @router.post("/search")
    def search_knowledge(request: Request, query: str = Form(...), category: str = Form(None)):
        user = _owner(request)
        entries = memory_manager.load(owner=user)
        if category:
            entries = [m for m in entries if category in m.get("categories", [m.get("category", "")])]
        relevant = memory_manager.get_relevant_memories(query, entries, threshold=0.05, max_items=20)
        return {"knowledge": relevant, "total": len(relevant), "query": query}

    @router.put("/{knowledge_id}")
    def update_knowledge(request: Request, knowledge_id: str, text: str = Form(...), category: str = Form(None)):
        user = _owner(request)
        all_entries = memory_manager.load_all()
        for entry in all_entries:
            if entry.get("id") == knowledge_id:
                if user is not None and entry.get("owner") != user:
                    raise HTTPException(404, "Knowledge not found")
                entry["text"] = text.strip()
                if category:
                    entry["category"] = category
                entry["timestamp"] = int(__import__("time").time())
                memory_manager.save(all_entries)
                if memory_vector and getattr(memory_vector, "healthy", False):
                    memory_vector.remove(knowledge_id)
                    memory_vector.add(knowledge_id, text.strip())
                return {"ok": True, "message": "Knowledge updated successfully"}
        raise HTTPException(404, "Knowledge not found")

    @router.delete("/{knowledge_id}")
    def delete_knowledge(request: Request, knowledge_id: str):
        user = _owner(request)
        all_entries = memory_manager.load_all()
        target = next((m for m in all_entries if m.get("id") == knowledge_id), None)
        if not target or (user is not None and target.get("owner") != user):
            raise HTTPException(404, "Knowledge not found")
        memory_manager.save([m for m in all_entries if m.get("id") != knowledge_id])
        if memory_vector and getattr(memory_vector, "healthy", False):
            memory_vector.remove(knowledge_id)
        return {"ok": True, "message": "Knowledge archived successfully"}

    return router
