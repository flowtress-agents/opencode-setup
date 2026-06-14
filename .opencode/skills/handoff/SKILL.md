---
name: handoff
description: Compact current conversation into handoff document for another agent to pick up.
argument-hint: "What will next session be used for?"
---

Write handoff document summarising current conversation so fresh agent can continue work. Save to temporary directory of user's OS - not current workspace.

Include "suggested skills" section in document, which suggests skills that agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If user passed arguments, treat them as description of what next session will focus on and tailor doc accordingly.