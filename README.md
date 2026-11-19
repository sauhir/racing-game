# Pocket Drifters

A top-down arcade racing game for the browser, rendered with WebGL (Three.js).
Slide through corners to charge your boost, grab mystery boxes for weapons, and beat five
CPU rivals over three laps.

Everything is procedural: cars, track and scenery are built from geometry in code,
and all sound effects and music are synthesised with WebAudio. There are no asset files.

## Controls

| Key | Action |
|---|---|
| `↑` `↓` `←` `→` or `W` `A` `S` `D` | Accelerate, brake/reverse, steer |
| `Space` | Handbrake: kick the car into a drift (drifting charges boost) |
| `Shift` | Boost |
| `E` (or `X` / `Ctrl`) | Use the item from a mystery box |
| `R` | Put the car back on the road |
| `Esc` / `P` | Pause |
| `M` | Mute |
| `Enter` | Start / restart |

## Items and damage

Drive through a mystery box to get one item; cars further back get stronger ones.

| Item | Effect |
|---|---|
| Missile | Follows the road and homes in on the car ahead; the blast spins it out |
| Mine | Dropped behind you; explodes under the next car to touch it |
| Oil slick | Dropped behind you; cars that cross it slide out of control for a moment |
| Shield | Bubble that absorbs one hit and shrugs off crashes |
| Shockwave | Shoves and rattles every car close to you |
| Nitro | Fills the boost meter |

Weapons and hard crashes cost health. A damaged car smokes and loses a little top speed; at
zero it blows up and is back on the road two seconds later, fully repaired. Boxes sometimes
repair a damaged car instead of giving an item.

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests, including full headless CPU races
npm run typecheck
npm run lint
npm run build      # static build in dist/
```

Pushes to `main` are built, tested and deployed to GitHub Pages by
`.github/workflows/ci.yml` (enable Pages with source "GitHub Actions" in the repository settings).

## Layout

- `src/sim/` — the game simulation, with no rendering dependencies: car physics
  (`car.ts`, all handling tunables in `TUNING`), collisions, the spline-based track,
  race rules, items, weapons and damage, and the CPU drivers (`ai/driver.ts`). Runs at a fixed 60 Hz.
- `src/render/` — Three.js scene, chase camera, procedural car and track meshes, particles and skid marks.
- `src/audio/` — synthesised engine, tyres, impacts and a generated music loop.
- `src/ui/` — HTML/CSS HUD, minimap and menus.
- `src/data/` — track definitions and rival personalities.
- `tests/` — Vitest specs for the simulation.

## Roadmap

1. **Core race** (done): one track, drift handling, boost, CPU rivals, laps, HUD, audio.
2. **Combat** (done): mystery boxes, six items, car damage and respawns.
3. **Content**: beach, city, snow and desert tracks, more cars, seeded random tracks, quick-race options.
4. **Career**: tiered cups, prize money, upgrades and car unlocks saved in the browser.
5. **Polish**: balance, performance and settings.
