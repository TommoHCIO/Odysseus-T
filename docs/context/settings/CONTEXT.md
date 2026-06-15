# Settings Context

This context names app choices that users configure.

## Language

**Settings**:
The Odysseus place for changing app behavior, providers, models, features, and user preferences.
_Avoid_: Admin panel

**Preference**:
A user-level choice that changes how Odysseus behaves for that user.
_Avoid_: Secret, privilege

**Preset**:
A saved bundle of settings that can be reused.
_Avoid_: Skill, model

**Model Preset**:
A saved bundle of model settings, such as model name, temperature, token limits, or system prompt.
_Avoid_: Served model

**Serve Preset**:
A saved Cookbook setup for starting a model server again later.
_Avoid_: Model preset

**Theme**:
A saved visual style for the Odysseus interface.
_Avoid_: Preset

**Setup Flow**:
A guided flow that helps a user configure a feature for first use.
_Avoid_: Health check
