# Work queue

Ideas parked for later, in the order they came in. Kept as a file so it
survives context compaction and long sessions.

Add with `queue: <idea>` in chat — that means "park it, don't derail".

## Open

- [ ] **Calling Darla still walks her through the fire pit.** Reported
      2026-07-31, after the 2026-07-30 fix that claimed to close it. That fix
      was committed **unverified** (the pane was hidden, so her AI couldn't be
      driven) and it does not work.

      **Diagnosed, not yet fixed.** Calling her sets `darlaFetchState =
      'returning'`, so she goes through `updateDarlaFetch` — which *is* one of
      the three paths the push-out was added after, so the wiring is right.
      The bug is the exemption: the push-out is skipped when
      `insideFirePit(darla.position)` is true, and she can **tunnel into that
      state in a single frame**. `FIRE_PIT_INSIDE` is only 0.08 smaller than
      `FIRE_PIT_CLEARANCE`, and at her run speed one frame at 60fps carries
      her about 0.083 m — so she steps from just outside the blocked radius to
      inside the "already in, leave her alone" radius in one move, is exempted
      from then on, and strolls through the fire.

      This is the same hysteresis gap that's written up in the Done section
      for the *player*, where 0.08 was chosen to stop a boundary point
      re-measuring as inside. It is big enough for that and far too small to
      survive a moving character.

      **Fix:** drop the already-inside exemption for her commanded paths
      entirely. It exists so a player who jumped in can walk out — Darla
      never legitimately starts inside during fetch/cheese/leash, so she
      should be pushed out unconditionally. Keep the airborne exemption.

- [ ] **"Everywhere walkable" isn't, and the reason is that the map has no
      corners.** Reported 2026-07-31: can't reach the corner of the map.

      The world is a **disc**, not a square. `clampToWorldRadius` pulls the
      player back to a circle of radius `MOVEMENT_RADIUS` (now 54), and
      generation is a disc of `WORLD_RADIUS` 55 — so the far corners of what
      looks like a square map simply do not exist. Raising the clamp cannot
      fix this; there is nothing out there to stand on.

      Two honest options, and they cost very differently:

      1. **Square the world.** Generate to a box rather than a radius and
         clamp to the box. Corners at radius 55*sqrt(2) = 78 means roughly
         *twice* the generated area, and grass is ~97% of world-build time —
         so expect the load to go from ~6s to well over 10s unless density
         falls off much harder with distance.
      2. **Make the disc read as the intended shape** — fog, a treeline or
         terrain that closes the view before the boundary, so the edge is
         never somewhere you want to walk to. Costs nothing.

      Worth deciding which is actually wanted before building either. The
      pond is at radius ~51 and the outer ring past it is already bare (grass
      fades by 44, terrain flattens past 52), so option 1 also needs content
      to justify itself.


- [x] **The hidden watery oasis is built.** Spring, stream and pond in the
      far corner, with nothing pointing at it.

      **The terrain reversed the design, and the queue note here was wrong.**
      It claimed that corner is the high end of the lot. It isn't: the graded
      pad is dead flat out to `TERRAIN_PAD` and the dome falls away past it,
      so the corner sits ~1.7 m *below* the yard — 2.40 at the tree line down
      to 0.70 in the hollow over about nineteen metres. Measuring it settled
      an argument that two rounds of reasoning had got backwards. So the water
      runs downhill *into* the corner (the original idea) and the spring is
      simply where it surfaces at the top of that slope. Both halves survive.

      **The pond needed three radii, not one.** On a slope falling 0.15 m/m,
      any circle has a rim over a metre out of level. First attempt feathered
      the dig by radius and left the uphill bank standing inside the water
      disc. Second put the rim exactly at water level, which measured as the
      pond standing 5 cm proud of its own bank. It now cuts a dish to
      `POND_BED` (3.9) that is wider than the water at `POND_DISC` (3.4), with
      the rim set to the lowest natural ground on that ring — the dig only
      lowers, so the downhill side is what the water level has to respect.
      Measured after: rim dead level at 0.25 the whole way round, water at
      0.17, bed fully submerged, 0.77 m deep in the middle.

      Everything else reads off the same two shapes: grass stops at the
      waterline (0.15 m), trees and brush keep out (1.2 m / 1.5 m), the brush
      band opens a ~1.5 m gap where the stream crosses it, and `canopyShade`
      lets the glade back into daylight with trees excluded from its middle so
      the opening is real rather than a bright patch under a closed canopy.

      `terrainHeight` runs millions of times a load, so `waterCarveAt` rejects
      on a bounding box first: 6.2 ms/200k calls away from the water against
      76.6 inside it.

      **Nobody has seen it.** The browser pane was hidden all night, so every
      check above is arithmetic. The water *material* especially — a flat
      translucent standard material — is a placeholder that wants a real look.

