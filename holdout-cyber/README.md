# HOLDOUT // CYBER

The pixel-art cyberpunk version of HOLDOUT: same simulation and co-op netcode as v1/HD, presented as chunky low-res pixel art (16px tiles rendered at 320×224, upscaled 3× with crisp pixels) inside neon-teal terminal chrome with scanlines.

```sh
npm install
npm start          # http://localhost:3002
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
| `floor0.png` … `floor5.png` | 16×16 floor variants |
| `wall0.png` … `wall2.png` | 16×16 wall variants |
| `coolant.png` | 16×16 coolant/water tile |
| `crate.png` | 16×16 cover obstacle |
| `portrait_<charId>.png` | 24×24 operative portrait |
| `weapon_<charId>.png` | generated weapon icon source art |
| `enemy_<kind>.png` | 8×10 enemy sprite (`grunt`, `archer`, `charger`, `bulwark`, `spawner`, `sniper`, `skitter`, `boss`) |

Levels and characters are shared-format with the other versions — see `../holdout/README.md` for modding.
