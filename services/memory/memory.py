"""Compatibility re-export for the canonical Obsidian-backed memory manager."""

from src.memory import MemoryManager, get_text_similarity, tokenize

__all__ = ["MemoryManager", "get_text_similarity", "tokenize"]
