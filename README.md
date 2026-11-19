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
| `Esc` / `P` | Pause (then `Backspace` to quit to the selection screen) |
| `M` | Mute |
| `Enter` | Start / restart |

## Career

Three cups of four races each: Rookie, Pro and Champion. Later cups run tracks in reverse,
end on a generated circuit and field faster, sharper rivals. Each race pays points and
prize money; finishing a cup in the top three unlocks the next and pays a bonus.

Money goes on the garage: buy the Dart, Hopper and Hauler, and upgrade each car's engine,
tyres, armour and nitro through three levels. Upgrades are deliberately mild (a maxed engine
is 6% faster) and never touch grip, so the drifting feels the same in every car. Progress is
saved in the browser, including a cup that is part-way through.

## Tracks and cars

In a quick race, pick any track and any (stock) car; the choice is remembered.

| Track | Theme | Notes |
|---|---|---|
| Sunny Meadows | Meadow | The original circuit |
| Coconut Coast | Beach | Wide sweepers; sand off the road is slow |
| Frostbite Ridge | Snow | A little less grip everywhere |
| Dusty Gulch | Desert | Narrow canyon squeezes, wide bends, two jumps |
| Random circuit | Any | Generated from a seed; press `R` on the selection screen for another |

Every track has ramps to jump (no steering in the air; you fly over mines and oil), glowing
boost pads, and stretches of wider and narrower road.

| Car | Character |
|---|---|
| Bubble | Balanced all-rounder (the handling everything else is measured against) |
| Dart | Highest top speed, takes more damage |
| Hopper | Best acceleration and turn-in, slightly lower top speed |
| Hauler | Takes much less damage, a little slower |

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

## Gamepad

Any standard controller works alongside the keyboard, in menus and on track.

| Control | Action |
|---|---|
| Left stick (or d-pad) | Steer; navigate menus |
| RT / LT | Accelerate / brake and reverse |
| A | Handbrake; confirm in menus |
| X or RB | Boost |
| B or LB | Use item; back in menus |
| Y | Put the car back on the road |
| Start | Pause / resume |

## Settings

Main menu → Settings: music volume, effects volume, graphics quality (High, Medium, or Low
with shadows off and lower resolution) and a career reset. Each theme has its own generated
tune, with a calmer one for the menus.

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests, including full headless CPU races
npm run typecheck
npm run lint
npm run build      # static build in dist/
```

Every push is linted, type-checked, tested and built by `.github/workflows/ci.yml`. Pushes to
`main` and to the working branch `claude/affectionate-faraday-zn030o` are also deployed to
GitHub Pages. One-time setup in the repository on GitHub:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. If the deploy job is rejected, Settings → Environments → `github-pages` → Deployment
   branches: allow the branch being deployed.

The game is then served at `https://<owner>.github.io/racing-game/`.

## Layout

- `src/sim/` — the game simulation, with no rendering dependencies: car physics
  (`car.ts`, all handling tunables in `TUNING`), collisions, the spline-based track,
  race rules, items, weapons and damage, and the CPU drivers (`ai/driver.ts`). Runs at a fixed 60 Hz.
- `src/render/` — Three.js scene, chase camera, procedural car and track meshes, particles and skid marks.
- `src/audio/` — synthesised engine, tyres, impacts and weapons, and the step-sequenced tunes (`songs.ts`).
- `src/ui/` — HTML/CSS HUD, minimap and menus.
- `src/career/` — cups, points, prize money, garage and save handling (no rendering dependencies).
- `src/data/` — track definitions, car models and rival personalities.
- `tests/` — Vitest specs for the simulation.

## Roadmap

1. **Core race** (done): one track, drift handling, boost, CPU rivals, laps, HUD, audio.
2. **Combat** (done): mystery boxes, six items, car damage and respawns.
3. **Content** (done): four themed tracks, random circuits, jumps, boost pads, four cars, quick-race selection.
4. **Career** (done): three tiered cups, prize money, car purchases and upgrades, saved in the browser.
5. **Polish** (done): settings, gamepad support, a tune per theme.
