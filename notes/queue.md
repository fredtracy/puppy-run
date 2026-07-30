# Work queue

Ideas parked for later, in the order they came in. Kept as a file so it
survives context compaction and long sessions.

Add with `queue: <idea>` in chat — that means "park it, don't derail".

## Open

- [ ] **Lawn** — real variety from the grass photos: different species/stalk
      shapes, plants, bare patches, colour variation. Right now it's one grass
      stalk everywhere.
- [ ] **Fire pit** — serious pass. Wood in it during the day (not burning); at
      night the wood burns and smoke rises. Ignore the chairs.
- [ ] **Trees** — match the bark much more closely to the photos, and start the
      branches lower on the trunk.
- [ ] **Music** — rework day and night tracks to match the themes: cute happy
      fairy by day, cute spooky goth by night.
- [ ] **Dragonflies** — blue and green, flying around at night.
- [ ] **Hammock** — when a character gets in, camera goes first-person and looks
      straight up at the sky.
- [ ] **Front flower bed** — it runs straight for a while and *then* curves
      around the corner, with the sidewalk following it. Currently it cuts
      across the sidewalk. See the front-of-house photos.
- [ ] **Discuss using subagents** to work queue items in parallel — which items
      actually parallelise (they mostly touch different files, but several
      share `yard.js`), and whether the visual-iteration loop survives being
      handed off, since most of these need screenshot-and-judge cycles.
- [ ] **Remove the roof vents and plumbing stack** — the two box vents and the
      stack on the back slope in `house.js` don't add much.
- [ ] **Lamp glass should stop glowing by day.** The point lights already go to
      zero intensity, but `LAMP_GLASS_MAT` / `BULB_MAT` in `house.js` are
      emissive around the clock, so the fixtures still look lit at noon.
