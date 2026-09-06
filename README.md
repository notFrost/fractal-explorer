# Fractal Explorer

A web port of a PenguinMod project (`FractalExplorer.pmp`). Three escape-time
sets drawn on the GPU with WebGL2 fragment shaders. The original's camera
model, pen colours, and controls carry over; the CPU pen-plotting does not.

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
| Zoom | E in, Q out | wheel, pinch, on-screen buttons |
| Detail (iteration multiplier ×1 ×2 ×4 ×8) | `[` and `]` | on-screen buttons |
| Save PNG at twice screen size | Space | Save PNG button |
| Back to menu | Esc | Menu button |

The URL hash stores the set, centre, and zoom, so a view can be bookmarked or
shared.

## Rendering

One fullscreen triangle, one draw call per frame, one fragment shader per set.
Every input event redraws immediately. There are no progressive passes.

**Mandelbrot** uses perturbation. The CPU computes the orbit of the screen
centre in double precision and uploads it as a float texture. Each pixel
iterates only its offset from that orbit in float32, and rebases to the start
of the reference whenever its own orbit passes closer to the origin than the
offset (Zhuoran's method). That removes the usual float32 zoom ceiling. The
limit becomes the double precision of the centre itself, about 10^15.

**Webb** and **Collatz** iterate directly in float32 and are capped at 10^6
zoom, where a pixel still spans tens of float ulps. Collatz has no perturbation
form because its parity test is a floor, and its values overflow within a few
dozen steps regardless.

**Iterations** grow with zoom depth, `clamp(100 × log10(zoom), 200, 4000)`,
times the detail multiplier, capped at 8000. The cap keeps a single draw call
under typical GPU watchdog timeouts.

**Colour** is the original pen mapping: hue `(t + 90) mod 100` on a 0..100
wheel, brightness `t × 5` clamped, inside points black.

**Timing** in the HUD comes from `EXT_disjoint_timer_query_webgl2` when the
browser exposes it. Otherwise only the resolution is shown.

## Ported from the original

- Coordinates: `c = pixel / zoom + camera`, with the canvas height standing in
  for the 480×360 stage's 360 pixels.
- The two camera presets left as loose scripts in the Render sprite are
  bookmarks under the Mandelbrot HUD, plus one deep-zoom bookmark to show what
  perturbation buys.
- Main menu with a hover wobble, mobile zoom buttons, PNG download.

Not ported: the on-screen joystick (drag replaces it), the mobile-mode flag
(touch controls show on coarse pointers), and Scratch's base-10 log and
NaN-to-0 quirks in the smooth colouring.
