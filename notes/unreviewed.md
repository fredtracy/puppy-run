# Not explicitly approved

Things changed that the owner didn't specifically ask for, plus things that
went out without anyone actually testing them. Kept so they can be walked
through and either blessed or reverted, rather than quietly becoming permanent
because nobody remembered they were choices.

Move an item to "Settled" once it's been looked at. Delete the section when it
empties.

Note that being settled and being tested are different things — a call can be
approved on description while the code implementing it still hasn't been run by
a human. Those stay in the untested list until someone actually plays them.

## Judgement calls that could have gone the other way

- **The back yard's props stayed put when the house moved back 6 m**, rather
  than moving with it. The fire pit is now 6.5 m off the back wall instead of
  12.5 m, and the hammock 10.5 m instead of 16.5 m, which suits a 19.5 m yard —
  but it does mean the pit sits closer to the house than it used to. Miranda's
  home spot and both spawns went along with the pit, unchanged.
- **`YARD_BOUNDS.zMin` moved from -4 to 0.** It had to move at all — the house
  moving back put z -4 inside the building, so a short throw would have landed
  the ball indoors — but 0 rather than, say, -1 is a round number, not a
  measured one.
- **The tree line and the road both stayed where they were.** The satellite
  showed a longer drive and a shallower yard, and moving the house delivered
  both from one number without growing the world. It does mean the *total* lot
  depth is unchanged, so if the real property is deeper front-to-back than the
  game's, that's still wrong.

## Settled — reviewed and kept, 2026-07-30

- **Poop moved from Backspace to `P`.** Backspace was asked for as a second
  jump key; it already spawned a poop. Jumping is much the more common action
  so it won the better key, but the poop shortcut moving is a side effect
  nobody requested. The on-screen poop button is untouched.
- **Both hammock look-drag axes flipped, not just one.** The report was only
  "backwards". Both axes were inverted relative to OrbitControls, so both were
  flipped for consistency — but if the vertical felt right before, that half is
  now wrong and should go back.
- **Fangs deleted from Miranda's model, not just from the transition.** The ask
  was to remove them "during the transition". Leaving the geometry night-only
  while the transition stopped revealing them would have ended the fade on a
  bare mouth and then faded out onto a yard where she had fangs, so they went
  entirely. The full implementation is in commit `b3ab3db` if they're wanted
  back.
- **The day/night transition was rebuilt from 3D captures onto the drawn
  portrait.** Implied by wanting the portrait used for the transition, but it
  also meant deleting the head-capture path, `portrait.js`'s `points` support
  and `mom.userData.eyes`. Recoverable from history.
- **Her drawn portrait's hair is darker than `mom.js`'s `hairTint`.** A knowing
  departure: the real `#8a4a38` against `#ffe4d4` skin has so little contrast
  that the portrait turns to mush at 32px. It means the card and the model
  disagree slightly on her hair.
- **Miranda's 3D eyeliner wing was lengthened** (cone 0.03 → 0.044) so the
  transition beat is visible. That changes how she looks in the yard at night,
  not just on the transition screen.
- **Comic Sans** for the loading title. Flagged at the time as the cute font
  that needs no asset on Windows; never actually ruled on.
- **Fire pit blocked radius is `FIRE_PIT.radius + 0.3`.** Picked to stay under
  `MOM_HOME`'s 1.08 so Miranda can still stand at her spot by the fire. Leaves
  only ~8cm of headroom.
- **Stepping off the pit rim starts a fall.** Not requested — added because
  landing on the rim was new and walking off it would otherwise teleport her
  down 0.345 in one frame.
- **Right-click context menu suppressed on the canvas.** Needed for the
  both-buttons walk to work at all, but it does remove the browser menu over
  the game.
- **The keydown handler now ignores text inputs.** Fixes a bug the Backspace
  change would have introduced (the multiplayer join-code field would have been
  impossible to correct) and a pre-existing one for Space.
- **`build.target: 'esnext'`** in vite.config.js, required by the top-level
  await the loading screen needs. Drops support for pre-2022 browsers.
- **`pagehide` as well as `visibilitychange`** for suspending audio, and a
  silently swallowed `resume()` rejection — on iOS that means the music
  restarts on the next tap rather than the instant the phone unlocks.
- **Debug query params and hooks left in:** `?load=`, `?face=`/`&faceto=`, and
  `globalThis.faceDebug` (only populated under `?face=`).

## Went out untested

Nothing here has been driven by hand. The browser pane freezes the page between
tool calls, so `requestAnimationFrame` doesn't advance and the game loop can't
be exercised — geometry and maths were verified by simulation instead, but feel
was not.

- Backspace jumping, and `P` spawning a poop.
- Holding both mouse buttons to walk forward, including releasing one button
  and alt-tabbing away mid-chord.
- Hammock look-drag direction, both axes.
- How the fire pit collision *feels* to walk around, and whether jumping onto
  the rim and stepping back off read well.
- Whether the music actually stops on a real locked phone (simulated only), and
  whether it comes back on unlock or waits for a tap.
