from email.message import EmailMessage

import mcp_servers.email_server as email_server


class _FakeImap:
    def __init__(self, raw_message):
        self.raw_message = raw_message
        self.selected = None
        self.logged_out = False

    def select(self, folder, readonly=False):
        self.selected = (folder, readonly)
        return "OK", []

    def uid(self, command, uid, query):
        assert command == "FETCH"
        return "OK", [(b"1 (UID 42 RFC822 {1}", self.raw_message)]

    def logout(self):
        self.logged_out = True


def _raw_message():
    msg = EmailMessage()
    msg["From"] = "Clinic <clinic@example.com>"
    msg["To"] = "Tommaso <me@example.com>, Mario Rossi <mario@example.com>"
    msg["Cc"] = "Alessandra Bianchi <ale@example.com>, Other Person <other@example.com>"
    msg["Subject"] = "Prescription"
    msg["Message-ID"] = "<clinic-message@example.com>"
    msg["References"] = "<earlier@example.com>"
    msg.set_content("The antibiotic course is ten days.")
    return msg.as_bytes()


def test_read_email_exposes_to_and_cc_headers(monkeypatch):
    monkeypatch.setattr(
        email_server,
        "_load_config",
        lambda account=None: {
            "account_name": "Fastmail",
            "imap_user": "me@example.com",
            "from_address": "me@example.com",
            "account_id": "acc-1",
        },
    )
    monkeypatch.setattr(email_server, "_imap_connect", lambda account=None: _FakeImap(_raw_message()))

    result = email_server._read_email(uid="42", folder="INBOX", account="Fastmail")

    assert result["to"] == "Tommaso <me@example.com>, Mario Rossi <mario@example.com>"
    assert result["cc"] == "Alessandra Bianchi <ale@example.com>, Other Person <other@example.com>"


def test_reply_all_excludes_self_and_named_recipients(monkeypatch):
    sent = {}

    monkeypatch.setattr(
        email_server,
        "_load_config",
        lambda account=None: {
            "imap_user": "me@example.com",
            "smtp_user": "me@example.com",
            "from_address": "me@example.com",
        },
    )
    monkeypatch.setattr(email_server, "_imap_connect", lambda account=None: _FakeImap(_raw_message()))

    def fake_send_email(**kwargs):
        sent.update(kwargs)
        return {"sent": True, "to": [kwargs["to"]], "subject": kwargs["subject"]}

    monkeypatch.setattr(email_server, "_send_email", fake_send_email)

    email_server._reply_to_email(
        uid="42",
        body="Please send a refill.",
        folder="INBOX",
        reply_all=True,
        account="Fastmail",
        exclude_recipients=["Alessandra", "mario@example.com"],
    )

    assert sent["to"] == "clinic@example.com"
    assert sent["cc"] == "Other Person <other@example.com>"
    assert sent["in_reply_to"] == "<clinic-message@example.com>"
    assert sent["references"] == "<earlier@example.com> <clinic-message@example.com>"
