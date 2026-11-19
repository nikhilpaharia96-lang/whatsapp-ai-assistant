# Personal helpers: COACH and draft-only chats

Owner-only commands, typed in the "Message yourself" chat (same authorisation as BOT / STATUS / SEND).

## COACH: <question>
A private dating and social coach. The answer comes only back to you; nothing is ever sent to anyone else.

    COACH: kisi ko pehla message kaise bhejun?
    COACH: mera dating profile bio likh do
    COACH: usne "hmm" bola, ab kya reply karun?

The coach is told to be practical and respectful: consent first, no manipulation or pressure, adults only, safety tips for first meetings.

## Draft-only chats
For chats you want to answer yourself (for example someone you are getting to know) the AI writes a reply and sends it to you; the other person gets nothing.

    DRAFT 919876543210        switch on for this number
    DRAFT OFF 919876543210    switch off (normal AI replies again)
    DRAFT?                    list draft-only chats

When that person messages, you receive "Draft reply" with what they said and the suggested answer. Copy, edit and send it yourself.
The flag is stored in `contacts.metadata.draft_only`; name, type, notes and history are untouched. In draft-only chats the 7-minute pause after you reply yourself does NOT apply: every message from them gets a draft. The draft is written in a special DRAFT MODE (one short casual suggestion, uses the chat history, never invents facts about you).

Tests: `PGLITE=... node tests/personal/run.mjs`.

## Voice notes and images

Incoming voice notes and images from contacts are turned into text before the normal pipeline (node `Media Prep`, right after the webhook):
the file is fetched from Evolution API (`POST /chat/getBase64FromMediaMessage/<instance>`), Gemini transcribes (voice) or describes (image),
and the message becomes `[Voice note] ...` or `[Image: ...] Caption: ...`. The AI then replies as to any text message; history shows the same text.

- Not handled (still ignored): video, stickers, documents, groups, your own media.
- Limits: voice notes up to 180 s (`MEDIA_MAX_AUDIO_SECONDS`), files up to 10 MB (`MEDIA_MAX_MB`).
- If anything fails the AI is told the media could not be processed and asks the person to type.
- Privacy: the media content is sent to Gemini for transcription/description.
- Test: `node tests/media/run.mjs`.

## Class notes (record a whole class -> PDF)

Before class: in the "Message yourself" chat start a voice note, lock the recording and leave the phone running. After class: stop and send it.
A self-chat voice note of 2 minutes or more (`CLASS_NOTES_MIN_SECONDS`) is not treated as a normal message: node `Detect Class Note` hands it to the
sub-workflow `Class Notes (voice -> PDF)` (id aH7ayLC22LHAjBMn, source `n8n-workflows/class-notes/notes.js`, SDK generator `scripts/gen_class_workflow.py`).
It sends a "notes ban rahe hain" message, fetches the audio from Evolution, gives it to Gemini (Files API above 12 MB, max `CLASS_NOTES_MAX_MB` = 60),
builds a plain A4 PDF (title, headings, bullets, quick revision) and sends it back as a WhatsApp document. If the PDF cannot be sent the notes come as text;
on any failure you get an error message. PDF is Latin text only (Hinglish/Roman script is fine; native scripts would show "?").
Test: `node tests/classnotes/run.mjs`. Ask permission before recording a class or office meeting.

### Draft copy (draft-only chats)
The owner gets two WhatsApp messages: an info message (who, what they said, "not sent") and then the draft ALONE as its own message,
so one long-press -> Copy copies exactly the draft. A real tap-to-copy button is not possible yet: Evolution API v2.3.7 has a known
bug where interactive buttons fail (evolution-api issue #2390), and WhatsApp only shows "Copy" buttons for official Business API templates.
