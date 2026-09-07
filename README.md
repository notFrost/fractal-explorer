# Fractal Explorer

A web port of a PenguinMod project (`FractalExplorer.pmp`). Three escape-time
sets drawn on the GPU with WebGL2 fragment shaders. The Mandelbrot set zooms
without a precision limit. The original's camera model, pen colours, and
controls carry over; the CPU pen-plotting does not.

## Run

```
node serve.js
```

Then open http://localhost:5173. The server exists only because ES modules do
not load from `file://`. Any static server works. Needs a browser with WebGL2.

## Controls

| Action | Keyboard | Mouse / touch |
| --- | --- | --- |
| Pan | W A S D or arrows, Shift doubles speed | drag |
| Zoom | E in, Q out | wheel, pinch |
| Iterations (×1 ×2 ×4 ×8) | `[` and `]` | the two round buttons |
| Save PNG at twice screen size | Space | the camera button |
| Back to menu | Esc | Menu button |

The URL hash stores the set, centre, and zoom with as many digits as the zoom
needs, so any view can be bookmarked or shared.

## Rendering

One fullscreen triangle, one fragment shader per set. Cheap frames are a
single draw call. Expensive frames are drawn in horizontal strips across
successive animation frames so no draw call runs long enough to trip the GPU
watchdog. Every input event starts a new frame and cancels the old one.

### Mandelbrot precision tiers

The camera centre is a fixed-point BigInt whose bit width grows with zoom,
`ceil(log2 zoom) + 64`. Pixels never see the centre. Each pixel iterates only
its offset from a reference orbit (perturbation), and rebases to the start of
the reference whenever its own orbit passes closer to the origin than the
offset (Zhuoran's method). The reference is cached and reused while the camera
stays within two screens of it and the zoom stays within 2^64 of when it was
computed, so panning at depth is free.

| Zoom | Reference orbit | Pixel delta |
| --- | --- | --- |
| below 2^40 (about 10^12) | double | float32 |
| 2^40 to 2^90 (about 10^27) | BigInt fixed point | float32 |
| above 2^90 | BigInt fixed point | float32 mantissa + int exponent |

The floatexp tier exists because pixel deltas fall below float32's smallest
normal number, around 10^-38, while the reference values stay in ordinary
range. The shader carries each delta as `m × 2^e`, normalised so the mantissa
stays in [0.5, 1), built from `floatBitsToInt` and `intBitsToFloat` since
GLSL ES 3.00 lacks `frexp` and `ldexp`.

There is no upper zoom limit in the code. In practice the cost grows with
depth: the iteration budget is `30 × log2 zoom`, capped at 50 000 (×8 with
the detail buttons, capped at 100 000), and the reference orbit costs about
90 ms at 10^300. At 10^300 a 1280×800 frame is roughly 80 strips and under a
second on an RTX 2060.

**Webb** and **Collatz** iterate directly in float32 and are capped at 10^6
zoom. Collatz has no perturbation form because its parity test is a floor.
Webb's two-term recurrence can be perturbed but not rebased, which produces
glitches near deep minibrots, so it stays capped.

**Colour** is the original pen mapping: hue `(t + 90) mod 100` on a 0..100
wheel, brightness `t × 5` clamped, inside points black.

**Timing** in the HUD sums `EXT_disjoint_timer_query_webgl2` queries across
the strips of one frame. `ref` is the CPU time for the reference orbit when it
had to be recomputed.

## Installable app

`manifest.webmanifest` and `sw.js` make it a Progressive Web App. Install it
from the browser menu on a phone or desktop. The service worker caches the
app shell network-first, so edits show up on reload and the explorer keeps
working offline once it has loaded.

## Ported from the original

- Coordinates: `c = pixel / zoom + camera`, with the canvas height standing in
  for the 480×360 stage's 360 pixels.
- The two camera presets left as loose scripts in the Render sprite are
  bookmarks under the Mandelbrot HUD, plus one at 10^12.
- Main menu with a hover wobble, PNG download, iteration detail control.

Not ported: the joystick and edge buttons of the original's mobile mode, and
Scratch's base-10 log and NaN-to-0 quirks in the smooth colouring.