- [ ] **Back patio lights** should glow at night like the front ones now do
      (see `lampSpots` in `house.js` — the patio fixtures aren't in that list).
- [ ] **Roof bar** — dark bar on the roof above the arched windows. Confirmed to
      be `SOLDIER_MAT` geometry (magenta-tint test). Ruled out: roof vents,
      chimney (stucco), backface culling through the roof void, the core
      front-wall band, the bay side bands. Current theory: a seam in the main
      roof surface where the bay's hip crosses it, showing the back wall's band
      through. Needs one focused pass.

- [ ] **Miranda's character-select portrait** — the cute image of her still
      shows the old model. Redraw it to match the anime/cel-shaded rebuild.
      (`drawMirandaPortrait` in `main.js`. This was filed as "loading-screen
      portrait" before there was a loading screen; the new one has only
      Darla on it, so this is the character-select card.)

- [ ] **Tint the lawn mesh by the vigour field.** Bald patches cull the grass
      blades but reveal the lawn mesh underneath, which is painted green grass
      (`createPaintedGrassTexture` in `yard.js`) regardless of how dead the
      ground is — so a bare patch still reads as short green lawn rather than
      dirt. Doesn't currently hurt under the pines, where the needle mat now
      covers it, but every other bare patch in the yard is affected.
      `LAWN_SEGMENTS` is 200 over `LAWN_SIZE` 120, so vertices are ~0.6 apart
      — fine enough to bake `lawnVigour`/`pineDuff` into vertex colours and
      turn on `vertexColors`, rather than needing a second texture.


- [ ] **Comment out the dialogue options** — clunky and not being used. Keep
      the existing speech bubbles that appear above characters' heads; clicking
      on Darla should just run those directly, with no options menu in between.

- [ ] **Concrete tiles visibly.** The texture repeat is obvious on the
      driveway/walk/patio slabs — reads as tiling rather than as a poured
      surface. Needs to blend so the repeat isn't findable.

- [ ] **Fix placement of windows, doors etc. on the house** — positions don't
      match the reference photos.

- [ ] **Realistic wind, driven from one place.** Hair, grass, trees etc. all
      responding to the *same* wind rather than each doing their own thing:
      intermittent gusts, varying strength, direction wandering somewhat. The
      grass shader already has gust/sway/flutter layers worth reusing as the
      model — the point is to hoist it into one shared source everything
      reads from.

- [ ] **Camera clips inside the house and shrubs.** Standing anywhere near the
      house puts the camera through a wall or into a bush, and you end up
      looking at the inside of brick. Wants the usual treatment: cast from the
      aim point back toward the desired camera position and pull in to the
      first hit, so it slides along the wall instead of entering it. Turned up
      constantly while spawning at `?at=` coords near the house (see
      `SPAWN_AT` in `main.js`) — it's the main thing making close-quarters
      inspection painful.

- [ ] **Pine bark reads as grey stone blocks up close.** The plate lattice in
      `makeBarkTextures` (pine.js) is right in structure but too regular and
      too grey — the plates are near-uniform rectangles with even mortar-like
      fissures, so it looks like a stone column rather than wood. Wants more
      size variation between plates, warmer tone, and fissures that vary in
      width along their length.
- [ ] **Fog is heavy enough to wash out the frontage.** From across the road
      the house and pines go pale blue-grey and lose most of their contrast.
      Fine as an edge-of-world device, too strong at 30-40m. See
      `DAY_FOG`/`NIGHT_FOG` in main.js.

- [ ] **Thin the lawn at runtime when the frame rate says to.** The quality
      tier (`detectQualityTier` in yard.js) is a guess made *before*
      generateWorld from core count, memory and GPU name, because grass
      density is baked into the instance buffers at startup. When the guess
      is wrong there's currently no recovery.
      `InstancedMesh.count` can be lowered at runtime without rebuilding, so
      measuring frame rate over the first few seconds and trimming each grass
      mesh's count would claw back framerate on a device that turns out worse
      than it looked. Won't help load time — the blades are already built by
      then — so it complements the tier rather than replacing it.
      Worth pairing with a debug-panel readout of measured FPS so the
      trimming is visible rather than mysterious.

- [ ] **Darla can still walk into the fire pit when called.** The collision
      lives in `clampToWalkable`, which only the *player's* movement goes
      through — her AI paths (`updateDarlaFetch`, `updateDarlaCheese`,
      `updateDarlaLeash`, the bite chase) set `darla.position` directly and
      skip it. Miranda's AI walk got a `pushOutOfFirePit` call for exactly this
      reason; Darla's didn't. Either give each of her AI paths the same
      treatment or find the one place they all funnel through. Careful not to
      apply it while she's airborne or already inside, the same exemptions the
      player gets.

## Done

- [x] **Yard proportions matched to the satellite view.** The back yard was too
      deep and the driveway too short. Both fixed by moving the house 6 m back
      off the road — `HOUSE_Z` from -7.5 to -1.5 — since the road (`ROAD_Z`) and
      the tree line (`inOpenArea`) stay put: the front grows 19 m → 25 m and the
      back yard shrinks 25.5 m → 19.5 m from one number.

      Deliberately *not* done by pushing the road out, which would have been
      truer to the map but needed a bigger `WORLD_RADIUS`, and grass is 97% of
      world generation — a bigger world is directly a slower load.

      Most things follow `HOUSE_Z` on their own, which is why this was cheap:
      `TERRAIN_CENTER_Z` derives from it, so the graded pad, the lawn shading
      and the mown radius all moved too, and the driveway run is measured off
      `HOUSE_DRIVEWAY`. A side benefit — the drive's grade went from about 15%
      to 7.3%, because the same climb is now spread over 16 m instead of 10.

      What does *not* follow is anything with a hardcoded world z. Checked
      rather than moved: fire pit, hammock, both spawns, `MOM_HOME`. The one
      that genuinely broke was `YARD_BOUNDS.zMin` at -4, which ended up inside
      the building.

- [x] **Music kept playing with the browser closed / phone locked.** Reported
      by a player. Nothing suspended the AudioContext, and pausing the
      scheduler alone would not have helped — every note of the current phrase
      is scheduled ahead on the audio clock the moment the phrase starts, so
      they were already queued and would have sounded regardless.
      `visibilitychange` now suspends and resumes it (`bindVisibilitySuspend`
      in `audio.js`), plus `pagehide`, since iOS doesn't reliably fire
      visibilitychange when the app is swiped away.

      The subtle half: the loop timer has to be cleared as well. `setTimeout`
      still fires while hidden (just throttled) and `currentTime` is frozen
      while suspended, so a loop left rescheduling would stack every phrase at
      the same frozen instant and dump the lot in one blast on resume.

- [x] **Fire pit collision broke the moment it gained the jump-in exemption**,
      and the cause is worth remembering. "Already inside, so don't eject you"
      was tested against the same radius the push-out places you at — but being
      pushed leaves you resting at *exactly* that radius, and re-measuring the
      point with `hypot` comes back `0.9999999999999999` for most angles. So
      touching the rim flipped you to "inside", which exempted you, which let
      you walk straight through. Measured: 1363 of 3600 approach angles
      re-measure under, and 438 of 720 walked to the centre of the fire.
      `FIRE_PIT_INSIDE` is now 0.08 smaller than `FIRE_PIT_CLEARANCE` so a
      point on the boundary is unambiguously outside. **Any two-radius test
      like this needs hysteresis** — equal radii will always chatter.

- [x] **The jump arc is absolute, not relative to the ground.** Jumping *over*
      the fire pit used to throw her upward as she crossed the rim: height was
      measured from whatever was under her at that instant, so the reference
      moving up 0.345 moved her with it — a second little hop halfway through
      the first. `jumpGroundY` now records the ground she left and the arc runs
      from there, landing on whatever is beneath her when she comes down.
      Measured: worst single-frame rise over the pit drops from 0.364 to 0.052,
      which is just normal arc motion.

      Stepping off the rim starts a fall rather than teleporting her down.
      That's keyed off crossing the rim radius specifically, **not** off "the
      ground got lower" — walking downhill changes the ground beneath her by
      more per frame than any sane threshold, so a generic test would misfire
      constantly on the hill.

- [x] **Jumping onto the pit stands you on the stonework**, not down in the
      fire. `groundHeightAt` in `main.js` returns the rim top instead of the
      terrain when you're over the ring. Deliberately a special case rather
      than a general height-field — one prop doesn't justify one.

      The radius it uses is the *stone ring's* outer face (0.615), not the
      wider radius the pit blocks and clears grass at (1.0). Standing only
      extends as far as there's something under your feet, so landing in the
      0.385 gap between the stonework and the collision boundary puts you on
      the grass beside the pit, which is what it looks like. The pit's real
      dimensions are now hoisted out of `createFirePit` into `FIRE_PIT`
      (`rimRadius`, `rimHeight`) so what you stand on and what gets built come
      from the same numbers.

- [x] **You can jump into the fire pit.** It still blocks you walking in, but
      the push-out is skipped while airborne (so a jump clears the rim instead
      of hitting an invisible wall) and while already inside (so having landed
      in there you can move about and walk out rather than being spat straight
      back). Both characters' starting spots also moved from 1.08 out to 1.62 —
      at 1.08 they began 8cm from the blocked radius, so the first step in any
      direction shoved them.

- [x] **The fire pit is solid.** A radial push-out rather than the house's
      axis-separated box slide, because it's round — projecting back out along
      its own radius is what makes her skirt smoothly around it instead of
      catching on invisible corners. Being stateless, the same function serves
      the per-frame move, the click-to-move destination, and Miranda's AI walk
      (her existing steer-around repulsion only nudges her, and a poop sitting
      against the stones could overpower it).

      Blocked radius is `FIRE_PIT.radius + 0.3` = 1.0, and it can't go much
      above that: `MOM_HOME` sits 1.08 from the centre and hanging out by the
      fire is the whole point of her, so a wider margin would push her out of
      her own spot.

- [x] **Hammock look-drag was inverted on both axes.** Dragging right turned
      her head left and dragging down looked up — opposite to the OrbitControls
      feel the drag has everywhere else in the game. Both terms in the
      `pointermove` handler were subtracting: increasing `loungeYaw` swings the
      look direction toward the camera's own right, and `loungePitch` is
      measured from the zenith, so adding to it is what tilts the view down

- [x] **Bark and bite icons.** Bark keeps the 🐕 emoji but gains two
      sound-wave arcs (CSS `::before`/`::after`, each a circle with only one
      border drawn), so it says "bark" and not just "dog". They must be on the
      **left**: the emoji faces left, so arcs off its right come out of the
      tail end and read as a fart.

      Bite is inline SVG — a snarling dog's head, front on. Four dead ends
      worth not repeating: wide teeth on a full-width gum bar read as the
      letter **W** (twice); a dog nose added between brows and mouth turns to a
      white blob at button size; and a *profile* head with an open jaw reads as
      a shark, because a pointed muzzle plus one spiky ear is a fin. Front-on
      with floppy ears either side is what settles it as a dog, and angled
      brows are what make it a bite rather than a friendly one

- [x] **Backspace jumps, and both mouse buttons walk forward.** Backspace was
      already taken — it made Darla poop — so poop moved to **P** (Backspace is
      the better key and jumping is much the more common action). The mouse
      chord is read off `e.buttons` rather than by counting presses, so it
      can't drift out of sync, with a `blur` handler for alt-tabbing away
      mid-chord and `contextmenu` suppressed on the canvas (the right button
      already rotated the camera, so that was overdue). It feeds into
      `updateMovement`'s `keyUp` specifically, so everything that treats
      forward as "the player is driving" — cancelling click-to-move, waking her
      out of the hammock — covers the chord for free. The keydown handler now
      also ignores events from text inputs, without which Backspace-to-jump
      would have made the multiplayer join-code field impossible to correct


- [x] **Miranda's night face, and the day/night swap plays the change.**
      Winged eyeliner is night-only; she's bare-eyed by day (`setMomNight` in
      `mom.js`, driven from `applyDayNight`). The swap was already a
      five-second fade to black with nothing in it, so the fade now shows her
      face and the wings drawing themselves on, inner corner to tip, and
      coming back off on the way to morning. `src/transition.js`.
      `?face=0.6` pins it at any point, `&faceto=day` for the morning
      direction.

      **Fangs were built and then removed** (they were in the first commit of
      this if they're ever wanted back): a small ivory cone per side hanging
      from the upper lip, with its own beat in the transition after the wings
      and a "Fangs out"/"Fangs away" caption. Cut on the owner's call — the
      eyeliner alone is the night change now.

      It's a wipe between two stills of her head, shot once at load (bare and
      made up) rather than animated 3D — the two images are identical
      everywhere except the wings and fangs, which is what lets a generous
      rectangular wipe reveal only the feature. Real geometry does the
      drawing, so nothing has to be kept in sync by hand.

      Two things that cost time and would again:
      - **`destination-in` intersects, it doesn't accumulate.** Painting both
        wing regions straight onto the mask left only what they had in
        common, which is nothing. Regions have to be unioned onto their own
        canvas first (`regionCanvas`).
      - **Anything added to her mouth has to clear z 0.1176**, which is where
        her lower lip's front surface sits. The fangs were first placed at
        0.1135 and were completely invisible despite existing and rendering —
        a confusing thing to debug.

