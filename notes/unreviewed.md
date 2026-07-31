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

- **`SHADOW_HALF_EXTENT` cut from 34 to 26, and nobody has looked at it.** The
  reasoning is measured (the shadow pass is 320 of 474 draw calls; each step
  down is ~25 calls) and the geometry checks out — from mid-yard a ±26 box
  spans x −26..26, z −18..34, which still holds the tree line at z=18 and
  x=16 plus the 24 m shadows they cast at a 23° sun. But it was **verified
  arithmetically, not visually**: the browser pane was hidden so no screenshot
  was possible. If trees in the middle distance have lost their shadows, this
  is the reason and 34 is the number to go back to.
- **`gameDebug` is now exposed on `globalThis` in debug mode** — renderer,
  scene, camera, and two benchmarking helpers. Debug-only, so it costs
  nothing in a normal load, but it is a live handle into the running scene
  that didn't exist before.

- **Only ~55% of windows light up at night** (`LIT_WINDOW_SHARE` in house.js),
  picked off a fixed seed so the same rooms are lit every load. Every window
  lit reads as an office block, but which specific rooms are on is arbitrary —
  and it's a share, so it won't hold if windows are added or reordered.
- **Lit windows are emissive only — they throw no light into the yard.** The
  exterior lamps already carry the real night lighting and each extra point
  light is a real cost. It does mean a brightly lit window sits above a patch
  of lawn it isn't illuminating.
- **Grass entries are now shuffled before being written to the instance
  buffer.** Needed so lowering `InstancedMesh.count` thins evenly instead of
  shaving a strip off one side of each chunk. Statistically the same lawn, but
  it is a *different* lawn — every blade now gets a different lean, height and
  shader seed than it did before, so the yard won't match older screenshots
  blade for blade.
- **Debug's quality buttons no longer reload; they thin live.** They can only
  go coarser than the tier the world was built at (spacing is baked into the
  buffers), and they fall back to a reload when asked for finer. The blade
  *count* matches a real load at that tier, so it's honest for measuring cost
  — but the arrangement is a random subset of a fine grid rather than a
  coarser grid, so it isn't a fair preview of how that tier *looks*.
- **Debug's fixed-camera mode also restores the fog**, which wasn't asked for.
  Debug pushes fog to 4000/5000 so distance can't wash out whatever's being
  inspected — but the fixed camera exists to show what the game actually looks
  like, and no fog is the wrong answer for that (especially with an FPS
  counter next to it). Fog now follows the camera mode rather than
  `DEBUG_MODE`. Grass is still off unless `&grass`, deliberately unchanged.
- **Free-fly stays the default for `?debug`.** `?fly=0` starts fixed. Kept that
  way round because every `?eye=&look=` URL ever copied out of debug assumes
  a free camera, and flipping the default would silently break them all.
- **The FPS counter reports an unclamped delta**, unlike everything else in
  the frame loop. `delta` is clamped to 1/15 s to stop physics exploding after
  a stall, which would also cap the readout at 15 fps and hide exactly the
  spikes it exists to catch. Worth knowing if the two numbers ever disagree.
- **The counter shows "avg" and "low" over a rolling second**, with the low
  being the worst single frame expressed as a rate. Colour thresholds (amber
  under 50, red under 30) are eye-picked.

- **The moon's cartoon face is gone**, the same way the sun's smile went. It
  wasn't explicitly asked for — "beautify" was — and it's the second piece of
  hand-drawn charm removed from the sky in one day. Both are in the history.
- **Night got brighter, deliberately.** The sky's moonward horizon, the cloud
  contrast and `grassShadow` (0.28 → 0.4) all went up, and the new grass rim
  adds light that wasn't there. It was tuned down once already for reading as
  dusk rather than night — worth a second opinion on whether it's still too
  far from the goth-night direction.
- **All the moon numbers are eye-picked**: `grassMoonGlow` 0.3, the rim's
  `vHeightT^3` falloff, night `glare` 0.34, and the whole night sky palette.
  Only the "too cyan / too bright" corrections had a stated reason behind them.

