---
mode: agent
description: Review a change summary to identify impacted domain items, invariants, and ADRs.
---

# Domain Change Review

You are a domain-aware code reviewer. Given a summary of changes (code diff, PR description, or plain-language intent), identify all impacted domain items, invariant violations, and affected Architecture Decision Records.

## Steps

1. **Understand the change** — Read the change summary carefully. Identify:
   - Which bounded contexts are affected.
   - Which domain concepts (events, commands, aggregates, policies, read models) are mentioned or implied.
   - Whether new items are being introduced or existing ones modified.

2. **Search for impacted items** — For each concept mentioned in the change:
   ```bash
   npx tsx src/cli.ts search "<concept>"
   ```

3. **Inspect impacted items** — For each matched item, show its current definition:
   ```bash
   npx tsx src/cli.ts show <id>
   ```

4. **Trace the blast radius** — Use graph traversal to find items that depend on the changed items:
   ```bash
   npx tsx src/cli.ts related <id> --depth 2
   ```

5. **Check invariants** — Run the validator to detect cross-reference violations:
   ```bash
   npx tsx src/cli.ts validate
   ```
   Pay attention to:
   - Broken `adr_refs` (referencing non-existent ADRs).
   - Broken `domain_refs` in ADR frontmatter (referencing non-existent items).
   - Dangling cross-references (`handles`, `emits`, `triggers`, `subscribes_to`, `used_by`, `raised_by`, `handled_by`, `actor`).
   - Missing context registrations in `domain/index.yml`.

6. **Find linked ADRs** — Identify ADRs that may need updating:
   ```bash
   npx tsx src/cli.ts adr related <id>
   ```

7. **Compile the review** — Present a structured impact analysis.

## Output Format

```markdown
## Change Impact Analysis

### Summary
Brief description of what the change does.

### Impacted Domain Items

| ID | Type | Impact | Notes |
|----|------|--------|-------|
| ordering.OrderPlaced | event | modified | New field `couponCode` added |
| ordering.Order | aggregate | affected | Emits modified event |

### Blast Radius
Items indirectly affected through relationships:
- `ordering.SendConfirmationEmail` (policy) — triggers on `OrderPlaced`
- `ordering.OrderSummary` (read_model) — subscribes to `OrderPlaced`

### Invariant Checks
- ✅ All `adr_refs` resolve to existing ADRs
- ⚠️ `ordering.ApplyCoupon` command references `handled_by: CouponAggregate` which does not exist
- ✅ All context registrations present in index.yml

### Affected ADRs
| ADR | Title | Status | Action Needed |
|-----|-------|--------|---------------|
| adr-0002 | Coupon handling strategy | accepted | May need update to reflect new field |

### Recommendations
- Add `CouponAggregate` to the ordering context or update `handled_by` reference.
- Update adr-0002 to document the coupon code flow through OrderPlaced.
- Run `npx tsx src/cli.ts render` to regenerate docs.
```

## Guidelines

- Always validate the model after reviewing changes — do not assume the YAML is consistent.
- Trace relationships at least 2 levels deep to catch indirect impacts.
- Flag any ADR whose `domain_refs` include a changed item.
- If the change introduces new domain items, verify they follow naming conventions (PascalCase for items, kebab-case for contexts).
