---
name: bug-investigation
description: Use when a user asks to investigate, inspect, review, diagnose, analyze, check, or verify a bug, error, failure, regression, production issue, broken behavior, screenshot/log issue, or Thai requests such as ตรวจสอบ, เช็ค, ดูสาเหตุ, หาสาเหตุ, เกิดจากอะไร, วิธีแก้, ข้อดี, ข้อเสีย
---

# Bug Investigation

## Overview

Investigate bugs and operational problems without changing code until the user confirms a fix. Separate evidence from assumptions, explain tradeoffs, and make the next action explicit.

## Hard Rule

Treat the request as investigation-only unless the user explicitly asks for code changes in the same message or has already confirmed a specific fix option.

Do not modify application code, configuration, schema, migrations, dependencies, generated artifacts, or production state during investigation-only work.

Allowed actions:
- Read files and docs.
- Inspect logs, screenshots, stack traces, terminal output, and git history.
- Run non-destructive commands.
- Reproduce behavior locally when it does not mutate important data.
- Query read-only diagnostics when credentials and permissions already exist.

Forbidden actions before confirmation:
- Edit code or config.
- Run migrations or data-changing scripts.
- Install, update, or remove dependencies.
- Commit, push, deploy, restart production services, or mutate production data.
- "Small quick fixes" made while investigating.

## Workflow

1. Classify the issue: code bug, regression, production error, data issue, auth/permission, database/pool/timeout, cache/ISR, deploy/env mismatch, third-party service, performance, or client/browser issue.
2. Gather evidence: user report, exact error text, path/request, timestamp, screenshot, logs, stack trace, recent changes, relevant files, and runtime environment.
3. Trace the flow: entrypoint -> route/component/action/API -> service/helper -> database/external service -> response/render.
4. Reproduce or reason from evidence. Mark each conclusion as confirmed, likely, or unverified.
5. Identify root cause. If not enough evidence exists, say what evidence is missing and the strongest current hypothesis.
6. Propose fix options. Prefer 1-3 options: quick containment, robust code fix, and operational/data fix when relevant.
7. For each option, explain pros, cons/risks, expected behavior changes, affected scope, and verification.
8. Recommend one option with a concrete reason.
9. Stop and wait for explicit confirmation before implementing.

## Required Response Shape

Use concise Thai when the user asks in Thai. Include these sections unless the request is tiny:

```markdown
**สถานะ**
ยังไม่แก้โค้ด / ตรวจสอบเท่านั้น

**หลักฐานที่พบ**
...

**สาเหตุ**
Confirmed:
Likely:
ยังไม่ยืนยัน:

**วิธีแก้ที่เป็นไปได้**
Option A:
Option B:

**ข้อดี**
...

**ข้อเสีย / ความเสี่ยง**
...

**พฤติกรรมที่เปลี่ยนไปหลังแก้**
...

**การทดสอบที่ต้องทำ**
...

**คำแนะนำ**
...
```

## Evidence Standards

Do not overstate certainty.

Use:
- "ยืนยันได้" only when logs, code, reproduction, or data directly prove it.
- "น่าจะ" when evidence points strongly but a confirming log/reproduction is missing.
- "ยังไม่ยืนยัน" when it is a plausible path with insufficient evidence.

If a screenshot only shows a high-level failure, say what it proves and what it does not prove.

## Common Mistakes

| Mistake | Correct behavior |
| --- | --- |
| Fixing while investigating | Stop at analysis and ask for confirmation |
| Treating 500 as a root cause | Trace the server error or stack; 500 is a symptom |
| Listing only one fix | Give options when tradeoffs exist |
| Saying "probably DB" without evidence | Tie the hypothesis to logs, code path, metrics, or known limits |
| Omitting behavior change | State what users/admins/systems will observe after the fix |
| Ending vaguely | Recommend an option and ask for explicit approval to implement |

## Confirmation Gate

Before coding, the user must clearly say something like:
- "แก้เลย"
- "ทำ option A"
- "implement"
- "ลงมือแก้"
- "ยืนยัน"

If the user asks a follow-up question, continue investigation-only.
