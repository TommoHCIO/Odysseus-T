# Contacts Context

This context names people, organizations, and the outside identities that may belong to them.

## Language

**Contact**:
A user-owned person or organization record.
_Avoid_: Provider identity, communication account

**Provider Identity**:
An identity from an outside provider, such as an email address, phone number, WhatsApp JID, LID JID, or CardDAV UID.
_Avoid_: Contact

**Display Name**:
The friendly name Odysseus shows for a person, group, or provider identity. Raw IDs should only be fallback details.
_Avoid_: Provider identity

**Address**:
A way to reach a contact, such as an email address or phone number.
_Avoid_: Provider identity when the provider's own ID matters

**Contact Source**:
Where contact data came from, such as local entry, CardDAV, Email, or WhatsApp.
_Avoid_: Contact

**Contact Link**:
A link between a Contact and a Provider Identity. Automatic links are allowed only for exact matches or provider-trusted matches that belong to the same owner.
_Avoid_: Merge

**Contact Merge**:
A user-confirmed action that combines contacts. Merges must not happen silently.
_Avoid_: Automatic link, silent merge

**Contact Picker**:
The UI for choosing a Contact or Provider Identity.
_Avoid_: New chat, address field
