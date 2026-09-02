# Project plugins

Vendored into this repository so every clone of grok-build gets the same
agent harness. Enabled by `.grok/config.toml`.

| Plugin | Upstream | Pin | What we took |
|---|---|---|---|
| `superpowers` | [obra/superpowers](https://github.com/obra/superpowers) `v6.3.0` | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | All 14 skills + SessionStart hook |
| `gstack` | [garrytan/gstack](https://github.com/garrytan/gstack) `v1.75.0` | `07b59e396c6be5a86619a43151cb9ed62a15ae69` | 17 skills: methodology + design-consultation / design-shotgun / design-html (no browser/QA binaries) |
| `ecc` | [affaan-m/ECC](https://github.com/affaan-m/ECC) `v2.2.0` | `d8e6a51755c6971a65eef73419076d449df0f490` | 12 skills, 11 agents, 10 commands (not the full pack) |

All three are MIT-licensed. Each plugin directory keeps `LICENSE` and `UPSTREAM.txt`.

## Why not the full upstream trees

- Superpowers is small; we vendor it whole.
- gstack here is product/plan/review/ship plus mockup loops
  (`design-consultation`, `design-shotgun`, `design-html`). Shipping UI look
  lives in `.grok/skills/` (`frontend-design`, `web-design-guidelines`). The Chromium
  daemon, bun toolchain, iOS QA, and design CLI binary are omitted; those
  skills fall back to HTML / WebSearch. This replaced the old
  `.agents/skills/` design suite.
- ECC's full install is 286 skills and would flood the skill catalog. This
  checkout is a security + Rust + quality slice for this codebase.

gstack and ECC skills are marked `disable-model-invocation: true` so Superpowers
keeps automatic process gates. Invoke gstack/ECC with `/gstack:...` and `/ecc:...`.

## First session on a machine

Project plugins require folder trust before hooks run:

```text
/hooks-trust
```

or start Grok with `--trust`. Then `/plugins` should show `superpowers`,
`gstack`, and `ecc` as enabled.

## Update

Re-copy from a pinned upstream commit; do not `git clone` these repos into
the grok-build root. After updating, refresh `UPSTREAM.txt` and this table.
