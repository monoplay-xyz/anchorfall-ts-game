# HOLDOUT // ISO

The pixel-art cyberpunk version of HOLDOUT: same simulation and co-op netcode as v1/HD, presented as isometric pixel art: a 2:1 diamond projection (560×320 native, upscaled 2× with crisp pixels) with depth-sorted sprites and walls drawn as raised blocks. Controls are screen-relative — pressing up walks up-screen; the 45° rotation into the world grid is handled by the client inside neon-teal terminal chrome with scanlines.

```sh
npm install
npm start          # http://localhost:3003
npm test
npm run gen-assets # rebuild public/assets/*.png from shared/characters.json
```

## UI

- **Operative panel** — pixel portrait, weapon, and HEALTH/SPEED/RANGE meters for your current character; switches automatically when you respawn as someone else.
- **Squad pool** — 16-slot grid showing every roster member's live status (READY / FIELD / DOWN / CARRY / OUT).
- **Game stats** — score, time, kills, and the current round.
- **Wallet panel** — cosmetic $MONO counter: 1 $MONO per 10 score, banked per cleared round in localStorage. Not connected to any real network.

## Art

All sprites and tiles are procedural pixel art first, then overridden from `public/assets/` when matching PNGs exist:

| File | Replaces |
|------|----------|
| `floor0.png` … `floor5.png` | 32×16 isometric floor diamonds |
| `wall0.png` … `wall2.png` | 32×34 raised wall blocks |
| `coolant.png` | 32×16 coolant diamond |
| `crate.png` | 32×25 raised cover block |
| `portrait_<charId>.png` | 24×24 operative portrait |
| `weapon_<charId>.png` | generated weapon icon source art |
| `enemy_<kind>.png` | 8×10 enemy sprite (`grunt`, `archer`, `charger`, `bulwark`, `spawner`, `sniper`, `skitter`, `boss`) |

Levels and characters are shared-format with the other versions — see `../holdout/README.md` for modding.
