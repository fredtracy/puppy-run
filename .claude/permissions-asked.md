# Permission log

Every permission event, **including the ones that were auto-allowed** — not
just the ones that stopped and prompted. The point is to be able to review
later what Claude has actually been reaching for, and decide whether the
current rules in `.claude/settings.local.json` are the right shape.

Append to this as work happens. Format: date — what was used — how it
resolved (auto-allowed by which rule, or prompted) — worth revisiting?

---

## 2026-07-27

### Auto-allowed (no prompt shown)

| What | Covered by | Used for |
|---|---|---|
| `Read` on `Desktop/temp/**` | `Read(//c/Users/fredt/Desktop/temp/**)` | The 10 driveway/tree reference photos, and the earlier house photo sets |
| `Read`/`Edit`/`Write` in the repo | `…/puppy-run/**` | All source edits — `main.js`, `yard.js`, `house.js`, new `pine.js` and `sky.js` |
| `Write` to the memory dir | `Write(//c/Users/fredt/.claude/projects/**)` | Saved the fairy/goth art-direction memory |
| `PowerShell(git *)` | `PowerShell(git *)` | `status`, `log`, `show`, `diff`, `add`, `commit`, **`push`** |
| `PowerShell(npx *)` | `PowerShell(npx *)` | `npx vite build` before committing |
| `Bash(node *)` | `Bash(node *)` | One-off script to splice the culvert function out of `yard.js`; geometry arithmetic checks |
| Browser MCP tools | the `mcp__Claude_Browser__*` entries | Loading the game, screenshots, console checks, camera driving |
| `WebSearch` / `WebFetch` | `WebSearch`, `WebFetch` | Looking up fast-mode billing and effort levels on the Claude Code docs |

**Worth a second look:** `git push` runs with no prompt under the blanket
`PowerShell(git *)` rule. That's the one auto-allowed action here that reaches
outside this machine. It was explicitly asked for each time so far, but if you'd
rather it always paused, add `PowerShell(git push*)` to the `ask` list — the
existing `git push --force` / `-f` ask rules only cover the force variants.

### Prompted (blocked, needed a decision)

None this session.

### Deliberately left as prompts

Not gaps — these are meant to stop and ask every time:

- `git push --force`, `git reset --hard`, `git clean`, `git rebase` — history loss
- `rm -rf`, `Remove-Item`, `kill` / `taskkill`, `Stop-Process` — destructive
- `npm publish` — outward-facing
