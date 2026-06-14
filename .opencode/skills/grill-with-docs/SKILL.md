---
name: grill-with-docs
description: Grilling session: challenge plan vs domain model, sharpen terminology, update CONTEXT.md/ADRs inline as decisions crystallise. Use to stress-test plan vs project language and documented decisions.
argument-hint: "What topic or plan should be grilled?"
---

Interview relentlessly on every plan aspect until shared understanding. Walk design tree branch by branch; resolve decision dependencies one-by-one. Each question: include recommended answer.

One question at time; wait for feedback before next.

If answerable by exploring codebase → explore instead of asking.

## Domain awareness

During exploration, also find existing docs:

### File structure

Most repos — single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

`CONTEXT-MAP.md` at root → multiple contexts:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/     — system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/  — context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when something to write. No `CONTEXT.md` → create on first resolved term. No `docs/adr/` → create on first ADR.

## During the session

### Challenge against the glossary

Term conflicts `CONTEXT.md` → call out immediately. "Glossary defines 'cancellation' as X; you seem to mean Y — which?"

### Sharpen fuzzy language

Vague/overloaded terms → propose precise canonical. "'Account' — Customer or User? Different things."

### Discuss concrete scenarios

Domain relationships → stress-test with specific scenarios. Invent edge cases; force precise boundaries.

### Cross-reference with code

User states behavior → check code. Contradiction → surface: "Code cancels entire Orders; you said partial cancellation possible — which?"

### Update CONTEXT.md inline

Term resolved → update `CONTEXT.md` immediately. Don't batch.

### Update ADRs inline

Decision made → draft ADR in `docs/adr/`. Format:

```md
# {Short title}

{1-3 sentences: what's the context, what did we decide, and why.}
```

Single paragraph OK. Value = record *that* decision made + *why* — not filling sections.

### When to offer an ADR

All three true:

1. **Hard to reverse** — changing mind later costs meaningful effort
2. **Surprising without context** — future reader wonders "why this way?"
3. **Real trade-off** — genuine alternatives, picked one for specific reasons

Easy to reverse → skip. Not surprising → nobody wonders. No real alternative → obvious thing, nothing to record.

### What qualifies

- **Architectural shape.** Monorepo. Event-sourced write model, Postgres read projection.
- **Integration patterns between contexts.** Ordering ↔ Billing via domain events, not sync HTTP.
- **Technology with lock-in.** DB, bus, auth, deploy target — not every library; ones that take quarter to swap.
- **Boundary and scope.** Customer context owns customer data; others reference by ID. Explicit no-s as valuable as yes-s.
- **Deliberate non-obvious path.** Manual SQL not ORM because X. Stops next engineer "fixing" deliberate choice.
- **Constraints not in code.** No AWS (compliance). <200ms (partner API contract).
- **Rejected alternatives when rejection non-obvious.** GraphQL considered, REST for subtle reasons — else GraphQL resuggested in six months.

## After the session

If new terms or decisions emerged, update `CONTEXT.md` / `docs/adr/` before closing.