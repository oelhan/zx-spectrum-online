# Plan: ZX Spectrum in the browser

Goal: a website where people can play ZX Spectrum 48K games in the browser,
served from a container on hcode (HostAfrica).

Forked from [MikeDX/z80emu](https://github.com/MikeDX/z80emu) (remote `upstream`).

## Where the code is today

Things that already work:

- Z80 CPU (`src/cpu/z80core`, Adrian Brown's core). Alternatives are `z80emu` and `mz80`.
- 48K ROM boots, and the screen renders: pixels, attributes, bright and flash.
- Keyboard matrix input.
- `make PLAT=HTML` builds through Emscripten with SDL.

Things that block playing games:

| Gap | Where | Why it matters |
|---|---|---|
| No way to load games (no TAP, SNA, Z80 or TZX support) | `zxem.c` only loads the ROM and `.scr` screens | You can't play anything yet |
| Keyboard port decode uses register B and matches one row at a time | `zxio.c: input()` | Many games scan several rows at once (for example "press any key"), or read via `IN A,(n)`, so their input breaks |
| Every `OUT` calls `printf` | `zxio.c: output()` | Spams the browser console and slows it down badly |
| Border colour and beeper bits of port `0xFE` are ignored | `zxio.c: output()` | No border and no sound |
| No Kempston joystick (port `0x1F`) | `zxio.c` | Most games expect a joystick |
| Speed is tied to `emscripten_set_main_loop(..., 0, ...)` | `zxem.c` | Runs at the display refresh rate. That is 60 Hz instead of 50 Hz, so games run 20% fast (or faster on 120 Hz screens) |
| No audio backend | — | No sound |

## Architecture

```
Browser
┌───────────────────────────────────────────────────────────┐
│ index.html + app.js                                       │
│   UI: game picker, file drop, fullscreen, on-screen keys  │
│   requestAnimationFrame → run whole 50 Hz frames by clock │
│   canvas ← framebuffer (RGBA, 320x256 incl. border)       │
│   AudioWorklet ← beeper samples per frame                 │
│   keydown/keyup/Gamepad API → zx_key()/zx_joy()           │
│              │  small exported C API                      │
│              ▼                                            │
│ zxem.wasm (Emscripten, no SDL)                            │
│   zxem core + z80core CPU + loaders (TAP/SNA/Z80)         │
└───────────────────────────────────────────────────────────┘
              ▲  static files only
┌─────────────┴─────────────┐
│ Container on hcode         │
│ nginx:alpine, port 8080    │
│ /  /zxem.wasm  /games/*.tap│
└────────────────────────────┘
```

Key decisions:

- **Drop SDL for the web build.** Add a new `src/osdep/web.c` backend. The emulator exposes a
  plain C API and JavaScript owns the canvas, audio, input and timing. That means a
  smaller WASM file, no SDL main-loop quirks, and easy control over timing and audio.
  The native SDL builds stay in place for desktop debugging.
- **All emulation runs in the browser; the server only serves files.** The container
  is just nginx serving static files. Games a user loads from their own disk never leave
  their browser, and there is no backend to secure in v1.
- **Keep `z80core` as the CPU** (the current default). `make test` keeps covering `z80emu`.

### Exported C API (sketch)

```c
void     zx_init(void);                       // allocate, load ROM, reset
void     zx_reset(void);
void     zx_run_frame(void);                  // 69888 T-states + interrupt + render
uint8_t *zx_framebuffer(void);                // RGBA 320x256
int16_t *zx_audio(int *nsamples);             // beeper samples for last frame
void     zx_key(int zxkey, int down);
void     zx_joy(uint8_t kempston_bits);
int      zx_load(const uint8_t *data, int len, const char *ext); // tap/sna/z80
```

## Phases

### 0. Repo housekeeping
- [x] New local repo `zxspectrum-web`, upstream history kept, `upstream` remote
- [x] Add a NOTICE file crediting MikeDX, Adrian Brown and Lin Ke-Fong (licensing: see Risks). Our own work is MIT (LICENSE)
- [ ] Remove things the web project doesn't need: `Win32/`, `Z80Emu_VS2015/`, `Makefile.nmake`,
      SDL submodules, `mz80` (licence restricts commercial use)
- [ ] Create the remote (GitHub or wherever hcode deploys from) and push

### 1. Headless WASM build that boots
- [x] `src/osdep/web.c` with the exported API above. Move the main loop out of `ZX_main` so
      JavaScript calls `zx_run_frame()`
- [x] Makefile `PLAT=WEB`: `emcc -O3 -s MODULARIZE=1 -s EXPORTED_FUNCTIONS=... -s ALLOW_MEMORY_GROWTH=0`,
      ROM embedded with `--embed-file` (16 KB)
- [x] Minimal `web/index.html` and `app.js`: canvas, a 50 Hz accumulator on `requestAnimationFrame`
- [x] **Done when:** the browser shows "© 1982 Sinclair Research Ltd" at the correct speed and BASIC accepts typing

Phase 1 notes: `make docker-web` builds without a local emsdk, and `make test-web` boots the ROM in Node.

### 2. Make the hardware behave like a Spectrum
- [x] Port `0xFE` read: decode on A0=0 and AND every keyboard row whose high-byte bit is 0;
      bit 6 = EAR, bits 5 and 7 set
- [x] Port `0xFE` write: border colour (bits 0–2) and beeper (bit 4). Remove the `printf`s
- [x] Border rendering (320x256 output)
- [x] Kempston joystick on port `0x1F`. Unmapped ports return `0xFF` (floating bus can come later)
- [x] Fix `writeword` writing a byte into ROM at `0x3FFF`

Phase 2 notes:
- Both CPU cores now pass the full 16-bit port to `input()`/`output()`. z80emu used to
  pass only the low byte.
- The border is one colour per frame. Per-scanline border changes (loading stripes,
  border effects) need T-state timestamps and are deferred.
- The page has an "Arrow keys: cursor / Kempston" selector, with Tab as fire.
- `make test-web` checks Kempston, multi-row keyboard reads and the border colour.
- z80emu doesn't run the ROM reliably: BASIC stops responding after the first command,
  and this happened before phase 2 too. Use z80core (the default) for the website.
  z80emu stays only for `make test`.

### 3. Load games
- [x] `.sna` (48K) and `.z80` (v1 compressed, plus 48K-mode v2/v3)
- [x] `.tap` with a ROM trap on `LD-BYTES` (`0x0556`) for instant loading. Auto-type `LOAD ""`
- [x] `.tzx` (standard-speed blocks through the same trap). Turbo loaders can come later
- [x] JavaScript: file picker, drag-and-drop, `?game=<url>` query parameter
- [x] **Done when:** a known freeware TAP, SNA and Z80 each load and are playable

Phase 3 notes:
- `src/zxem/zxload.c` handles snapshots and the dispatcher. `src/zxem/zxtape.c` handles tapes.
  Both are also used by the native build (`./zxem game.tap`).
- Inserting a tape resets the machine, runs the ROM boot without waiting in real time,
  and types `LOAD ""`. Every ROM load (multi-part games included) is served
  instantly from the tape image through the trap in `readbyte()`.
- Games with custom or turbo loaders don't call the ROM's LD-BYTES, so they won't
  load from TAP/TZX. Their `.z80`/`.sna` versions work. Fixing this means real
  EAR-bit tape playback (phase 7).
- The tape trap needs z80core, because z80emu doesn't expose the live PC.
- `tests/web/loaders.cjs` builds its own TAP, TZX, SNA and Z80 (v1 and v3) files and
  checks they run. With a directory argument it also writes them out for manual tests.
- Real games were tried in the browser by hand on 2026-11-13 and load and play.

### 4. Sound
- [x] Record beeper level changes against T-state timestamps during a frame, then resample to 44.1/48 kHz
- [x] AudioWorklet with a small ring buffer. Use the audio clock as the master timer so sound doesn't crackle
- [x] Mute toggle, and resume the AudioContext on first user gesture (browser autoplay rule)

Phase 4 notes:
- `src/zxem/zxsound.c` turns each EAR/MIC change on port `0xFE` into samples at the
  AudioContext's rate. Each sample averages the speaker level over its slice of time,
  and a 10 Hz DC blocker centres the wave. MIC is mixed in quietly.
- `web/beeper.js` is the AudioWorklet. It waits for 60 ms of samples before playing,
  fades out if it runs dry, and drops the oldest samples past 250 ms.
- Sound starts on the first click or key press. While it plays, frames are timed from
  `AudioContext.currentTime`, so emulation and audio can't drift. With sound off, the
  page goes back to `performance.now()`. The Sound on/off choice is kept in `localStorage`.
- CPU timing fixes found while testing pitch:
  - z80core didn't count the 4 T-states of an I/O cycle, so every IN and OUT was short.
  - The interrupt's T-states weren't counted towards the frame, so the emulator ran 0.03% fast.
  - z80core bugs: `OUT (C),D` sent C, `IN E,(C)` loaded D, and `IN r,(C)` set no flags.
- `tests/web/sound.cjs` checks sample count, the pitch of a known square wave, and that
  the ROM's `BEEP 1,0` plays middle C (261.6 Hz).
- Checked in headless Chromium: audio starts on a key press, 48000 samples a second
  reach the worklet, and muting suspends the AudioContext. Listening on real speakers is
  still a manual check.

### 5. Website
- [x] Landing page with a game library from `games/manifest.json` (title, author, cover, file, controls)
- [x] Integer scaling with crisp pixels (`image-rendering: pixelated`), fullscreen, pause and reset
- [x] Key mapping: PC keys to the Spectrum matrix (Backspace = CAPS+0, arrows = cursor/Kempston)
- [x] Gamepad API to Kempston
- [x] Touch: on-screen d-pad and fire, plus a pop-up Spectrum keyboard for mobile
- [x] Save states in `localStorage` (snapshot of RAM and registers)
- [ ] Add games to the library (needs games whose authors allow sharing; see `games/README.md`)

Phase 5 notes:
- The page is split into ES modules:
  - `app.js`: frame loop, loading, library, pause, fullscreen, save states.
  - `input.js`: keyboard, joysticks, gamepad, touch and the on-screen keyboard.
  - `sound.js`: audio.
  - `settings.js`: guarded `localStorage`.
- Joystick choices are none, Kempston, Sinclair (Interface 2) and cursor:
  - With a joystick selected, the arrow keys and Tab drive it, and so do gamepads and the touch d-pad.
  - With none selected, the arrows are cursor keys, and gamepads and the d-pad act as a cursor joystick.
  - A library entry can pick the joystick for its game.
- Save states are compressed `.z80` v1 snapshots (`ZX_SaveZ80`), one per game in `localStorage`,
  with the tape position stored next to them. Restoring keeps the inserted tape.
  FLASH phase isn't saved, which `.z80` v1 can't hold.
- Keys go to a hidden text field that keeps focus, so extensions like Vimium leave them alone.
  Touch screens skip this, so no system keyboard pops up.
- Modifier sync: every key event's shift, ctrl and alt flags release a Shift, Ctrl or Alt that
  was let go while the page wasn't looking.
- On-screen keyboard: Caps and Sym latch until the next key, and taps are held at least 60 ms
  so the ROM's keyboard scan sees them.
- `tests/web/state.cjs` checks save states: RLE edge cases, round trips, and keeping the tape.
- Checked in headless Chromium (desktop, and a 390px phone with touch). All 27 checks passed:
  the library (titles as text, bad entries skipped, missing files reported), `?game=` links,
  Kempston from the keys, modifier sync, save and restore, pause, the on-screen keyboard,
  the d-pad, and no sideways scroll on a phone. Real gamepads and real phones are still manual checks.

### 6. Container and hcode deployment
- [x] Multi-stage `Dockerfile`:
      stage 1 `emscripten/emsdk:3.1.74` → `make PLAT=WEB` and `make test-web`;
      stage 2 `nginxinc/nginx-unprivileged:1.27-alpine` serves `dist/` on `$PORT` (default 8080) as non-root
- [x] nginx config: `application/wasm` MIME type, gzip, `/healthz`
- [x] CI: build, `make test`, a headless boot test, and build the image on every push
- [x] Deploy to an hcode container (running since 2026-11-13)
- [ ] Point our own domain at it

Phase 6 notes:
- hcode builds with Railpack by default, which can't detect this project. Settings that work:
  - **Build mode:** Dockerfile (Settings > Build configuration > Build type)
  - **Dockerfile path:** `./Dockerfile`
  - **Runtime port:** 3000 (any port works, since nginx listens on `$PORT`)
  - **Start command:** empty
- An old start command (`python3 -m http.server ...`) made the container exit with code 127,
  because the nginx image has no Python. Clearing the start command fixed it. If a start
  command is ever required, use `/docker-entrypoint.sh nginx -g "daemon off;"`.
- hcode sets `PORT` to the runtime port. nginx's template step writes it into the config on
  start (`docker/nginx.conf.template`).
- No file names are versioned, so everything is served with `Cache-Control: no-cache`.
  Browsers revalidate, and unchanged files cost a 304.
- Security headers include a Content-Security-Policy. It needs `'wasm-unsafe-eval'` for the
  emulator, and `connect-src https:` keeps `?game=` working for other CORS-enabled sites.
- GNU make finds the `/emsdk/node` directory on PATH before the real node, so the
  Dockerfile runs `make test-web NODE="$(command -v node)"`.
- Checked locally:
  - The image builds, and the web tests pass inside the build.
  - With `PORT=9123`: `/healthz` returns 200, `.wasm` is served as `application/wasm` with gzip,
    and nginx runs as uid 101.
  - In headless Chromium against the container: the emulator boots under the CSP, a tape loads
    through the file picker, the audio worklet runs, and there are no console errors.
- CI:
  - `.github/workflows/web.yml` builds the image on each push and PR, then runs it and checks
    `/healthz`, the page and the wasm content type.
  - `build.yml` (native SDL builds and `make test`) now runs on `main` too.

### 7. Later
- 128K models plus AY-3-8912 sound (a big step up in the game library)
- Memory contention for timing-sensitive demos and multicolour effects
- Turbo TZX loaders through real EAR-bit tape emulation
- Optional backend for user accounts, high scores and cloud saves

## Testing
- Keep `make test` (CPU instruction tests).
- Add a Node test that loads the WASM, runs N frames from reset, and compares a hash of
  screen memory with a known-good value. Do the same for each loader with a freeware test file.
- Manual browser checklist: Chrome, Firefox, Safari, and mobile Safari/Chrome.

## Risks and open questions
1. **Licensing (decided: proceed).** Upstream's README describes ZXEMU as "free open
   source", and we're relying on that. Keep the credits for MikeDX, Adrian Brown (z80core)
   and Lin Ke-Fong (z80emu) in a NOTICE file and on the site. Our own work is under MIT
   (LICENSE), and NOTICE says which parts it doesn't cover. Upstream still has no
   licence file, so optionally open a GitHub issue asking MikeDX to add one.
   `mz80` gets removed, since its licence restricts commercial use.
2. **Game copyright.** Amstrad lets emulators distribute the 48K ROM. Games are a
   different matter. Host only titles whose rights holders allow distribution (ZXDB/Spectrum
   Computing marks these) or homebrew titles with permission. Let users load their own files locally.
3. **hcode specifics still to confirm:** does it build from a Dockerfile in git, or pull
   a pre-built image from a registry? Which port and health check does it expect? How are
   custom domains and TLS set up?
4. **Emulation accuracy.** Without contention and floating-bus emulation, a small number
   of games and demos will misbehave. That is acceptable for v1.