- [ ] **Optimize - 30fps in a normal browser window, 60fps in the preview
      pane, same machine.** Confirmed by the owner 2026-07-31 after the
      measurements below. Parked, not abandoned.

      **The gap between those two environments is the entire lead.** The game
      itself measures fine: worst view is 7.7 ms against a 16.7 ms budget for
      60fps, better than 2x headroom, with the counter reading 60/59
      everywhere in the pane.

      | view | ms | calls | tris |
      |---|---|---|---|
      | mid-yard facing house (worst) | 7.7 | 458 | 10.2 M |
      | on the roof | 6.6 | 487 | 9.2 M |
      | mid-yard facing woods | 5.8 | 410 | 7.4 M |
      | at the pond | 3.6 | 326 | 3.8 M |
      | inside the woods | 3.0 | 334 | 4.0 M |
      | front, across the road | 2.7 | 309 | 1.9 M |

      Two theories are already dead, so do not spend time on them again:

      - **Not fill-bound.** 16x the pixels (pixelRatio 0.75 to 3.0, 197k to
        3.16M - more pixels than a 1080p window) moved the frame 3.9 to
        4.5 ms. Grass overdraw, the alpha-tested foliage and the post chain
        are all cleared.
      - **Grass is a third of it, not the wall.** 100% to 0% density takes the
        worst view 7.7 to ~5.4 ms and 10.2M triangles to 2.0M. Worth having,
        won't double anyone's frame rate.

      **Prime suspect: the two environments are not on the same GPU.** This is
      a laptop with an RTX 2070 Max-Q *and* integrated graphics. The preview
      pane was verified running on the NVIDIA card - `ANGLE (NVIDIA GeForce
      RTX 2070 with Max-Q Design, Direct3D11)`. If the owner's normal browser
      is on the Intel iGPU that is a 5-10x difference on its own and explains
      the whole thing without any of it being the game's fault.

      **Check that first, it takes a minute:** in the slow window, open
      devtools and run

          const gl = document.createElement('canvas').getContext('webgl2');
          const d = gl.getExtension('WEBGL_debug_renderer_info');
          gl.getParameter(d.UNMASKED_RENDERER_WEBGL);

      If it says Intel, the fix is a browser/driver setting (force high
      performance GPU), not a code change. If it says NVIDIA, then something
      else really does differ - compare `gameDebug.benchRender(40)` in both
      windows and the numbers will say whether it is render cost or the rest
      of the frame loop.

      Also worth ruling out: whether the slow window is running the deployed
      GitHub Pages build rather than the dev server, and whether a second
      copy of the game is open in another tab competing for the GPU.

