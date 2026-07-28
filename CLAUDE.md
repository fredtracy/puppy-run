# puppy-run

A Three.js game set in Darla's backyard.

## Characters
- **Darla** — the dog (player character)
- **Miranda** — Darla's mom, hangs out by the fire pit and collects poops

## Workflow
- When building features, move fast: make all the requested changes first. Don't run builds, lint, or syntax checks after each individual edit.
- Run builds/tests **only right before committing**, not while iterating. The user checks results themselves in the browser as they go, so a build mid-feature just costs them time; a build before a commit is worth it to catch anything that won't load.
- Dev server is pinned to a fixed port (7331, set via `server.port`/`strictPort` in vite.config.js, and mirrored in `.claude/launch.json`) so it never collides with other local web projects. The game is always at **http://localhost:7331/puppy-run/** — the user has this bookmarked.

## UI conventions
- Always center skill icons: any new `.action-button` (or similar) whose content is an emoji/icon needs `align-items: center; justify-content: center;` on its own `#id` rule, not just `display: flex` from a `.miranda-mode`-style toggle.