- **The roof ladder is usable by both characters, not Miranda only.** The ask
  was "so miranda can climb on the roof", and the hammock next to it *is*
  Miranda-only — so gating this the same way would have been the consistent
  choice. Left open because gating it means the roof simply doesn't exist for
  anyone playing Darla, and a dog going up a ladder is the sort of stretch
  this game is made of. One condition in the click handler to change.
- **The climb is a scripted tween, not real movement.** ~1.9 s, uninterruptible
  once started, and it owns her position outright while it runs. The
  alternative was ladder collision plus vertical movement in the controller,
  which is a lot of machinery for one prop — but it does mean you can't stop
  or turn back halfway up.
- **Walking off the roof drops you off it** rather than an invisible wall
  stopping you at the edge. Reuses the fire pit's fall arc.
- **The ladder has an invisible click-target slab.** A ladder is mostly holes,
  so raycasting the real rails and rungs meant most clicks aimed squarely at
  it went through to the brick and she walked to the wall instead of climbing.
  Zero-opacity mesh rather than `visible = false`, since three raycasts
  invisible objects inconsistently across versions.
- **The hammock's glow is on permanently now**, where it used to appear only
  on hover. Asked for, but it does change the resting look of the back yard —
  there's a pulsing yellow light out there at all times, day and night.
- **Only the *main* hip roof is walkable.** `houseRoofHeight` ignores the
  garage and bay hips, which stand proud of it at the front, so walking over
  there would put you inside them. The back slope — the one the ladder reaches
  and the whole point of going up — is clear.

- **The smiling sun is gone.** Daytime is a sunrise now and the sun was
  redesigned to a small near-white disc inside a wide additive aureole. The
  owner asked for "beautiful and realistic", so this is what was asked for —
  but it does remove one of the game's cuter pieces of art, and it sits at odds
  with the "cute by day" half of the art direction. The old rayed, smiling,
  hand-drawn sun is in the history if it's missed.
- **Every sunrise colour is a taste call**, including the ones that look wrong
  as swatches. `horizon` is 0xff8f3a — far more saturated than a sunrise looks
  — because ACES tone mapping, bloom and the painterly grade each desaturate it
  on the way to the screen, and a value picked to look right in isolation
  arrives as pale pink. Same for `cloudShade` being genuinely dark violet.
- **Fog moved a long way out: 30/92, from 18/55.** It had to move — at the
  first sunrise numbers (15/58) the warm fog colour bleached the tree line to a
  white smear from anywhere in the yard. This partly addresses the standing
  queue item about fog washing out the frontage, but it's a bigger change to
  how far you can see than that item asked for, and the edge-of-world fade is
  now much weaker.
- **`envIntensity` halved to 0.5 by day.** The HDRI is a midday sky and at full
  strength its cool white ambient fought the warm key, leaving the yard looking
  like noon with an orange lamp pointed at it. It does mean less accurate
  reflections on the PBR surfaces.
- **Sun elevation is 23 degrees, raised from 12 on request** so the disc clears
  the tree line. It's a less striking light than 12 was — shorter shadows, less
  colour — and it's the number to move if the sunrise ever stops reading as
  one. The constraint only bites downward: shadow length goes as
  cot(elevation), so 12 degrees put a 10 m tree's shadow at 47 m against a 68 m
  box and 8 degrees would clip every shadow square.
- **Bark generation went from ~10 ms to ~77 ms per texture**, built three times
  (forest-wide plus one per hero pine), so about +200 ms on load. That's the
  price of the Voronoi field being evaluated per pixel rather than drawn with
  canvas polygon fills. Nobody asked for the load to get slower.
- **Bark plate size is set by `GX`/`GY` (10 x 16)** and was picked by eye
  against real southern pine plates being 5-15 cm — it works out around 7 cm on
  a hero trunk. The first Voronoi pass at 7 x 12 gave ~17 cm plates that read
  as slabs.