- [x] **Chimney and hammock both have collision.** Chimney:
      `HOUSE_CHIMNEY` + `pushOutOfChimney`, deliberately outside
      `HOUSE_SOLIDS` since that list is skipped while `onRoof`. Hammock:
      `HAMMOCK` + `pushOutOfHammock`, an *oriented* box — it's 3.4 m long and
      turned 0.4 rad, so a world-axis box would either miss the ends or be far
      too big. Both axis-separated so she slides rather than sticking.
      Verified by simulation: 28,800 and 36,000 steps from 720 approach
      angles, zero breaches each.

      The hammock one needed an exemption that isn't obvious: it's skipped
      while `mirandaLoungeTarget` or `mirandaLounging`. Clicking the hammock
      walks her to its *centre*, which is exactly the point the collision
      pushes her off — without the exemption she'd be shoved away before
      arriving and could never get in at all.

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

      **Re-raised 2026-07-31.** Group this with the hammock-entry item below
      and the sit poses — all three are the same job (drive the limbs
      directly instead of running a cycle) and doing them together means
      building the posing helper once.

- [ ] **Getting into the hammock should show her climbing in, then go
      first-person.** Currently `enterHammockLounge` teleports her from
      standing beside it to lying in it in a single frame, and the camera cuts
      to the lying view at the same instant. Wants two beats: an actual
      get-in animation — sit on the edge, swing the legs up, settle back —
      and only *then* the camera easing into first person at her head looking
      up at the sky.

      The first-person-looking-up part already works (that half was built and
      verified); what's missing is the transition into it. The camera move
      wants to be a smooth ease from wherever the third-person camera was,
      not a cut — the cut is most of why the current version reads as a
      teleport.

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
- [x] **Back patio lights glow at night.** The two flush dome fixtures on
      the covered patio are in `lampSpots` now. They were the only lamps whose
      glass lit up but which cast nothing, so the one part of the back people
      stand under stayed pitch black with two glowing beads on its ceiling.
      Hung 0.2 m below the dome — a point light level with the ceiling puts
      half its sphere inside the soffit.
- [x] **Roof bar — found it, and it was the core front-wall band after
      all.** (That had been "ruled out" previously; the earlier pass was
      wrong.)

      The soldier course under the eave ran the full 15.3 m width on both the
      street and garden faces. On the street side the elevation is entirely
      made of masses standing *in front of* the core — east end, bay, garage —
      and they tile the whole width between them. The only exposed bit of core
      front face is the entry alcove, which is a recess rather than a
      projection: 1.22 m of the 15.3. The other **14.1 m was brick band sealed
      inside the building**, and buried geometry shows through the first seam
      it finds. Directly above the arched windows is exactly where the bay's
      hip crosses the main roof.

      Also fixed on the same line: the garden-side band spanned the porch
      notch, so 6.1 m of it was hanging in open air above the patio.

      **Not visually confirmed** — the browser pane was hidden, so no
      screenshot. But removing geometry that is provably inside a wall is
      right whether or not it turns out to be the bar.

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


- [x] **Dialogue options menu removed.** Clicking Darla plays the next
      exchange straight away. `DIALOGUE_TREE` is kept as the source and
      flattened depth-first rather than being rewritten by hand, because the
      order it encodes is the joke — "Hi Bubby", "Who's a good girl?", "Yes
      you are!", with the bark getting longer each time — so repeated clicks
      escalate the way picking the obvious answer used to, then loop.
      `openDialogueMenu`, `dialogueStarted` and the now-dead `onReplyShown`
      callback are gone; `#dialogue-menu` is left unused in index.html so
      putting it back is small.

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

- [x] **Darla no longer walks into the fire pit when called.** One
      push-out after her three commanded paths run, rather than three inside
      them — a fourth path added later gets it for free. Same two exemptions
      the player gets (airborne, already inside).

      Note the original filing was wrong about the bite chase: that only sets
      `moveTarget`, which does go through `clampToWalkable`, so it was never
      affected. Only fetch/cheese/leash write position directly.

      **Not runtime-verified** — driving her AI needs the game loop, which
      needs rAF, which is paused while the browser pane is hidden. It is a
      direct mirror of the `pushOutOfFirePit` call Miranda's walk already
      had.

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
