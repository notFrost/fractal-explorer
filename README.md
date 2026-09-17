# Fractal Explorer

**[Live demo](https://fractal-explorer-six.vercel.app/app/)**

A web port of a PenguinMod project (`FractalExplorer.pmp`). Seven escape-time
sets drawn on the GPU with WebGL2 fragment shaders, plus any number built from
a formula you type and save to the menu. Six of them zoom without a precision limit; Pacman stops at
2^40. The original's camera model, pen colours, and controls carry over; the
CPU pen-plotting does not.

Try [10^301 zoom](https://fractal-explorer-six.vercel.app/app/#mandelbrot@0,1,2^1000.000)
to see the arbitrary-precision path working: a 1128-bit reference orbit, drawn
in 77 strips.

## Name

This project has two names. In casual conversation, it can be referred to as Fractal Explorer. However, that name is not specific to to this program, with several other fractal explorers sharing that name, so it can also be called FMP, short for "Fractal Modification Program". Of course, FMP is not a unique acronym, but no other similar programs share this name, meaning in the context of fractal viewers, FMP is the project-specific name. In writing, FMP can also be frequently used to make writing information about the program faster.

## Run

```
node serve.js
```

Then open http://localhost:5173/app/. The server exists only because ES
modules do not load from `file://`. Any static server works. Needs a browser
with WebGL2.

The site is two pages. `/portal/` is the home: a list of links to the
explorer, the two repos, and the notes. `/` redirects there. `/app/` is the
explorer itself. Both take their look from `design/`, one folder of plain CSS:
tokens, base, chrome. See `design/README.md`. Share links used to point at the
root, so the portal reads the hash on load and forwards anything shaped like
`#mandelbrot@x,y,zoom` to `/app/`.

## Controls

| Action | Keyboard | Mouse / touch |
| --- | --- | --- |
| Pan | W A S D or arrows, Shift doubles speed | drag |
| Zoom | E in, Q out | wheel, pinch |
| Iterations (×1 ×2 ×4 ×8) | `[` and `]` | the two round buttons |
| Save PNG at twice screen size | Space | the camera button |
| Back to the menu, or to the formula for a custom set | Esc | Menu button |
| Go to a location | G, or paste | click the coordinate or zoom in the HUD |
| Julia's `C` | arrows nudge it while the map has focus, Shift by ten | click or drag on the Mandelbrot map in the HUD |
| Colourway | `,` and `.` | the chips in the HUD |
| Fold the HUD away | H | the `hud` toggle under the panel |

The URL hash stores the set, centre, and zoom with as many digits as the zoom
needs, so any view can be bookmarked or shared. Julia adds two fields for its
parameter: `#julia@x,y,zoom,re,im`. Its `C` has its own inputs in the HUD,
with the original's four named parameters as chips. A colourway other than
Pen rides along as `?palette=classic` before the hash, and the last pick is
remembered per browser.

Above those inputs is the map `C` is picked off, and that map is the
Mandelbrot set. A `C` inside it gives a connected Julia set, a `C` outside
gives dust, and the boundary between them gives the branching, filamentary
ones. The map covers −2.1 to 0.6 and ±1.35i, the whole set and a margin, with
a ring where `C` is. Click or drag anywhere on it and the view follows, so
dragging the ring along the boundary runs through the Julia sets there. A `C`
off the map, typed or dragged past the edge, leaves an arrowhead at the edge
pointing towards it. The map draws on the same GL canvas as the menu
thumbnails, and only for a new colourway or size, so moving `C` redraws the
Julia view alone.

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

There is no upper zoom limit in the code, bar Pacman's. In practice the cost
grows with depth: the iteration budget is `30 × log2 zoom`, capped at 50 000
(×8 with the detail buttons, capped at 100 000), and the reference orbit costs
about 90 ms at 10^300. At 10^300 a 1280×800 frame is roughly 80 strips and
under a second on an RTX 2060.

**Webb**, **Collatz**, **Julia**, **Burning Ship** and **MandelBug** iterate
directly in float32 up to 10^6 zoom and use the same three tiers beyond it,
with their own reference orbits and shaders. **Pacman** is perturbed at every
zoom, like Mandelbrot, but has only the first tier.

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

Julia holds `C` fixed and lets the pixel be `z₀`, so its delta carries no `dc`
term: `d ← (2Z + d) d`. That product cancels when `Z ≈ −d/2`, which is the
pixel's orbit passing closer to the origin than its own delta. Rebasing onto
the centre orbit's start would not help, since that start is the view centre
rather than zero, so the texture holds two orbits under the same `C`: the
critical orbit, `Z₀ = 0`, and the view-centre orbit. A pixel rides the centre
orbit until that first cancellation, or until the orbit runs out, then sets
`d = z` and follows the critical orbit with Mandelbrot's rebasing, which is
exact there because that orbit starts at the critical point.

Burning Ship squares the absolute value of each part, and `|Z + d| − |Z|`
cannot be formed by subtracting two nearly equal floats. The shader takes it
by cases instead, which is exact: where `Z + d` keeps the sign of `Z` the
answer is `±d`, and where it crosses, `±(2Z + d)`. With `a` and `b` those two
exact differences, expanding the square gives
`dr ← 2|Zr| a + a² − (2|Zi| b + b²) + dcr` and
`di ← 2(|Zr| b + |Zi| a + a b) − dci`. The minus on `dci` is the original's:
it iterates `z ← (|Re z| + i|Im z|)² + c̄`, conjugating `c` so the ship stands
upright on a y-up stage, and the port keeps that rather than correcting it.

MandelBug is Mandelbrot with the imaginary part mistyped: `2 Zr Zi` written as
`2(Zr + Zi)`. The real part of the delta is then Mandelbrot's own,
`Re[(2Z + d) d] + dcr`, and the imaginary part is linear, so it is exact at any
scale: `2(dr + di) + dci`. Nothing cancels that Mandelbrot does not already
cancel, and `Z₀ = 0`, so its rebasing is used unchanged. The set is unbounded:
every `c` on the line `Im c = −Re c` is its own fixed point, so the whole line
belongs to it. The menu opens on the bulk instead, around `−0.97 + 0.97i`.

Pacman iterates `z ← z^z + c`, taking `0^0` as 1, so `z₁ = 1 + c` everywhere.
With `z^z = exp(z ln z)` on the principal branch and `L = Log1p(d/Z)`, the
delta is `d ← Z^Z expm1(Z·L + d·(ln Z + L)) + dc`, and nothing in it cancels
provided `log1p` and `expm1` are the real ones. Splitting the log as
`Log Z + Log1p(d/Z)` only holds while the two sum inside `(−π, π]`, so the
shader wraps the imaginary part of `L` to keep it there. Rebasing lands on
index 1 rather than 0, since `ln Z₀` is undefined. The zoom stops at 2^40,
where the other sets hand their reference to BigInt: Pacman's would need
complex `exp` and `ln` at 1000+ bits on every step, seconds to minutes a frame.

The set is unbounded. Far to the left, up or down, `Re(z ln z) → −∞`, so
`z^z → 0` and the orbit settles near `c`; only a wedge on the right escapes,
the mouth, repeating along the imaginary axis. Crossing the bailout is not
divergence either: orbits reach `|z| ~ 1e13` and are back near `0.5` a step
later. That overshoot sends a fifth of the escaped plane to black under
Mandelbrot's smooth count, so Pacman interpolates the crossing in `log|z|`
between the last two steps, which stays in `[0, 1)`. The same violence splits
orbits started one ulp apart to `1e-8` within about 320 steps, so where escape
takes longer the picture is dust under any double arithmetic.

**Colour** is one of seven colourways, all cycling on the original's
100-iteration period with inside points black. Pen is the original pen
mapping: hue `(t + 90) mod 100` on a 0..100 wheel, brightness `t × 5`
clamped. Classic is the navy, blue, white and orange ramp of the well-known
Ultra Fractal renders. Abyss, Ember and Ultraviolet are five-stop gradients,
the first two folded so they cycle without a seam. Ink and Chalk have no hue:
contour bands every eight iterations, dark on paper or pale on slate.

**Timing** in the HUD sums `EXT_disjoint_timer_query_webgl2` queries across
the strips of one frame. `ref` is the CPU time for the reference orbit when it
had to be recomputed.

## Your own formula

**Create Fractal**, at the bottom of the menu, takes one line — `Z_(n+1) =
Z_(n)^2 + C`, or `z ← z² + c`, or just `z^2 + c` — and renders it. The text is
parsed into an expression and compiled into a fragment shader, so a typed
formula draws on the same path as the built-in sets. The Menu button in the
viewer comes back here rather than to the main menu.

Under the line are the two values the pixel starts the orbit at, `z₀` and `c`,
each written `real + imaginary i`. They take `x` and `y`, the real and
imaginary parts of the point being checked, where the line itself takes `z`
and `c`; for an `x` in the line, or a `z` in a starting value, the editor
names the field it belongs to instead of calling it unknown. The usual pair,
`z₀ = 0` and `c = x+yi`, is the Mandelbrot arrangement. Fix `c` at a constant
and start `z` at the pixel instead, `z₀ = x+yi`, and the formula draws the
Julia set of that constant; the view then opens on the origin rather than on
−0.7, since a Julia set is centred there.

Beside the fields is a live preview of the view **Render** will open on, at
most 640 pixels across. It redraws a quarter second after the last keystroke,
on the same GL canvas the menu cards use, and prints underneath how the parser
read the line, so a typed `zᶻ + c` shows as `z ← z^(z) + c`, with either
starting value that is not the usual one beside it. Text the parser cannot
read leaves the last picture up, dimmed, rather than blanking mid-keystroke. A
formula previewed and then cancelled is dropped, and the shader goes back to
the last one rendered.

**Save**, beside Render, puts the formula in the menu under the name in the
Name field. An empty field names it `Fractal 3`, counting the ones already
saved. A saved fractal becomes a set of its own, with its shader compiled
under an id of `saved1`, `saved2` and so on, a card and thumbnail at the end
of the menu, and a hash of its own, `#saved2@x,y,zoom`. Its Menu button goes
to the menu rather than back to the editor. The list is kept in this browser's
local storage, so it survives a reload but does not travel with a link, and a
`#saved2@` link only opens for the browser that saved it.

The × in the corner of a saved card removes it. It puts the question over the
card first, and Cancel or Esc backs out. Delete drops the card, its shader and
its stored entry. Ids count up rather than filling the gap a deletion leaves,
so an old `#saved1@` link falls back to the menu instead of opening a
different fractal.

What it reads: `z` and `c`, decimal numbers, `i`, `pi` and `e`; `+ - * / ^`
with brackets, two values side by side for multiplication, letters written
together as well, so `x+yi` reads as `x + y·i`; `abs re im conj exp log sqrt
sin cos tan sinh cosh tanh`, each of one argument; and bars for absolute
value, so Burning Ship is `(|re(z)| + i|im(z)|)² + conj(c)`. The notation the
cards use works as typed — superscripts, subscripts, `←`, `×`, `÷`, `−` — so
`zᶻ + c` is Pacman. A whole-number exponent squares and
multiplies rather than going through `exp` and `log`, which is faster and,
unlike the log, defined at `z = 0`.

The same character has to open and close the pair, so a bar opens where a
value is due and closes where one has just ended. `||z| + |c||` and `2|z|`
come out as written. A bracket starts the count over, so a bar inside brackets
pairs inside them.

The editor colours each line as you type. Brackets and bars take a colour from
their nesting depth and the six colours cycle, so a pair matches and the pairs
either side of it do not. `z` and `c`, or `x` and `y` in the starting values,
numbers, `i pi e`, the function names and the operators each have a colour of
their own. The index on `zₙ₊₁` is dim, since the parser drops it, and a
bracket or bar left open turns red, as does a name that belongs to a different
field, such as `z` in a starting value. A layer behind each field carries the
colours; the field itself keeps the caret, the selection and the scrolling.
The help line under a field prints each group in its colour, so it doubles as
the key.

Everything else is fixed in this first version: the orbit escapes at
`|z| > 100`. There is no perturbed form of an arbitrary recurrence, so a typed
set iterates directly in float32 and stops at 10^6 zoom, where the others hand
over to a reference orbit. A formula can also overshoot the
bailout or reach NaN, neither of which the smooth count survives, so a count
it cannot read falls back to the step number. The text rides in the URL as
`?f=` before the hash, with `?z=` and `?c=` for the starting values when they
are not the usual pair, so a custom view shares like any other.

## Ported from the original

- Coordinates: `c = pixel / zoom + camera`, with the canvas height standing in
  for the 480×360 stage's 360 pixels.
- The two camera presets left as loose scripts in the Render sprite are
  bookmarks under the Mandelbrot HUD, plus one at 10^12.
- Main menu with a hover wobble, PNG download, iteration detail control.

Not ported: the joystick and edge buttons of the original's mobile mode, and
Scratch's base-10 log and NaN-to-0 quirks in the smooth colouring. Note that
while this project is technically a port, it's become significantly more
powerful than the original and is a separate project in its own right.