- **The glare pass fakes occlusion with a single colour tap** at the sun's
  screen position, because there's no depth buffer at that point in the chain.
  It gets the important case right (glare dies as trunks cross the sun) and
  will be wrong for anything dark against bright sky.

- **The ground under the woods is baked down to 20% brightness**
  (`CANOPY_SHADE_FLOOR`, yard.js), ramping over 6 m and starting 1.6 m inside
  the clearing boundary. Both the lawn mesh and the grass blades take it. This
  was the fix for seeing bare lit ground behind the tree line from a raised
  camera, and none of the three numbers was measured — they were picked to
  look like canopy shade.
- **The shadow box went from 28 m to 68 m and now follows the player.** The
  light also moved from 6 units out to 90. The old setup put the shadow
  camera's near plane inside the scene, so nothing over ~4 m tall cast at all —
  which is every tree in the new forest. Bigger box on the same 2048 map means
  half the shadow resolution per metre; the texel snapping is what pays for
  that, and whether it's enough is a judgement.
- **Grass now samples the shadow map by hand.** It's a raw `ShaderMaterial`, so
  Three's shadow plumbing skips it entirely. This is ~40 lines of GLSL doing
  3x3 PCF and it duplicates, in spirit, what Three would have done — the
  alternative was converting the grass to a patched `MeshStandardMaterial`,
  which is a much larger change to a shader with a lot of tuning in it.
- **The grass fragment shader went from `mediump` to `highp`.** Needed because
  shadow depth arrives packed across RGBA8 and unpacking it at mediump bands
  visibly. It's what Three's own materials use, but it is a precision increase
  on the most-shaded surface in the game and could cost something on a phone.
- **Cast-shade darkness is 0.55 by day and 0.28 at night** (`grassShadow`).
  Picked by eye.
- **The opening camera moved from (7, 4.5, 11) to (-4, 4.6, 6).** It had to
  move — the hammock trees are real trees now and the old spot was two metres
  from one, so starting the game showed the inside of a canopy. Where it went
  is a guess at a clear patch, not a composed shot, and Darla starts nearer the
  frame edge than she did. Worth someone with an eye for it picking a better
  one. Note for whoever does: lowering `HAMMOCK_FORK_AT` looks like it should
  help and does the opposite (tried, reverted, see the comment there).

- **The forest trees got taller — 4.6 to 8.2 m, from about 3.5.** Not asked
  for. A tree with real limbs needs room for the limbs to read, and at the old
  size the branching structure was invisible. It does mean the woods now stand
  taller than the two hero pines out front (5.1–5.6 m), which is right for a
  tree line behind a yard but is a visible change to the skyline.
  `FOREST_TREE_HEIGHT` in yard.js is the one-constant revert.
- **`buildBroadleafParts` scales its finished tree to the requested height.**
  The recursion overshoots by 1.3–1.7x depending on how the branch angles roll
  — two templates came out at 13 m from a request for 7.5 — so the geometry is
  measured and scaled at the end. Shape is whatever grew; only size is pinned.
  The alternative was solving for a seed length, which is worse.
- **Forest pines are the real `pine.js` pine at `density` 0.38 / `detail`
  0.5.** Both numbers were picked against a triangle budget, not by eye. At
  full detail the forest was 2.6M triangles with pines taking 63% of it for
  30% of the trees.
- **Ten broadleaf templates and four pine, stamped rather than generated.**
  Generating each of ~700 trees for real is about six seconds, as much again as
  the whole current load. Three of the ten broadleaf templates are
  multi-stemmed (crepe-myrtle-like). If the repetition reads, more templates is
  the cheap fix — they're ~23 ms each.

- **Most of the brush band's numbers are measured against opacity, not
  chosen.** `BRUSH_DEPTH` 4.2, `BRUSH_SPACING` 1.0, `BRUSH_MIN_HEIGHT` 1.9, and
  the understory leaf texture's 130 leaves at 0.92 scale all came from raycast
  results rather than from eye — a leaf card is only ~43% solid at alphaTest,
  so the band is opaque by crossing enough of them, and each of those numbers
  moved after a measurement showed a gap. The 0.6 depth-darkening and the
  3.1 m height ceiling are taste.
