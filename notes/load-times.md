# Load-time measurements

Where the time goes when the page loads. Kept as a running log so later
measurements have something to compare against — a number on its own doesn't
say much, but a number next to last month's does.

**How these were taken:** temporary `performance.now()` marks around each
top-level construction call in `main.js`, plus accumulators inside
`createTreeChunk` / `createChunkGrass` in `yard.js`, printed after two
`requestAnimationFrame`s so the first rendered frame (and therefore shader
compilation) is included. Instrumentation is removed afterwards — it isn't
in the committed source.

**Read these as ratios, not absolutes.** Run-to-run variance on the same code
is large: the two runs below differ by 1.7x end to end. Machine load, GC
timing and browser JIT warmth all move it. What holds steady is the *shape*.

---

## 2026-07-28

Measured right after the lawn rebuild (five grass/weed species, pine needle
beds, clover colonies) and the per-chunk field-lattice optimisation.

| # | What | run A | run B |
|---|---|---|---|
| 1 | Grass — scatter loop | 3,647ms | 8,040ms |
| 2 | Grass — InstancedMesh build | 2,566ms | 3,947ms |
| 3 | First rendered frame (shader compile) | 1,900ms | 1,903ms |
| 4 | Module eval (Three.js + project) | 499ms | 560ms |
| 5 | Grass — field lattices | 119ms | 394ms |
| 6 | Trees (all 32 chunks) | 124ms | 171ms |
| 7 | 2 southern pines | 105ms | 126ms |
| 8 | createHouse | 52ms | 63ms |
| 9 | Lawn mesh + painted texture | 45ms | 73ms |
| 10 | createMom | 20ms | 31ms |

Tail under 20ms: fire pit, driveway + road, Darla, starfield/moon/sun sprites.

Totals: **9,133ms** (run A) and **15,381ms** (run B).
`generateWorld` was 6,458ms / 12,565ms of that.

### What this says

- **Grass is 97% of world generation** — 6,333ms of 6,458ms in run A.
  Everything else in the entire scene combined is under 400ms.
- **Trees are essentially free** (124ms for the whole forest), which is
  counterintuitive given how many there are. They sit on a 3-unit grid;
  grass is on a 0.03-unit grid, so there are roughly 10,000x more candidate
  positions to consider. Density, not object count, is what costs.
- **Shader compile is a fixed ~1.9s** and barely moves between runs. It's the
  one large item unrelated to grass, and now the second-biggest single line.
- The **field lattices** sit at #5 having previously dominated — see below.

### How it got here

Earlier the same day this was **~39 seconds**, all of it in the grass scatter
loop. Two causes, both introduced by the lawn rebuild:

1. **Ordering.** The expensive field lookups (vigour, pine duff, wildness,
   clover, dandelion) had been placed *above* the cheap distance rejection,
   so they ran for all 360k positions of every chunk including the outer
   woods, where nearly all of them are discarded a few lines later. `pineDuff`
   was also being computed twice per position, since `lawnVigour` calls it
   internally. Reordering and threading `duff` through: **39s -> 22s**.

2. **Redundancy.** Those fields vary over metres while candidate positions sit
   3cm apart, so each evaluation recomputed a value nearly identical to its
   neighbour's — millions of times. Each field is now sampled once onto a
   0.4m lattice per chunk and read back with bilinear interpolation
   (`sampleChunkField` / `readChunkField` in `yard.js`). At 0.4m the lattice
   still resolves the finest octave any of them contains (~1.1m), so it is
   visually identical: **22s -> ~6s**.

For reference, before the lawn rebuild the scatter loop did only jitter,
exclusion and a distance check — no field lookups at all — so it was never
this expensive to begin with.

### Remaining levers

- `GRASS_SPACING = 0.03` is the only one of consequence. Going to 0.035 drops
  ~27% of loop iterations *and* ~27% of instances, hitting items 1 and 2
  together. It changes how the lawn looks, so it hasn't been touched.
- Item 2 (InstancedMesh build) is `Object3D` matrix composition per blade.
  Writing the matrices directly into the instance buffer, skipping the
  intermediate `dummy` object, would cut it without changing appearance.
- There's a **loading screen** in the queue ("Puppy Town", Darla drawing in
  as load progresses). At ~6s that's polish; at 39s it was a necessity.
