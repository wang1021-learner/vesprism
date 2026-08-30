# Agent harness routing (Superpowers + gstack + ECC)

This repo vendors three project plugins under `.grok/plugins/`. Do not install
the upstream full distributions on top of them.

## Who owns what

| Layer | Plugin | When to use |
|---|---|---|
| Process backbone | **superpowers** | Designing, implementing, debugging, TDD, and finishing a branch. Auto-invokes. |
| Product / ship / visual | **gstack** | Product framing, plan reviews, staff review, CSO, ship, docs, and visual design. Slash only. |
| Security / Rust extras | **ecc** | Security scan/review, Rust patterns, quality gates, language specialist agents. Slash only. |

Do not run all three on the same task. Pick one primary layer, then optionally
one specialist.

## Superpowers (auto)

Follow Superpowers for engineering work in this codebase:

1. `brainstorming` before new features (design sign-off before code).
2. `using-git-worktrees` after design approval when isolation is needed.
3. `writing-plans` then `subagent-driven-development` or `executing-plans`.
4. `test-driven-development` during implementation (RED-GREEN-REFACTOR).
5. `systematic-debugging` for bugs; no fix without root cause.
6. `verification-before-completion` before claiming done.
7. `requesting-code-review` / `finishing-a-development-branch` at the end.

Prefer Superpowers over ECC `tdd-workflow` and over gstack `office-hours` for
in-repo engineering features.

## gstack (slash only)

Invoke explicitly, for example `/gstack:office-hours`, `/gstack:plan-eng-review`,
`/gstack:review`, `/gstack:cso`, `/gstack:ship`, `/gstack:design-consultation`,
`/gstack:design-shotgun`, `/gstack:design-html`.

Visual design in this repo is **only** those three gstack skills (plus
`/gstack:plan-design-review` for plan-stage scoring). Do not use
`ui-design`, `frontend-design`, `frontend-design-review`, `ui-ux-pro-max`,
`ux-design`, `pixel-perfect-design`, `shadcn-ui`, `tailwind-design-system`,
`accessibility`, or `react-best-practices-cn` even if they still appear from
`~/.claude/skills` on a machine that has Claude Code skills installed. The
repo-local `.agents/skills/` design suite was removed.

gstack skill files mention `~/.claude/skills/gstack/...`. Those paths are not
installed. Map them to this repo:

- `~/.claude/skills/gstack/<skill>/...` → `.grok/plugins/gstack/skills/<skill>/...`
- `~/.claude/skills/gstack/ETHOS.md` → `.grok/plugins/gstack/ETHOS.md`
- `~/.claude/skills/gstack/bin/...` is **not vendored**. If a preamble script is
  missing, continue in degraded mode (the skill text says this is OK). Do not
  tell the user to run `./setup` unless they ask to install the full gstack
  browser toolchain.

Browser/QA (`/browse`, `/qa`) binaries and the gstack `design` CLI are not
vendored. Design skills still run: if `$D` / `$B` are missing, use the HTML
wireframe / WebSearch fallbacks in the skill text. Do not install bun or
Chromium as a side effect.

## ECC (slash only)

Invoke explicitly, for example `/ecc:security-scan`, `/ecc:rust-review`,
`/ecc:quality-gate`. Dispatch ECC agents as `ecc:<agent>` (e.g. `ecc:rust-reviewer`).

ECC is a curated subset, not the 286-skill upstream pack. If a skill or agent
is not under `.grok/plugins/ecc/`, it is not installed.

## Collisions

Bare slash names may collide. Use the plugin-qualified form:

- Superpowers: `/superpowers:brainstorming`, `/superpowers:test-driven-development`
- gstack: `/gstack:review`, `/gstack:ship`, `/gstack:design-shotgun`
- ECC: `/ecc:plan`, `/ecc:code-review`, `/ecc:rust-review`

## Trust

Project plugins live in `.grok/plugins/` and need folder trust before hooks
run. Superpowers SessionStart injects `using-superpowers`. Grant trust with
`/hooks-trust` or launch with `--trust` once per machine.
