---
description: Review the current change for DKK domain impact. Delegates to the dkk-domain-reviewer subagent in an isolated context.
argument-hint: [pr-number | git-range]
---

Invoke the `dkk-domain-reviewer` subagent. Pass through `$ARGUMENTS` as the input scope:

- If `$ARGUMENTS` is empty, instruct the subagent to review the working-tree diff (`git status` + `git diff`).
- If `$ARGUMENTS` looks like a number or `#NNN`, instruct it to run `gh pr diff <number>` and review that PR.
- Otherwise, treat `$ARGUMENTS` as a git range (e.g. `origin/main...HEAD`) and pass it through.

Wait for the subagent's report. Display it verbatim to the user. Do not perform the review yourself.
