# Agents Context

This context names the AI helpers in Odysseus and the things they can use.

## Language

**Agent**:
An AI helper that can use tools to work on a task, not just reply in chat.
_Avoid_: Bot, automation script

**Assistant**:
An AI helper inside Odysseus. Assistant is not the name of the whole app.
_Avoid_: Odysseus, workspace

**Capability**:
Permission for an AI helper or tool to do one specific kind of action.
_Avoid_: Privilege, role

**Skill**:
Instructions that teach an AI helper how to do a kind of work. A skill can explain when to use tools, but it is not a tool.
_Avoid_: Tool, prompt snippet, macro

**Tool**:
Something executable that an AI helper can call, such as code, an API, or an MCP server.
_Avoid_: Skill, instruction

**Tool Call**:
One use of a tool by an AI helper.
_Avoid_: Skill, message

**Tool Result**:
The output returned by a tool call.
_Avoid_: Final answer

**Agent Run**:
One attempt by an agent to complete a task.
_Avoid_: Chat session

**Prompt Injection**:
Untrusted text that tries to trick an AI helper into ignoring the user's rules or Odysseus safety rules.
_Avoid_: User instruction

**Council**:
A workflow where several AI helpers work together, debate, and review a result.
_Avoid_: Single-agent write-up, chat mode
