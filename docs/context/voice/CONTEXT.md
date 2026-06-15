# Voice Context

This context names speech and audio features in Odysseus.

## Language

**Voice Recording**:
Audio captured from the user for a chat, note, task, or other workflow.
_Avoid_: Transcription

**Transcription**:
Turning speech or audio into text.
_Avoid_: Summary

**Speech-to-Text**:
The feature or model path used to turn speech into text.
_Avoid_: Text-to-speech

**Text-to-Speech**:
The feature or model path used to speak text aloud.
_Avoid_: Speech-to-text

**Voice Note**:
A provider or user audio message meant to be listened to or transcribed.
_Avoid_: Text note

**Realtime Voice**:
The live speech layer where Odysseus can listen, speak, and show presence while normal work continues.
_Avoid_: Voice assistant, execution engine

**O.R.A.C.L.E.**:
The named Realtime Voice runtime for Odysseus. It is the live communication layer around existing Odysseus work, not a separate execution engine.
_Avoid_: Voice assistant, separate agent, new LLM backend

**Voice Session**:
The voice-specific state attached to an existing Odysseus Session while live speech is active.
_Avoid_: Separate chat, separate memory

**Soft Interrupt**:
User speech that immediately stops spoken output and returns Odysseus to listening while background work continues.
_Avoid_: Cancel, abort

**Hard Interrupt**:
A deliberate user command to stop both spoken output and the active Agent Run or Council workflow.
_Avoid_: Pause, mute

**Execution Narration**:
Concise spoken status about ongoing Odysseus work.
_Avoid_: Raw tool output, full response reading

**Voice Presence**:
Short conversational signals that make live speech feel responsive without becoming the work itself.
_Avoid_: Filler response, model answer

**Voice Orb**:
The compact always-available O.R.A.C.L.E. control that starts Realtime Voice and shows listening, speaking, working, interrupted, or cancelled presence.
_Avoid_: Voice assistant button, separate chat control