- **The base skirt exists because of a measurement too.** Foliage strung on
  arching canes thins out where they converge at the root, which put the
  thinnest part of the band at 0.3 m — Darla's eye height. The skirt is 3–5
  extra clusters sitting on the ground per clump.
- **Brush grows *inside* the clearing, up to 2.2 m past the mown edge**
  (`BRUSH_BAY`). Deliberate — it's what stops the tree line reading as a
  straight clipped hedge — but it does mean shrubs standing on lawn that used
  to be open, and it eats a little of the walkable yard on every side.
- **Nothing collides with the brush yet.** Darla walks straight through it,
  including the parts that now stand on the lawn. Blocking her at the tree line
  is the agreed next step, but until it lands the band is scenery she can pass
  through, which is worse than the old woods for that one thing.
- **Grass still grows behind the band**, out to `GRASS_FADE_RADIUS` 44, even
  though it's now invisible. Deleting it is the whole performance argument for
  doing this, and it hasn't been done — so this change is currently pure cost.
  Raycasting says the forest floor is 99–100% hidden out to ~10 m behind the
  edge, dropping to ~75% when Darla stands within 3 m of it, so the cull wants
  to keep roughly a 6–8 m skirt rather than stopping at the brush.
- **`OPEN_Z_MIN`/`OPEN_Z_MAX` hoisted out of `inOpenArea`** so the brush could
  measure against the same boundary. Same numbers (-48, 18), no behaviour
  change.

- **The clearing is now 35 m wide** (x -19 to 16, wider still across the
  frontage) where it was 26. That's what removing the trees crowding both long
  walls took, but the clearing is also where lawn grass grows, so it's roughly
  a third more grass and a slower load. Couldn't pin the number — tool round
  trips are currently longer than the load itself.
- **The fire pit's new position was read off a marked-up screenshot**, not
  measured: (-0.7, 10.2), from scaling the overhead at ~21 px/m. It lands 11.7 m
  off the back wall with 7.8 m to the tree line, which looks right, but it's an
  estimate of where the circle was drawn.

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

- **That the music-layering fix actually fixes what was heard.** The orphaned
  timer chain in `scheduleLoop` is a real bug and the fix is certain, but it
  was found by reading the visibility-resume path, not by reproducing the
  layering — no way to hear the game from here. If layers still stack, the
  next suspect is more than one tab having the game open, which no amount of
  code will fix.
- **Miranda's black night lipstick.** Both halves are code-only so far — the
  model's `lipMat` recolour in `setMomNight`, and the drawn portrait
  interpolating `LIPS_DAY` to `LIPS_NIGHT` through the transition. Neither was
  looked at after dark.
- **How any of the rebuilt trees look.** Structure, triangle counts and build
  times were all measured; nothing was seen. The browser pane wasn't displayed,
  so no screenshot could be taken. Unknown: whether the leaf-cluster texture
  reads as leaves at distance, whether the crowns are too sparse or too solid,
  whether ten templates is enough variety, and whether the merged-per-chunk
  wood pops visibly as chunks frustum-cull.
- **How the rebuilt brush band looks.** The sphere-blob version was seen and
  rejected; what replaced it has only been measured. Estimated see-through is
  0.9% at 0.3 m, 0.7% at 0.8 m, 1.9% at 1.5 m and 26% at 2.0 m — the last is
  fine, since above 2 m you should be looking into trunks. Unknown: whether the
  greens, the bay-and-point edge and the dark interior read well.
- Backspace jumping, and `P` spawning a poop.
- Holding both mouse buttons to walk forward, including releasing one button
  and alt-tabbing away mid-chord.
- Hammock look-drag direction, both axes.
- How the fire pit collision *feels* to walk around, and whether jumping onto
  the rim and stepping back off read well.
- Whether the music actually stops on a real locked phone (simulated only), and
  whether it comes back on unlock or waits for a tap.
