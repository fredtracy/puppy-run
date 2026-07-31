# Work queue

Ideas parked for later, in the order they came in. Kept as a file so it
survives context compaction and long sessions.

Add with `queue: <idea>` in chat — that means "park it, don't derail".

## Open

- [ ] **A hidden watery oasis in the far corner.** A stream that starts a
      little way into the woods; follow it and it leads you to a beautiful
      pond tucked in the corner. Meant to be found, not signposted.

      **Where.** The owner circled it on an overhead screenshot: the corner
      past the *far* end of the back lawn, roughly x 18-35, z 20-40 — call it
      40 m out from the origin, which sits comfortably inside both
      `WORLD_RADIUS` (55) and the movement clamp (50). Worth confirming with
      `?at=26,30` and a look before building anything, since that reading came
      off a screenshot rather than coordinates.

      **The thing that decides the whole design:** that corner is the *high*
      end of the lot. `terrainHeight` tilts the ground with `UPHILL_X` /
      `UPHILL_Z` both positive, so the ground rises toward it — which is
      exactly where water doesn't collect. Two honest ways out:

      1. Carve a bowl into `terrainHeight`. That function is the single
         source of ground height for the lawn mesh, every grass blade, every
         tree and the brush, so a depression there reshapes all of them for
         free. Cheapest route to a real pond.
      2. Make it a *spring* — water emerging on the high ground, pooling, and
         the stream running **downhill out of it** rather than into it. Also
         physically right, needs no terrain surgery, and arguably prettier:
         you'd follow the stream *up* to find the source.

      The owner described stream-then-pond, which is (1). Worth showing them
      (2) before committing, since it's less work and a nicer walk.

      **Gotchas, all of which will otherwise be discovered the hard way:**

      - The brush band is deliberately opaque (~1% see-through at dog height).
        Something hidden behind it is hidden *permanently* unless there's a
        gap — so the stream has to be the thread that draws you through, and
        the band needs a deliberate break where it crosses. See `brushEdge` /
        `woodsDepth` in yard.js.
      - Water needs the same exclusions the fire pit and road already have:
        no grass, no trees, no brush growing in it. There's an established
        pattern (`inFirePit`, `inRoad`) to copy.
      - At radius ~40 the grass has nearly faded out (`GRASS_FULL_RADIUS` 24,
        `GRASS_FADE_RADIUS` 44) *and* `canopyShade` has the ground at 20%
        brightness. A glade meant to be beautiful wants to be a lit clearing,
        so it likely needs its own exemption from both — the same way the
        mown property is already exempt from the distance fade.
      - Nothing in the woods has collision yet, so she can currently walk
        across wherever the pond goes. Pairs with the chimney/hammock
        collision item below.

