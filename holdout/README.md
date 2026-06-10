# HOLDOUT

A top-down tactical action game inspired by classic single-screen arcade strategy titles, rebuilt with a modern look. Original code and assets.

**The loop:** each level is one screen. Reach the glowing exit with your squad, or wipe out every enemy, before the timer runs out. Stranded characters are scattered around the field — walk into them to pick them up, then carry them to the exit to recruit them permanently. If your character is hit, they drop where they fell and become rescuable; finish the level without rescuing them and they're gone for good.

## Run it

```sh
npm install
npm start          # http://localhost:3000
npm test
```

- **Solo Campaign** — offline, autosaves progress in your browser.
- **Host Co-op** — get a 4-letter room code, friends open the same URL and join with it. Server-authoritative, saves per room (enter your old room code when hosting to resume).
- **Controls** — WASD/arrows to move, Space to fire. You shoot the way you face.

## Modding

### Add a level
Drop a JSON file in `levels/` — files load in alphabetical order, so name them `level04.json`, etc. Restart the server.

```json
{
  "name": "My Level",
  "time": 90,
  "captiveChars": ["sniper"],
  "tiles": ["####...", "..."]
}
```

Tile legend (all rows must be the same width):

| Char | Meaning |
|------|---------|
| `#`  | Wall — blocks movement and shots |
| `.`  | Floor |
| `~`  | Water — blocks movement, shots fly over |
| `E`  | Exit pad |
| `P`  | Player spawn (place several for co-op) |
| `c`  | Captive — assigned from `captiveChars` in reading order |
| `o`  | Cover obstacle — blocks movement, shots fly over |
| `g`  | Grunt — melee chaser, 2 HP |
| `a`  | Archer — stationary ranged turret, 1 HP |
| `r`  | Charger — telegraphs, then dashes |
| `s`  | Bulwark — shield blocks shots from the front |
| `m`  | Spawner — emits skitters and fires spores |
| `n`  | Sniper — shows an aim line before firing |
| `b`  | Command core boss — multi-HP phase enemy |

### Add a character
Add an entry to `shared/characters.json`:

```json
{
  "id": "medic", "name": "Medic", "color": "#80cbc4", "speed": 3.5,
  "starting": false,
  "weapon": { "name": "Stinger", "damage": 1, "projSpeed": 9, "range": 5,
              "cooldown": 0.4, "count": 1, "spreadDeg": 0, "overWalls": false }
}
```

- `speed` is tiles/second; `range` is in tiles.
- `count` + `spreadDeg` make a fan of shots (shotgun-style).
- `overWalls: true` makes shots arc over walls (mortar-style).
- `pierce` lets a projectile hit extra enemies; `aoeRadius` adds an explosion in tiles; `curve` bends a projectile; `radius` changes hit size; `kind` drives renderer/audio flavor.
- `starting: true` puts them in the roster from level 1; otherwise place them in a level as a captive (`c` + `captiveChars`) to make them recruitable.

### Architecture

```
shared/game.js   — the whole simulation, shared by server and browser
server.js        — static hosting + WebSocket co-op rooms + saves/
public/          — client: menus, renderer (canvas), input, netcode
levels/*.json    — level data
saves/           — co-op room saves (auto-created)
```

The server runs the sim at 30 Hz for co-op rooms; solo mode runs the exact same `game.js` locally at 60 fps. Anything you change in `shared/game.js` applies to both.
