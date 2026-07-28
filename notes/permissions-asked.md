# Permission log

Every permission event, **including the ones that were auto-allowed** — not
just the ones that stopped and prompted. The point is to be able to review
later what Claude has actually been reaching for, and decide whether the
current rules in `.claude/settings.local.json` are the right shape.

Append to this as work happens. Format: date — what was used — how it
resolved (auto-allowed by which rule, or prompted) — worth revisiting?

---

## 2026-07-28

### Prompted (blocked, needed a decision)

| What | Why it prompted | Resolution |
|---|---|---|
| `Edit` on `.claude/queue.md` (×2) | **Sensitive-file gate**, not a missing rule. Claude Code flags everything under `.claude/**` as sensitive because it can change Claude's own behaviour. That check runs *above* `permissions.allow`, so it can't be allowlisted — the prompt offers only Deny / Allow once, with no "allow always" | Moved `queue.md` and this file to `notes/`, where the existing `Edit`/`Write(//c/inetpub/wwwroot/puppy-run/**)` rules apply. Verified: editing `notes/queue.md` no longer prompts |
| `Edit` on `.claude/settings.local.json` | Same gate | Expected and worth keeping — Claude rewriting its own permission rules unprompted is exactly what this log exists to catch |

Two allow rules for `.claude/**` were added during this session on a wrong
theory (that `**` simply wasn't matching the dot-directory). It doesn't —
standard glob semantics do skip dot-directories — but that was never the
blocker here, since the sensitive-file gate short-circuits first. The dead
rules have been removed.

### Chained shell commands were defeating the allow list

`node --check src/yard.js` is covered by `PowerShell(node *)`, but it was
being run as `cd C:\...\puppy-run; node --check src/yard.js; if
($LASTEXITCODE -eq 0) { ... }`. Prefix rules match on the command's **first
word**, so a chain starting with `cd` matches nothing and prompts — and the
rule Claude Code then writes is the *entire literal command string*, which
can never match again because the next chain differs by a character.

Net effect: the prompting continues while the allow list quietly fills with
single-use garbage. Two such entries had accumulated (a JSON-validation
chain and a syntax-check chain) and have been deleted. **This is the failure
mode this log exists to catch** — neither entry was individually alarming,
and only seeing them side by side made the pattern obvious.

Fixed behaviourally rather than with more rules: run commands bare, one per
call, no `cd` prefix (the working directory is already the project root) and
no `;` chaining. Verified — a bare `node --check src/yard.js` now runs
silently.

### Auto-allowed (no prompt shown)

| What | Covered by | Used for |
|---|---|---|
| `Edit`/`Read` in `notes/` | `…/puppy-run/**` | The queue and this log, after the move |
| `Bash(node *)` | `Bash(node *)` | `path.matchesGlob` checks on the dot-directory theory; JSON validation of `settings.local.json` |
| `PowerShell(git *)` | `PowerShell(git *)` | `ls-files`, `check-ignore`, `mv`, `status` |
| `Skill(update-config)` | `Skill(update-config)` | Permission-rule reference |

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
