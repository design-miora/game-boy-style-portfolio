[README.md](https://github.com/user-attachments/files/33418865/README.md)
# Game Boy Style Portfolio

An interactive, Game Boy-shaped portfolio you power on, navigate, and play — built with vanilla HTML/CSS/JS Web Components. No frameworks, no build step, no dependencies.

**Live:** https://design-miora.github.io/game-boy-style-portfolio/

## What it is

The whole portfolio lives inside an on-screen Game Boy console. Flip the power switch, and the console boots up into a menu:

- **About Me** — a short bio.
- **My Resume (Beta)** — launches a small embedded platformer, right on the console's own screen. The career timeline becomes four collectible "data crystals" (Amazon → Bharathi Web → Accenture → Apple, oldest to current), each one showing a real resume bullet when collected. Reach the flag after collecting all four for the ending.
- **Follow Me** — links to LinkedIn/GitHub.
- **Hire Me** — opens your mail app with a pre-filled message.

The console also has a **Classic / Vintage** skin toggle, switched entirely through CSS custom properties — no image swapping involved.

## Controls

| Action | Touch/Click | Keyboard |
|---|---|---|
| Navigate menu | D-pad Up/Down | Arrow Up/Down |
| Confirm / Jump (in-game) | A | Enter, Z, Arrow Up (in-game) |
| Back / Run (in-game) | B | Backspace, X, Shift (hold, in-game) |
| Move (in-game) | D-pad Left/Right | Arrow Left/Right, A/D |
| Start | Start | Space |
| Exit game | Select | Escape |
| Power on/off | Power switch | P |

## Tech

- Plain Web Components (Custom Elements + Shadow DOM) for every piece of the console — screen, buttons, D-pad, crystal bezel.
- CSS custom properties (`--gb-*`) drive the Classic/Vintage skins; they cascade automatically through every nested shadow root.
- The embedded platformer renders to a `<canvas>` at native Game Boy resolution (160×144) using the classic 4-shade DMG green palette.
- Sound effects are synthesized on the fly with the WebAudio API — no audio files.
- Responsive scaling via a single CSS `transform: scale()` on the whole console, recalculated on resize.

## Running it locally

No build step — just open `index.html` in a browser, or serve the folder with any static file server:

```
npx serve .
```

## Project structure

```
index.html          Entry point
style.css           Page shell (background, title plaque, responsive wrapper)
script.js           Every Web Component + the embedded game, in one file
backgrounds/         Background art
title/               Title plaque art (Classic/Vintage)
```
