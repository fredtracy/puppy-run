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
- [ ] **Miranda's model** — rebuild from the photos in
      `C:\Users\fredt\Desktop\temp\pics for claude\miranda`. Current model is
      very lacking.
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
- [ ] **Winged eyeliner is night-only.** Miranda goes bare-eyed by day and puts
      it on for the night. And since the day/night swap has a load pause, use
      that pause as a transition: her face, applying the wing, as the
      "loading" beat. Ties into the loading-screen item below.
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
- [ ] **Queue editing shouldn't prompt.** Writing `.claude/queue.md` still asks
      even though `Write(//c/inetpub/wwwroot/puppy-run/**)` should cover it —
      Claude Code may treat `.claude/**` as protected. Find the right rule.
- [ ] **Loading screen** — the bundle is big enough to need one. "Puppy Town"
      in a cute font, with Darla drawing in progressively as load progresses;
      when the fill reaches her tail she's fully loaded.
- [ ] **Roof bar** — dark bar on the roof above the arched windows. Confirmed to
      be `SOLDIER_MAT` geometry (magenta-tint test). Ruled out: roof vents,
      chimney (stucco), backface culling through the roof void, the core
      front-wall band, the bay side bands. Current theory: a seam in the main
      roof surface where the bay's hip crosses it, showing the back wall's band
      through. Needs one focused pass.

## Done

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
