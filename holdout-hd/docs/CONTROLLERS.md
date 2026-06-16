# Controllers, glyphs & in-place Batocera updates

This covers the controller experience (auto glyph detection + the remap
diagnostic), the fast in-place console content update, and the items that still
need the physical console / real hardware to finish and accept.

For the original Batocera setup (static build, `play.sh`, Ports entry) see
[`BATOCERA.md`](BATOCERA.md).

---

## Auto controller-type glyphs

The in-world prompts (`[hold E/X] BUILD …`) and the face-button glyphs adapt to
the controller the player is actually using. **Settings → Button prompts: Auto**
(the default) tracks the live device and resolves its type automatically:

| Detected pad | Source | Glyph set |
|---|---|---|
| DualSense (PS5) | id contains `dualsense` / `0ce6` | PlayStation (□ ✕ ○ △) |
| DualShock 4 (PS4) | id contains `dualshock` / `09cc` / `05c4` | PlayStation |
| Xbox / XInput | id contains `xbox` / `xinput` / `045e` | Xbox (A B X Y) |
| Switch / Pro / Joy-Con | id contains `switch` / `057e` | Switch |
| bare “wireless controller” | no vendor markers | PlayStation (usually Sony) |
| anything else | — | generic |

In the Electron/native lane the typed controller list comes from
`window.anchorfallDesktop.controllers()`; in a plain browser the type is inferred
from `navigator.getGamepads()[].id`. If a pad is wrapped as a generic XInput
device on the box and reads wrong, force the glyphs via **Settings → Button
prompts: PlayStation / Xbox / Switch**.

## Remap diagnostic (press-any-button / not-detected)

**Settings → Input Remapping** now shows a live **Controller Diagnostic** under
the per-action remap list:

* every connected pad appears as a row with its **slot → seat** mapping
  (`Pad 1 → seat gp0`) and the **auto-detected type** (DualSense / DualShock 4 /
  Xbox / Switch / Generic);
* each button cell **lights up** while that button is held, and a live **axes**
  readout shows stick/trigger values (highlighted past the deadzone);
* if no pad is found it says so and reminds you the keyboard seats always work.

Use it to confirm a pad is detected and to see which physical pad maps to which
seat before rebinding. Remap parity is unchanged: the **kb1**, **kb2** and **pad**
devices each rebind any action (listen-for-next-press, one-press reset per
device), and the diagnostic is additive on top.

## Visible frame-loop error surface

The render/tick loop is wrapped so a draw/sim exception can never freeze the
game. If one fires, a dismissible on-screen panel now appears (instead of a
silent stall) with the error message + stack and a *“press X / B / Esc to
continue”* hint. Input stays live and the loop keeps animating; the panel shows
**once per distinct error** so a recurring fault doesn’t spam.

---

## Fast in-place console content update (no AppImage rebuild)

When only the web game content/code changed (`public/`, `shared/`, `levels/`,
`server.*`, …) you don’t need a full electron-builder rebuild + reflash. Push the
source straight into the console’s unpacked AppImage payload:

```sh
# from holdout-hd/
scripts/console-update.sh --dry-run     # preview — changes nothing
scripts/console-update.sh               # apply to the default console
```

It rsyncs the repo (excluding `node_modules/`, `dist/`, `desktop/`, `.git/`,
`saves/`, logs) into:

```
<user>@<host>:/userdata/system/anchorfall/squashfs-root/resources/game/
```

Defaults target the documented dev console (`10.0.0.207`, user `root`); override
per run or via env:

| Flag | Env | Default |
|---|---|---|
| `-h, --host` | `CONSOLE_HOST` | `10.0.0.207` |
| `-u, --user` | `CONSOLE_USER` | `root` |
| `-d, --dest` | `CONSOLE_DEST` | `/userdata/system/anchorfall/squashfs-root/resources/game` |
| `-p, --port` | `CONSOLE_PORT` | `22` |
| `-n, --dry-run` | — | off |
| `--delete` | — | off (additive; pass to mirror/prune) |

Safety: `--dry-run` previews without touching the box, every step echoes what it
does, and `--delete` is **off by default** so an odd source can’t wipe the
target. After it runs, relaunch the game on the console (reopen the Ports entry
or restart EmulationStation) to load the new content.

---

## Needs the physical console / hardware (deferred from this pass)

These cannot be built or verified inside this repo — they need the physical
Batocera box (`10.0.0.207`) and/or real controllers, and are intentionally **out
of scope** for the code-only pass:

* **SDL sidecar build robustness** — building/hardening the native SDL sidecar
  used for pad input on the console (native compile, cross-arch prebuilds for the
  box’s architecture, runtime fallbacks). Needs the device toolchain + on-box
  testing.
* **libcups / system-lib bundling** — bundling `libcups` and the other system
  libraries the AppImage expects so it launches cleanly on a stock Batocera
  image. Needs the electron-builder release matrix + the box to validate the
  packaged AppImage actually runs.
* **PS5 / Xbox-on-console glyph + remap acceptance, 4-seat** — confirming, on the
  real console, that DualSense / DualShock 4 / Xbox pads detect with the right
  glyphs, that the diagnostic highlights the correct buttons, and that
  remapping + 4-seat couch co-op pass with four physical pads plugged in.

The code paths for these (auto glyph inference, the diagnostic, the in-place
updater) are complete and verified here; the above is the on-hardware
verification/acceptance that has to happen on the device.
