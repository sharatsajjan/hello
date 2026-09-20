# Arrows — Maze Puzzle

A browser-based clone of the [Arrows](https://arrowsgames.io/) maze puzzle game.
Procedurally generated arrow-textured mazes: trace a path from the start dot to
the gem, using hints (water drops), themes, and level progression.

## Play

Just open `index.html` in a browser, or serve the folder statically:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

Jump straight to a specific level with `?level=170` (e.g. to reproduce the
"Level 170 — Super Hard" reference screenshot).

## How to play

- Drag from the start dot along open corridors to the glowing gem.
- Difficulty and maze size scale with the level number (Easy → Super Hard).
- Tap the lightbulb to spend a water drop and reveal the path to the goal;
  tap it again when empty to "watch an ad" for a bonus drop.
- Use the palette icon to switch color themes, and the gear icon for sound
  and progress settings.

## Files

- `index.html` — markup and screens (level select, game, overlays)
- `style.css` — theming and layout
- `app.js` — maze generation (recursive backtracker), rendering (canvas),
  input handling, and game state (persisted to `localStorage`)
