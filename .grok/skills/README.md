# Project skills

Grok loads `/.grok/skills/` for this repo (higher priority than `~/.claude/skills`).

| Skill | Job | Slash |
|---|---|---|
| `frontend-design` | Invent / restyle UI. Purpose, tone, type+palette, one signature. Avoid the three AI default faces. | `/frontend-design` |
| `web-design-guidelines` | Audit existing UI against Vercel Web Interface Guidelines. Outputs `file:line`. Not a look generator. | `/web-design-guidelines` |
| `vercel-react-best-practices` | React performance and structure (waterfalls, bundle, rerender). Not aesthetic. | `/vercel-react-best-practices` |

Pair: generate with `frontend-design`, then review with `web-design-guidelines`.

Vesprism is Tauri + Vite, not Next.js. When using `vercel-react-best-practices`, apply client / rerender / bundle rules; skip RSC, `next/dynamic`, and server-action rules unless the file is actually Next.

gstack `design-consultation` / `design-shotgun` / `design-html` stay for product-plan mockup loops. Do not pull `ui-design`, `shadcn-ui`, `pixel-perfect-design` from `~/.claude/skills`.

Pins: see `UPSTREAM.txt`.
