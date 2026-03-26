---
name: start-ready-task
agent: agent
description: Start working on a ready ticket.
---

Using bd ready list the ready tickets.

Start working on the highest priority ticket. 

If you encounter a ticket that is not safely/meaningfully implementable (obsolete, already satisfied, duplicate, wrong direction, contradicts current architecture, or requires unit/implementation tests), you MUST route it to PM:
1. Block the original issue: `bd update <ID> --status blocked`
2. Create a PM follow-up task labeled: `bd create "PM Investigate: <short title> (re: <ID>)" -t task -p 2 --label pm_investigate`
3. Add a "### PM Investigation Needed" section in the original bd notes with evidence + recommendation.
4. Stop working on the issue.

When you are done, follow the landing the plane checklist to complete your session.
