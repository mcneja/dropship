# Dropship

Top-down 2D Web-game of planetary exploration, enemy encounters, and extraction.

## Requirements

- Node.js 18+ recommended
- `npm`

## Install

```bash
npm install
```

## Run

Development server:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Project Layout

- `index.html`: page shell, canvases, HUD, and UI styles
- `src/main.js`: app bootstrap
- `src/loop.js`: main gameplay loop, physics, combat, UI updates
- `src/rendering.js`: WebGL2 renderer
- `src/planet.js`: terrain runtime, fog, and terrain edit coordination
- `src/planet_ring_mesh.js`: radial mesh and fog evaluation
- `src/navigation.js`: radial graph pathing and line-of-sight helpers
- `src/enemies.js`: enemy spawning and AI
- `src/input.js`: keyboard, mouse, touch, and gamepad input
- `src/perf.js`: benchmark and performance toggle helpers

## Development Notes

- Map generation for each planet is performed a standard square grid that it translated to a radial grid
- Terrain traversal and navigation use the radial graph, not the raw mapgen grid sampling.
- Rendering code belongs in `src/rendering.js`.
- Gameplay/state code belongs in `src/loop.js`.
- The repo uses ES modules, `// @ts-check`, and JSDoc types instead of TypeScript.

## Benchmarking And Perf Checks

Benchmarking mode can be enabled via query-params in the URL, example:

    `https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3`

Behavior:

- `bench=1` starts a timed benchmark automatically
- benchmark mode skips save restore and does not write save data
- the dev HUD is enabled automatically
- benchmark state appears on the last HUD line as `perf recording: pending`, `active`, or `done`
- final results are logged to the browser console as a `[Bench] Result` group and `console.table`
- the last result is also exposed as `window.__dropshipBenchLast`

Default timing:

- warmup: 3 seconds
- measured run: 20 seconds

Useful benchmark params:

- `bench=1`
- `bench_seed=1337`
- `bench_level=3`
- `bench_start=orbit` or `bench_start=docked`
- `bench_warmup=3`
- `bench_duration=20`

HUD frame-time metrics:

- `ft avg`: average frame time in ms
- `p95`, `p99`: frame-time percentiles
- `1%`: 1 percent low FPS
- `>16`: count of sampled frames slower than 16.7ms
- `max`: slowest sampled frame in ms

### Local Benchmark Example

Open the dev server with:

```text
http://localhost:5173/dropship/?bench=1&bench_seed=1337&bench_level=3
```

If your local Vite base path is just `/`, use:

```text
http://localhost:5173/?bench=1&bench_seed=1337&bench_level=3
```

### Public Baseline

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3
```

### Public Perf Toggle URLs

Baseline:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3
```

Cap DPR to 1:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_max_dpr=1
```

Disable MSAA:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_msaa=1
```

Disable fog sync/upload:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_fog=1
```

Disable dynamic WebGL overlay geometry:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_dynamic_overlay=1
```

Disable 2D overlay canvas:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_overlay_canvas=1
```

Disable HUD layout work:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_hud_layout=1
```

Disable enemy AI/pathing:

```text
https://spillz.github.io/dropship-testing/?bench=1&bench_seed=1337&bench_level=3&perf_disable_enemy_ai=1
```

### Comparison Workflow

1. Run the same `bench_seed`, `bench_level`, `bench_start`, `bench_warmup`, and `bench_duration` for every test.
2. Record the console-table output for baseline.
3. Run one perf toggle at a time.
4. Compare `avg_ms`, `p95_ms`, `p99_ms`, `low_1pct_fps`, and `max_ms`.
5. Use Chrome desktop and Chrome on Android for comparable traces.

## Controls

Basic controls:

- `LMB`: shoot
- `RMB`: bomb
- mouse wheel: zoom
- `0`: zoom reset
- `R`: restart / confirm play prompt

Common dev/debug shortcuts:

- `Alt+\`: toggle dev HUD
- `Alt+F`: toggle fog
- `Alt+V`: view map
- `Alt+I`: debug collisions
- `Alt+T`: planet triangle outline
- `Alt+Y`: collision contours
- `Alt+U`: miner guide path debug
- `Alt+G` / `Alt+H`: ring vertex debug
- `Alt+M`: regenerate map
- `Alt+N`: next level
- `Alt+Shift+N`: previous level
- `Alt+K`: jump to level
- `Alt+C`: copy screenshot
- `Alt+Shift+C`: copy clean screenshot
- `Alt+Shift+G`: copy title screenshot

## License

Copyright (C) 2026 James McNeill and Damien Moore

All code is shared under an MIT license.
