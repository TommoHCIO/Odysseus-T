from src import agent_loop


class FakeMcpManager:
    def __init__(self, generation, description):
        self._generation = generation
        self.description = description

    def get_all_openai_schemas(self, disabled_map=None):
        return []

    def get_tool_descriptions_for_prompt(self, disabled_map=None):
        return self.description


def test_system_prompt_cache_invalidates_when_mcp_generation_changes():
    agent_loop._cached_base_prompt = None
    agent_loop._cached_base_prompt_key = None

    first_messages, _ = agent_loop._build_system_prompt(
        messages=[{"role": "user", "content": "first"}],
        model="gpt-5",
        active_document=None,
        mcp_mgr=FakeMcpManager(1, "\n\n**Old MCP:**\n  - mcp__old__tool: old tool"),
        disabled_tools=set(),
        needs_admin=True,
        relevant_tools=None,
        compact=True,
    )
    assert "mcp__old__tool" in first_messages[0]["content"]

    second_messages, _ = agent_loop._build_system_prompt(
        messages=[{"role": "user", "content": "second"}],
        model="gpt-5",
        active_document=None,
        mcp_mgr=FakeMcpManager(2, "\n\n**Host Access Bridge:**\n  - mcp__host_access__host_health: health"),
        disabled_tools=set(),
        needs_admin=True,
        relevant_tools=None,
        compact=True,
    )

    assert "mcp__host_access__host_health" in second_messages[0]["content"]
    assert "mcp__old__tool" not in second_messages[0]["content"]


def test_mcp_tool_filter_keeps_host_access_tools_for_manage_mcp_query():
    schemas = [
        {
            "type": "function",
            "function": {
                "name": "mcp__host_access__host_health",
                "description": "Host health check",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mcp__other__tool",
                "description": "Other tool",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]
    relevant_tools = {"manage_mcp"}

    filtered = agent_loop._filter_mcp_schemas_for_relevant_tools(
        schemas,
        relevant_tools,
        "verify host_access and list host bridge tools",
    )

    assert [s["function"]["name"] for s in filtered] == ["mcp__host_access__host_health"]