- [x] **Loading screen** — "Puppy Run" over Darla colouring in from nose to
      tail; her rightmost pixel is progress 1.0, which with her nose to the
      left is her tail. It's the **real 3D model**, shot side-on into a
      texture once (mid-trot, matching the in-game walk cycle's diagonal leg
      pairing) and treated as a flat image after that — so the reveal keeps
      repainting even while the main thread is blocked building chunks. A
      hand-drawn canvas dog was tried first and is in the history if the
      model ever reads worse than the drawing did. `src/loading.js`; the
      overlay markup and CSS live in `index.html` so the title is up on the
      browser's first paint. The build was one long synchronous top-level
      module, so the browser never got a paint in during the ~8s — the three
      `await`s in `main.js` (before construction, per world chunk, before the
      first render) are what make it able to redraw at all. Costs ~0.5s of
      frames. Needs `build.target: 'esnext'` for top-level await.
      `?load=0.6` pins it at any stage for a look.

      The sweep is CSS transforms on two stacked canvases, not a canvas
      redraw — the main thread is blocked in ~200ms lumps during world
      generation, so a JS-drawn sweep only gets ~5fps and staircases, while
      the compositor keeps interpolating regardless. `createTreeChunk` can't
      be split finer to buy more frames; it's one atomic grass call.

      The three status messages are `LOADING_STATUS` in `loading.js` and
      switch on thirds of the bar, which works only because the bar's phase
      weights track elapsed time. The first is duplicated as static text in
      `index.html` so there's a caption before the module evaluates — change
      one, change the other.

