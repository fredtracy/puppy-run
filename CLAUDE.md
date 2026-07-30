# puppy-run

A Three.js game set in Darla's backyard.

## Characters
- **Darla** — the dog (player character)
- **Miranda** — Darla's mom, hangs out by the fire pit and collects poops

## Workflow
- When building features, move fast: make all the requested changes first. Don't run builds, lint, or syntax checks after each individual edit.
- Run builds/tests **only right before committing**, not while iterating. The user checks results themselves in the browser as they go, so a build mid-feature just costs them time; a build before a commit is worth it to catch anything that won't load.
- **Always run the build — and any lint/compile/script step the project has — before pushing.** Not just before committing. `npm run build` is currently the whole check (there's no lint script), and it's what CI runs too. Never push on the assumption that a build from earlier in the session still holds.
- **Commit straight to `main`. No feature branches on this project** — the owner doesn't want them here, so don't create one "to be safe".
- **Log anything the owner didn't explicitly approve in `notes/unreviewed.md`.** Two kinds: judgement calls that could reasonably have gone the other way (a side effect they didn't ask for, a number picked without being told, a knowing departure from something), and anything that shipped without being tested. They want to walk the list periodically and either bless or revert each item — so it has to live in a file, not just in a chat summary that scrolls away. Move items to a "Settled" section once reviewed rather than deleting them silently.
- **Every push to `main` deploys, and that's the point.** `.github/workflows/deploy.yml` runs `npm ci && npm run build` and publishes `dist` to GitHub Pages. Pushing is how the live site gets updated, so it doesn't need confirming each time — but it is why the build has to pass first.
- Dev server is pinned to a fixed port (7331, set via `server.port`/`strictPort` in vite.config.js, and mirrored in `.claude/launch.json`) so it never collides with other local web projects. The game is always at **http://localhost:7331/puppy-run/** — the user has this bookmarked.

## UI conventions
- Always center skill icons: any new `.action-button` (or similar) whose content is an emoji/icon needs `align-items: center; justify-content: center;` on its own `#id` rule, not just `display: flex` from a `.miranda-mode`-style toggle.
