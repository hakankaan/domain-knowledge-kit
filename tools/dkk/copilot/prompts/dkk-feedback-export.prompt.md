---
mode: agent
description: Produce a paste-ready report of recorded dkk feedback for the maintainers.
---

Turn the recorded dkk feedback into a report the user can hand to the maintainers.

1. Run `dkk feedback list` first. If nothing is recorded, say so and stop — do not invent entries.

2. Export. By default only unshared entries are included; pass `--all` if the user asked to re-export everything:

```bash
dkk feedback export
```

The Markdown report goes to **stdout**; the hints go to stderr. Only the stdout block is the artifact.

3. **Present the full Markdown block to the user verbatim, in a fenced code block**, so they can copy it. Do not summarise or rewrite it — the maintainers need the environment and pack lines, and reformatting loses them.

4. Point them at where it goes:
   - Paste it into a new issue: https://github.com/hakankaan/domain-knowledge-kit/issues/new
   - Or, if they have the GitHub CLI, offer the one-liner that `export` printed on stderr (`gh issue create … --body-file -`). Ask before running it — that publishes to a public tracker.

5. Ask whether to mark the entries as shared so the next export skips them. Only if they say yes:

```bash
dkk feedback export --mark-shared
```

Before presenting, scan the report for anything the user would not want public — tokens, internal hostnames, absolute paths carrying employer or user names, business identifiers. Flag anything you spot and offer `dkk feedback rm <id>` to drop that entry, or tell them which line to edit in `.dkk/feedback.yml`.