- [ ] **Optimize — 30fps even on low quality.** Reported 2026-07-30, and the
      "even on low" is the whole clue: low is ~19.5% of high's blade count
      (spacing 0.068 vs 0.03, and count goes as 1/spacing²), so if that barely
      moves the needle then **grass is not the bottleneck** and every previous
      optimisation instinct on this project points the wrong way.

      What changed the same day, in rough order of suspicion:

      1. **The forest is now ~1.1M triangles of real branch geometry** where it
         used to be ~40k of cones and spheres, and all of it casts shadows —
         so the shadow pass draws it a second time. `castShadow` on the merged
         per-chunk tree meshes is the single biggest lever to test first, and
         it's one line.
      2. **The shadow map went from a 28 m box to 68 m** on the same 2048 map,
         so far more geometry falls inside the frustum every frame.
      3. **108k instanced foliage clusters** with `alphaTest`, which forces
         per-fragment discard and defeats early-Z.
      4. The grass fragment shader went `mediump` → `highp`, and now also does
         a 3×3 PCF shadow lookup per fragment. On the most-covered surface in
         the scene.

      Measure before tuning (see the roof-camera item below for why that
      sentence is in here). A DevTools GPU capture would settle it faster
      than any amount of guessing.

      **First measurement, 2026-07-30, and it rules grass out.** The debug
      quality buttons now thin the lawn live (`setGrassDensity`). Going from
      100% to 19% of blades — the same blade count a real `low` load builds —
      moved the frame rate **not at all**: 60 avg / 59 low before, 60 / 59
      after, same view, same session. Whatever is costing frames, it is not
      the number of blades.

      **Second pass, 2026-07-31, with real instrumentation**
      (`gameDebug.benchRender` — drives the composer directly and calls
      `gl.finish()`, so it measures GPU work rather than command submission,
      and works with the page backgrounded where rAF sampling can't).

      Counts are solid — they're CPU-side and don't care about throttling:

      | | draw calls | triangles |
      |---|---|---|
      | baseline, mid-yard | 474 | 10.45 M |
      | grass hidden | 409 | 2.29 M |
      | shadows off | 154 | 8.71 M |
      | shadow box ±16 instead of ±34 | 384 | — |

      Three things fall out:

      1. **Grass is 78% of all triangles** (8.17 M of 10.45 M) and hiding it
         barely moves the clock. The game is not triangle-bound. That is the
         second independent result saying leave the grass alone.
      2. **The shadow pass is 320 of the 474 draw calls** and re-renders the
         woods. It is the largest single structural cost in the frame.
         `SHADOW_HALF_EXTENT` is now 26 (was 34) on the back of this — worth
         ~50 calls.
      3. Post-processing is ~0.1-0.3 ms of ~2 ms. Not the problem.

      **What is NOT established, and don't trust it until it is:** any of the
      timings. The baseline read 3.8, 2.1 and 1.9 ms across three runs of the
      same scene, and the browser pane was hidden throughout (GPU throttled,
      drawing buffer only 1014×918). At that size the whole frame renders in
      ~2 ms here, against the ~33 ms the owner is seeing — a 15x gap that
      geometry at the same resolution cannot explain. So either their GPU is
      much weaker, or the cost is resolution-dependent in a way this pane
      never exercises.

      **Next step, and it needs the pane visible:** re-run `benchRender` at
      the owner's real window size, then bisect fill-rate suspects — grass
      overdraw, the alpha-tested foliage, the post chain — by resolution
      rather than by object count. Cutting `renderer.setPixelRatio` in half
      is the fastest single test of "is this fill-bound at all".

- [ ] **The chimney needs collision, and so does the hammock.** The chimney one
      is new with the roof being walkable — you can walk straight through it
      up there. It's a box, so it wants the same treatment as the house
      masses, except `HOUSE_SOLIDS` is checked only at ground level and is
      skipped entirely while `onRoof` (see `clampToWalkable`), so this needs
      its own roof-level test rather than being added to that list.

- [ ] **Replace the hammock's two trees with a hammock stand.** They were
      ordinary yard trees the hammock happened to be slung between; a proper
      curved stand is what the yard actually wants, and it also sidesteps the
      trees-swallowing-the-camera problem that forced the opening camera to
      move (see `createHammockTree` in `yard.js`, and the note about
      `HAMMOCK_FORK_AT` — don't lower it, it makes things worse). Pairs
      naturally with the hammock collision item above.

- [ ] **Make the mouse cursor a cute paw print.** CSS `cursor` on the canvas
      with a data-URI image (the game already generates canvas textures and
      the favicon this way, so drawing one more is cheap). Note there's
      existing cursor handling to work with, not around: hovering an
      interactive target swaps to `pointer` (`setMomHover`, `setDarlaHover`,
      `setHammockHover` in `main.js`), so the paw wants a second state — a
      plain paw and a "clickable" paw — rather than one cursor that fights
      those.

- [ ] **Climbing the ladder should be an actual animation.** Right now
      `updateClimb` in `main.js` is a positional tween — she slides up the
      rungs with her idle pose on, which reads as levitating. Wants the limbs
      driven: hands and feet reaching rung to rung, body swaying slightly with
      each pull. Same rigs as the sit item below (`group.userData` arm/leg
      pivots), and the two are worth doing together since both are "pose her
      by hand rather than run the walk cycle".

- [ ] **Sit, for both Miranda and Darla.** Asked for 2026-07-30 and not
      started. Wants a pose plus a way to trigger it — the other actions are
      on-screen buttons (`.action-button`, see the UI conventions note in
      CLAUDE.md about centring icons) with keyboard equivalents. Two separate
      poses: Darla is a dog sit (front legs straight, hindquarters folded,
      body tilted back), Miranda is a person sitting on the ground. The rigs
      to drive are `updateWalkCycle` / `updateMirandaWalkCycle` and the leg
      and arm pivots in `group.userData` on each character.

- [x] **The moon got the same treatment as the sunrise.** Almost all of it
      came free: `sky.js` already keys its directional horizon, cloud rim
      lighting and three-lobe glow off `uSunDir`, which at night *is* the moon
      — the night palette was just collapsing every one of those back to a
      single value. Filling in `horizonAway` and `cloudHot` turned the whole
      machine on.

      Disc rebuilt like the sun's: small bright core inside a wide additive
      aureole, plus maria laid out roughly like the real near side and a
      limb-darkening pass, both clipped to the disc so the silhouette stays a
      clean circle. The cartoon face is gone.

      The grass rim (`uMoonGlow` in the blade shader, `setGrassMoonGlow`) is
      the "ethereal" part — a cool catchlight on blade *tips*, on blades
      edge-on to the moon, multiplied by the shadow mask so grass under a tree
      stays dark. First pass at 0.5 and a saturated cyan read as radioactive:
      the giveaway was the lawn being the most colourful thing in a night
      scene. Moonlight is desaturated nearly to grey. 0.3 and a silver-blue.

      Also: night `grassShadow` 0.28 → 0.4 (moonlight does cast real shadows
      and the tree line throws good ones), and a moon glare at 0.34 in a cool
      tint — genuinely a different weight rather than the sun's turned down,
      since the sun's veil term alone undoes the darkness at any real
      strength.

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
- [x] **Roof vents and plumbing stack removed.** Three dark specks that
      earned nothing. `ROOF_VENT_MAT` and the `roofYAt`/`slopeAngle` helpers
      went with them. In history if the roof ever looks too clean.
- [x] **Lamp glass stops glowing by day.** `setHouseLampsLit` in house.js,
      driven from applyDayNight beside the windows. Drops `emissiveIntensity`
      rather than darkening the colour — there's a bloom pass keyed off
      brightness downstream, and a dimmed-but-coloured emissive would hover
      around its threshold and flicker into bloom as exposure moves.
      Verified: zero emissive meshes in the scene by day.
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

- [x] **"The camera is unusable on the roof" — it was never the camera.**
      Filed while the roof ladder was being built, then fixed the same day,
      and it is worth keeping for the method rather than the code.

      Symptom: climb up, click to walk, and the screen fills with shingles.
      Obvious reading is that the camera has buried itself in the roof. Two
      rounds of fixing went into that reading — a floor in
      `clampOrbitToGround`, then a direct lift of `camera.position.y` after
      `controls.update()`, tried at 0.9 m and 2.2 m of clearance. Neither
      changed a single pixel.

      One `globalThis` probe inside the lift settled it in a minute: the
      block *was* running, and the camera was sitting five metres **above**
      the roof the whole time. Nothing was ever buried.

      The actual cause was `getGroundPoint`, which raycasts only
      `yard.userData.lawn`. Standing on the roof and clicking on it sent the
      ray straight through the shingles to the grass below, handing back a
      point inside the building's footprint — and `clampTargetPoint` then
      helpfully pushed that point out to the nearest lawn. So every click
      walked her off the roof, and what filled the screen was the roof going
      past as she left it.

      Fixed by marching the ray against the roof height field while `onRoof`
      (`marchToRoof`), exempting `clampTargetPoint` the same way
      `clampToWalkable` already was, and putting the click marker on the
      shingles. The camera needed no changes at all and the lift was deleted.

      **Measure before tuning.** Two fixes and four screenshots went into a
      hypothesis that one print statement disproved.

- [ ] **Camera clips inside the house and shrubs.** Standing anywhere near the
      house puts the camera through a wall or into a bush, and you end up
      looking at the inside of brick. Wants the usual treatment: cast from the
      aim point back toward the desired camera position and pull in to the
      first hit, so it slides along the wall instead of entering it. Turned up
      constantly while spawning at `?at=` coords near the house (see
      `SPAWN_AT` in `main.js`) — it's the main thing making close-quarters
      inspection painful.

- [x] **Pine bark read as grey stone blocks / bricks.** Filed as too regular
      and too grey; raised again 2026-07-30 once every forest pine started
      sharing the texture rather than just the two hero trees.

      Fixed by throwing the structure away rather than tuning it.
      `makeBarkTextures` no longer draws plates at all — it's a Voronoi field
      (jittered seed grid, per-pixel nearest and second-nearest), so plates are
      irregular polygons meeting at three-way junctions and *cannot* line up
      into courses because there are no courses.

      **The instructive failure:** an intermediate version kept the rectangle
      lattice but added wobbled polygon edges, far more size variation and
      much warmer colour. It was still unmistakably bricks. A rectangle with
      its corners moved is a rectangle, and a grid of them is a wall — the
      wobble was a few pixels on plates up to 90 wide, so it was invisible.
      Structure, not parameters.

      Two things on top of the raw Voronoi and both are load-bearing: the
      lookup is domain-warped first (straight cell walls read as a tiled
      floor), and the fissure width is its own noise field, so furrows pinch
      and open along their length instead of being even mortar. Colour is warm
      and per-plate, spanning fresh cinnamon to weathered grey-tan.

      Costs ~77 ms per texture against maybe 10 ms before, and it's built
      three times (once shared by the whole forest, once per hero pine), so
      roughly +200 ms on load.
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
