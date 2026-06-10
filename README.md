# wiz4

## Run it

It's a static site - no build step, no dependencies.

- Easiest: open `index.html` in a browser, or
- `python -m http.server 8000` in this folder, then visit `http://localhost:8000`.

## Controls (rebindable with F2 in game)

| Key | Action |
| --- | --- |
| Left / Right | Walk |
| Up | Enter door |
| Down | Duck (and turn invisible, once you know the spell) |
| Space / Ctrl | Jump |
| S / R | Start / Resume (title screen) |
| P | Pause |
| M | Mute |

## The Rules

- Guide the wizard through side-scrolling lands. Touching any creature, arrow,
  boulder, or flame is fatal; the wizard has no attack, so this is a game of
  dodging.
- Potions fill the flask in the HUD. Fill it and you learn the next spell, in
  this order: Higher Jump, Invisibility, Double Jump, Flame Resistance, Helper
  Sprite, and Restore.
- Dying loses all spells.
- Keys open locked doors, one key at a time. Doors teleport between matching
  pairs and act as checkpoints, as do waystones.
- Levers toggle rune blocks. Springboards launch you. Stars are worth 1000.
  Hidden rooms exist, so jump at suspicious places.
