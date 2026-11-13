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
| No LICENSE file in the repo | — | Must be sorted out before hosting publicly (see Risks) |

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
- [ ] Settle licensing (see Risks), then add LICENSE and NOTICE (credit MikeDX, Adrian Brown, Lin Ke-Fong)
- [ ] Remove things the web project doesn't need: `Win32/`, `Z80Emu_VS2015/`, `Makefile.nmake`,
      SDL submodules, `mz80` (licence restricts commercial use)
- [ ] Create the remote (GitHub or wherever hcode deploys from) and push

### 1. Headless WASM build that boots
- [ ] `src/osdep/web.c` with the exported API above. Move the main loop out of `ZX_main` so
      JavaScript calls `zx_run_frame()`
- [ ] Makefile `PLAT=WEB`: `emcc -O3 -s MODULARIZE=1 -s EXPORTED_FUNCTIONS=... -s ALLOW_MEMORY_GROWTH=0`,
      ROM embedded with `--embed-file` (16 KB)
- [ ] Minimal `web/index.html` and `app.js`: canvas, a 50 Hz accumulator on `requestAnimationFrame`
- [ ] **Done when:** the browser shows "© 1982 Sinclair Research Ltd" at the correct speed and BASIC accepts typing

### 2. Make the hardware behave like a Spectrum
- [ ] Port `0xFE` read: decode on A0=0 and AND every keyboard row whose high-byte bit is 0;
      bit 6 = EAR, bits 5 and 7 set
- [ ] Port `0xFE` write: border colour (bits 0–2) and beeper (bit 4). Remove the `printf`s
- [ ] Border rendering (320x256 output)
- [ ] Kempston joystick on port `0x1F`. Unmapped ports return `0xFF` (floating bus can come later)
- [ ] Fix `writeword` writing a byte into ROM at `0x3FFF`

### 3. Load games
- [ ] `.sna` (48K) and `.z80` (v1 compressed, plus 48K-mode v2/v3)
- [ ] `.tap` with a ROM trap on `LD-BYTES` (`0x0556`) for instant loading. Auto-type `LOAD ""`
- [ ] `.tzx` (standard-speed blocks through the same trap). Turbo loaders can come later
- [ ] JavaScript: file picker, drag-and-drop, `?game=<url>` query parameter
- [ ] **Done when:** a known freeware TAP, SNA and Z80 each load and are playable

### 4. Sound
- [ ] Record beeper level changes against T-state timestamps during a frame, then resample to 44.1/48 kHz
- [ ] AudioWorklet with a small ring buffer. Use the audio clock as the master timer so sound doesn't crackle
- [ ] Mute toggle, and resume the AudioContext on first user gesture (browser autoplay rule)

### 5. Website
- [ ] Landing page with a game library from `games/manifest.json` (title, author, cover, file, controls)
- [ ] Integer scaling with crisp pixels (`image-rendering: pixelated`), fullscreen, pause and reset
- [ ] Key mapping: PC keys to the Spectrum matrix (Backspace = CAPS+0, arrows = cursor/Kempston)
- [ ] Gamepad API to Kempston
- [ ] Touch: on-screen d-pad and fire, plus a pop-up Spectrum keyboard for mobile
- [ ] Save states in `localStorage` (snapshot of RAM and registers)

### 6. Container and hcode deployment
- [ ] Multi-stage `Dockerfile`:
      stage 1 `emscripten/emsdk:<pinned version>` → `make PLAT=WEB`;
      stage 2 `nginx:alpine` serves `dist/` on port 8080 as non-root
- [ ] nginx config: `application/wasm` MIME type, gzip/brotli, long cache for hashed assets,
      no-cache for `index.html`, `/healthz`
- [ ] CI: build, `make test`, a headless boot test, and build the image on every push
- [ ] Deploy to an hcode container, then point a domain at it with TLS

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
1. **Licensing.** Upstream has no LICENSE file. The README says "free open source".
   `z80emu` says "do whatever you want". `mz80` is free for freeware with credit only.
   The `z80core` licence is unstated. Ask MikeDX (and Adrian Brown) to confirm a licence,
   such as MIT or GPL, before hosting publicly.
2. **Game copyright.** Amstrad lets emulators distribute the 48K ROM. Games are a
   different matter. Host only titles whose rights holders allow distribution (ZXDB/Spectrum
   Computing marks these) or homebrew titles with permission. Let users load their own files locally.
3. **hcode specifics still to confirm:** does it build from a Dockerfile in git, or pull
   a pre-built image from a registry? Which port and health check does it expect? How are
   custom domains and TLS set up?
4. **Emulation accuracy.** Without contention and floating-bus emulation, a small number
   of games and demos will misbehave. That is acceptable for v1.