- [x] Sky no longer stops halfway down. Three separate causes: the lower
      hemisphere was clamped to a flat fill, the cloud deck's divisor was
      clamped near the horizon (stripes), and the deck projection ran away
      toward the horizon and smeared clouds into vertical shafts. Zoom is
      also capped at 13 in normal play, which keeps the world edge and the
      mirrored lower sky out of shot to begin with

- [x] Queue editing no longer prompts — the cause was Claude Code's
      sensitive-file gate on `.claude/**`, which sits *above* the
      `permissions.allow` list, so no rule could ever satisfy it. Fixed by
      moving this file and the permission log to `notes/`
- [x] Trip skill stripped to a world-look change — no flying, no Darla barking
- [x] Right-drag rotates the camera
- [x] Exterior lamps throw real light at night
- [x] Camera can tilt to vertical; player hides when it rolls in close
- [x] Miranda no longer spawns buried under the terrain
- [x] Storm drain removed
- [x] Sky much bluer; procedural clouds
- [x] Driveway curve + apron, roadside swale, NW→SE terrain tilt
- [x] Southern yellow pines at the road
- [x] Miranda rebuilt anime/cel-shaded — swept body profile, ink outlines,
      graphic face, strand hair. Darla stays blocky on purpose
- [x] Camera aim height follows zoom, per character (eyes close in, mid-body
      zoomed out)
