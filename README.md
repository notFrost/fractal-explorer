# Fractal Explorer

**[Live demo](https://fractal-explorer-six.vercel.app)**

A web port of a PenguinMod project (`FractalExplorer.pmp`). Three escape-time
sets drawn on the GPU with WebGL2 fragment shaders. All three zoom without a
precision limit. The original's camera model, pen colours, and controls carry
over; the CPU pen-plotting does not.

Try [10^301 zoom](https://fractal-explorer-six.vercel.app/#mandelbrot@0,1,2^1000.000)
to see the arbitrary-precision path working: a 1128-bit reference orbit, drawn
in 77 strips.

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
| Go to a location | G, or paste | click the coordinate or zoom in the HUD |

The URL hash stores the set, centre, and zoom with as many digits as the zoom
needs, so any view can be bookmarked or shared.

The go-to form takes the real and imaginary parts and a zoom (`1e12`,
`2^1000`, `10^301`), or one pasted line in any of these shapes: a share link
or its hash, `x, y, zoom`, or the HUD's own `x + yi @ zoom`. Pasting such a
line anywhere in the viewer goes there directly.

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

**Webb** and **Collatz** iterate directly in float32 up to 10^6 zoom and use
the same three tiers beyond it, with their own reference orbits and shaders.

Webb's two-term recurrence carries a delta on both terms,
`d ← (2Z + d) d + e, e ← d`. The map has no critical point, so the delta never
loses precision the way Mandelbrot's does near the origin. Rebasing moves a
pixel onto the reference's start state `(Z₀, 0)`; the offset `Zₙ − Z₀` is
stored in the texture at full precision so that step is not a float32
subtraction of two nearly equal values.

Collatz's two branches are affine, so while a pixel takes the reference's
branch its delta is exact: `d ← 3d` or `d / 2`. The whole precision question
is the parity test. For each step the CPU stores, as log2, the distances from
`|Z|` down and up to the nearest integer radius. The pixel's radius change is
formed without cancellation as `(2 Re(Z̄ d) + |d|²) / (|Z + d| + |Z|)` and
counted against those distances. A pixel that takes the other branch leaves
the reference and continues from a float32 base with the exact delta kept
alongside; from then on its boundary tests have float32 precision, as in the
direct shader. Collatz stops after 500 steps, so its reference is cheap.

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
