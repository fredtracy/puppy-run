# puppy-run

A Three.js game set in Darla's backyard.

## Characters
- **Darla** — the dog (player character)
- **Miranda** — Darla's mom, hangs out by the fire pit and collects poops

## Workflow
- When building features, move fast: make all the requested changes first. Don't run builds, lint, or syntax checks after each individual edit.
- Don't run `vite build` or any other build/lint/test command on your own initiative, even after finishing a feature. The user checks results themselves in the browser. Only build if explicitly asked to.

## UI conventions
- Always center skill icons: any new `.action-button` (or similar) whose content is an emoji/icon needs `align-items: center; justify-content: center;` on its own `#id` rule, not just `display: flex` from a `.miranda-mode`-style toggle.
