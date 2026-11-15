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
The flag is stored in `contacts.metadata.draft_only`; name, type, notes and history are untouched. If you reply yourself the AI stays quiet for 7 minutes as usual.

Tests: `PGLITE=... node tests/personal/run.mjs`.
