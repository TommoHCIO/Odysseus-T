from routes.chat_helpers import PreprocessedMessage, add_user_message


class FakeSession:
    def __init__(self):
        self.messages = []
        self.name = ""

    def add_message(self, message):
        self.messages.append(message)


class FakeChatHandler:
    def __init__(self):
        self.named_from = None

    def update_session_name_if_needed(self, _session, message):
        self.named_from = message


def test_voice_transcript_source_is_sanitized_into_user_message_metadata():
    session = FakeSession()
    handler = FakeChatHandler()
    preprocessed = PreprocessedMessage(
        enhanced_message="hello from oracle",
        user_content="hello from oracle",
        text_for_context="hello from oracle",
        youtube_transcripts=[],
        attachment_meta=[],
    )

    add_user_message(
        session,
        handler,
        preprocessed,
        voice_transcript_source={
            "source": "voice.websocket",
            "voiceSessionId": "voice-1",
            "sessionId": "chat-1",
            "mimeType": "audio/webm",
            "submitToChat": True,
            "text": "must not be duplicated",
            "raw": {"hidden": "payload"},
        },
    )

    assert len(session.messages) == 1
    assert session.messages[0].metadata == {
        "voice_transcript_source": {
            "source": "voice.websocket",
            "voiceSessionId": "voice-1",
            "sessionId": "chat-1",
            "mimeType": "audio/webm",
            "submitToChat": True,
        },
    }
    assert handler.named_from == "hello from oracle"
