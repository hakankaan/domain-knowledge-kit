---
mode: agent
description: Record friction with dkk itself so it reaches the maintainers.
---

Record a note about **dkk itself** — not about this project's domain model.

Use the rough edge the user just described, or the one you and the user hit in this session. If there isn't one, ask what to record and stop.

1. **Draft the entry** from what you actually observed — do not invent detail you did not see.
   - `summary` — one line, specific. "`dkk rename` leaves ADR domain_refs stale", not "rename is broken".
   - `--kind` — `bug` (it misbehaved), `friction` (it worked but was painful), `idea` (missing capability), or `docs` (a real gap with no code change needed).
   - `--detail` — what you ran, what you expected, what happened. Paste the actual error output; that is the single most useful thing a maintainer receives.
   - `--command` — the exact `dkk` invocation that provoked it, if there was one.

2. **Show the user the draft and get confirmation before running anything.** This writes a file that lands in their repo and may end up in a public issue. Never file feedback unprompted.

3. **Check the draft for anything they would not want public** — tokens, internal hostnames, absolute paths with employer or user names, business-specific identifiers pasted from a stack trace. Redact them from `--detail` before recording, and say what you redacted.

4. Record it:

```bash
dkk feedback add "<summary>" --kind <kind> \
  --detail "<what happened>" \
  --command "<the dkk invocation>"
```

5. Confirm the assigned `fb-NNNN` id and tell the user the entry is local — nothing is transmitted. `.dkk/feedback.yml` is committed with their next change; the `dkk-feedback-export` prompt produces the report to share.

**Do not** record domain-model observations here — those belong in the model or an ADR. This file is only for dkk-the-tool.
