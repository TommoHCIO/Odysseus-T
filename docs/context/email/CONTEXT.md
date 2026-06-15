# Email Context

This context names Email-specific ideas in Odysseus.

## Language

**Email Integration**:
The user's configured Email connection in Odysseus.
_Avoid_: Email connector, user account

**Mailbox**:
The email store that Odysseus can access through an Email Integration.
_Avoid_: Folder, communication account

**Email Folder**:
A mailbox section such as Inbox, Sent, Archive, Trash, Junk, or Drafts.
_Avoid_: Library, label unless the provider calls it a label

**IMAP**:
The email protocol Odysseus uses to read, list, move, mark, and save email.
_Avoid_: SMTP

**SMTP**:
The email protocol Odysseus uses to send email.
_Avoid_: IMAP

**Email UID**:
The provider ID used to find an email inside one folder and one communication account. It is not globally unique by itself.
_Avoid_: Message ID, global ID, provider message

**Email Provider Locator**:
The communication account, email folder, and Email UID needed to find an email again.
_Avoid_: Email UID by itself

**Email Message ID**:
The email header ID used for replies, threading, and matching email across folders.
_Avoid_: Email UID

**Email Thread**:
A chain of related email messages.
_Avoid_: WhatsApp conversation

**Email Triage**:
AI or rule help for email urgency, reminders, tags, spam, summaries, or draft replies.
_Avoid_: Search, sync

**Answered Flag**:
The provider-side email state that says a message has been answered.
_Avoid_: Sent message

**Sent Copy**:
A copy of a sent email saved into a provider's Sent folder.
_Avoid_: Delivery receipt
