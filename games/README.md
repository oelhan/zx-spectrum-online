# Game library

Games listed in `manifest.json` show up as cards under the emulator. Put the
game files (and optional cover images) in this folder; `make PLAT=WEB` copies
everything except this README to `dist/games/`.

Only add games whose authors allow them to be shared, such as freeware
releases marked "distribution permitted".

```json
{
  "games": [
    {
      "title": "Example Game",
      "author": "Someone",
      "year": 1985,
      "file": "example.tap",
      "cover": "example.png",
      "controls": "Q/A up/down, O/P left/right, Space fire",
      "joystick": "kempston"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Shown on the card |
| `file` | yes | `.tap`, `.tzx`, `.sna` or `.z80`, relative to this folder |
| `author`, `year` | no | Shown under the title |
| `cover` | no | Image relative to this folder, ideally 4:3 (a Spectrum screen is 256x192) |
| `controls` | no | Shown under the emulator while the game runs |
| `joystick` | no | Selected when the game loads: `keys`, `kempston`, `sinclair` or `cursor` |

A game can be linked directly as `/?game=games/<file>`.
