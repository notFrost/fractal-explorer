# Fractal Explorer

A web port of a PenguinMod project (`FractalExplorer.pmp`). Three escape-time
sets rendered on a canvas by Web Workers, with the same camera model, the same
iteration budget, and the same pen colours as the original.

## Run

```
node serve.js
```

Then open http://localhost:5173. The server exists only because ES-module
workers do not load from `file://`. Any static server works.

## Controls

| Action | Keyboard | Mouse / touch |
| --- | --- | --- |
| Pan | W A S D or arrows, Shift doubles speed | drag |
| Zoom | E in, Q out | wheel, pinch, on-screen buttons |
| Detail (iteration multiplier ×1 ×2 ×4 ×8) | `[` and `]` | on-screen buttons |
| Save PNG at screen size | Space | Save PNG button |
| Back to menu | Esc | Menu button |

The URL hash stores the set, centre, and zoom, so a view can be bookmarked or
shared.

## What was ported, and how

- **Coordinates.** The original maps a 480×360 stage through
  `c = pixel / zoom + camera`. Here the canvas height stands in for 360 stage
  pixels, so `zoom 100` shows the same vertical span at any window size.
- **Iterations.** `clamp(log10(zoom) × 25, 10, 200)`, the original's
  full-render budget. The detail multiplier is new.
- **Mandelbrot.** Main-cardioid skip, bailout at |z|² > 4, smooth colouring
  with Scratch's base-10 log and its NaN-to-0 cast.
- **Collatz.** Complex parity is `floor(|z|) mod 2`. Odd goes to 3z + 1, even
  to z / 2. The colour is fixed after two steps and only shown if the orbit is
  outside radius 5 after all steps. No early exit, exactly as written.
- **Webb.** `z(n+1) = z(n)² + z(n-1)` seeded with 0 and c. The escaping step is
  not counted, as in the original.
- **Colour.** Pen starts at `#0400ff`, hue set to `(t + 90) mod 100` on the
  0..100 wheel, brightness to `t × 5` clamped. Inside points are black.
- **Bookmarks.** The two camera presets left as loose scripts in the Render
  sprite appear under the Mandelbrot HUD.
- **Progressive render.** 8-pixel blocks, then 2, then 1. The original drew
  15-pixel pen dots while moving and only went to full quality on Space.

Not ported: the on-screen joystick (drag replaces it) and the mobile-mode
flag (touch controls show automatically on coarse pointers).
