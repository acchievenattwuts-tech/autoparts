# Autoparts

Next.js 16 storefront and admin system for the autoparts project.

## Repo Rules

- Read [`.rules`](/D:/autoparts/.rules) before making changes.
- Read [`PLAN.md`](/D:/autoparts/PLAN.md) before adding features or changing roadmap scope.
- This repo also contains project-local Codex skills under [`.codex/skills`](/D:/autoparts/.codex/skills).

## Getting Started

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Build-check the app:

```bash
npm run build
```

## Codex Skills

This repo ships with local Codex skills so the team can keep project-specific agent behavior in version control.

Current skills:
- `seo-aio`: SEO, AEO, AIO, structured data, content, and Core Web Vitals workflow for this storefront

### Install a Repo Skill into Codex

Install `seo-aio` into your local Codex skill directory:

```bash
npm run codex:skill:install:seo-aio
```

Install every repo-local skill:

```bash
npm run codex:skill:install:all
```

Custom usage:

```bash
npm run codex:skill:install -- seo-aio --force
```

Notes:
- The installer copies skills from [`.codex/skills`](/D:/autoparts/.codex/skills) into `$CODEX_HOME/skills`
- If `CODEX_HOME` is not set, it falls back to `~/.codex/skills`
- Use `--force` only when you want to overwrite an existing installed copy
- Restart Codex after installing or updating a skill

### Use `seo-aio`

After installation, invoke it in prompts like:

```text
Use $seo-aio to audit the current Phase 7 SEO gaps in this repo.
Use $seo-aio to improve category-page discoverability without breaking canonical rules.
Use $seo-aio to expand AI-citable knowledge content based on the existing roadmap.
```

Repo source for this skill:
- [`.codex/skills/seo-aio/SKILL.md`](/D:/autoparts/.codex/skills/seo-aio/SKILL.md)
- [`.codex/skills/seo-aio/references/phase-7-roadmap.md`](/D:/autoparts/.codex/skills/seo-aio/references/phase-7-roadmap.md)
- [`.codex/skills/seo-aio/references/implementation-guidelines.md`](/D:/autoparts/.codex/skills/seo-aio/references/implementation-guidelines.md)
