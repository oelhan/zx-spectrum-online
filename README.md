# ZXEMU

Version 0.0.2  
https://github.com/MikeDX/z80emu/  
Copyright (c) 2016 MikeDX  

Uses Z80 Cpu Core by Adrian Brown 

ZXEMU is a free open source cross platform ZX Spectrum emulator, currently work in progress hoping to support various models of ZX Spectrum.

[Play online](http://js.mikedx.co.uk/zxem.html)

[![build](https://github.com/MikeDX/z80emu/actions/workflows/build.yml/badge.svg)](https://github.com/MikeDX/z80emu/actions/workflows/build.yml)

## Building

Install SDL 1.2 (or SDL2) first:

- Ubuntu/Debian: `sudo apt-get install libsdl1.2-dev libsdl2-dev`
- macOS (Homebrew): `brew install sdl12-compat sdl2`

Then:

```
make            # zxem with SDL 1.2
make SDL=2      # zxem with SDL2
make DEBUG=1    # debug build
make PLAT=HTML  # Emscripten build (zxem.html)
make test       # build and run the CPU test suite
```

Run `./zxem` from the repository root (it loads `roms/48k.rom`). To start a game,
pass it on the command line: `./zxem game.tap` (also `.tzx`, `.sna`, `.z80`; 48K only).

## Website build

The browser version builds with Emscripten into `dist/` (no SDL):

```
make docker-web       # build in the emscripten/emsdk Docker image (no local emsdk needed)
make PLAT=WEB         # or build with a local emcc
make serve            # http://localhost:8000
make test-web         # boot, I/O, loader, sound and save state tests in Node
```

On the page, use "Load game…", drop a file onto the page, or open
`/?game=<url>` to load a game from a URL. Sound starts on the first click or
key press (browsers block audio before that), and the Sound button mutes it.

- Joystick: choose Kempston, Sinclair or cursor. The arrow keys and Tab, a
  gamepad, or the touch d-pad then drive it.
- Save state / Load state: one save per game, kept in your browser.
- Keyboard: shows an on-screen Spectrum keyboard. On it, Caps and Sym stay held
  until the next key.
- Game library: list games in `games/manifest.json` and they appear as cards
  under the emulator (see [games/README.md](games/README.md)).

## Container

```
docker build -t zx-spectrum-online .
docker run --rm -p 8080:8080 zx-spectrum-online    # http://localhost:8080
```

The build compiles the emulator and runs the web tests. nginx then serves the site on
`$PORT` (default 8080), with a health check at `/healthz`. On hcode, set the build mode to
Dockerfile and the runtime port to 8080, and leave the start command empty.

See [PLAN.md](PLAN.md) for the roadmap.

## TODO list
- [x] Working Z80 CPU Core  
- [x] Screen renderer (pixels, ink, paper, bright, flash)
- [x] Keyboard input  
- [x] Spectrum 48k rom support  
- [x] .scr image viewer
- [x] Windows port  
- [x] OSX port  
- [x] Linux  
- [x] Android port  
- [x] Html/Javascript port  (compile with make PLAT=HTML)
- [x] Raspberry Pi port  
- [ ] 'BEEP' sound output  
- [ ] Spectrum 128K support  
- [ ] AY-3-8912 emulation  
- [ ] Configurable gamepad  
- [ ] TZX Support  
- [ ] Z80 Snapshot support  
- [ ] SNA Snapshot support  
- [ ] TAP Support  

Please help to test and develop this project!

## Licence

The work added in this repository is under the [MIT licence](LICENSE). It builds on
ZXEMU by MikeDX, the z80core and z80emu CPU cores, and the Sinclair 48K ROM, which keep
their own terms. See [NOTICE](NOTICE) for what is covered and who wrote what.
