# Fractal Explorer

**[Live demo](https://fractal-explorer-six.vercel.app/app/)**

A web port of a PenguinMod project (`FractalExplorer.pmp`). Eight escape-time
sets drawn on the GPU with WebGL2 fragment shaders, plus any number built from
a formula you type and save to the menu. Seven of them zoom without a precision limit; Pacman stops at
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
| Rotate | Z counterclockwise, X clockwise, R levels it, Shift doubles speed | Shift and drag, two-finger twist |
| Dive into a random spot in view | F | the die button |
| Iterations (×1 ×2 ×4 ×8) | `[` and `]` | the two round buttons |
| Save PNG at twice screen size | Space | the camera button |
| Back to the menu, or to the formula for a custom set | Esc | Menu button |
| Go to a location | G, or paste | click the coordinate or zoom in the HUD |
| Julia's `C` | arrows nudge it while the map has focus, Shift by ten | click or drag on the Mandelbrot map in the HUD |
| Colourway | `,` and `.` | the chips in the HUD |
| Show the complex plane | P | the grid button |
| Fold the HUD away | H | the `hud` toggle under the panel |

The URL hash stores the set, centre, and zoom with as many digits as the zoom
needs, so any view can be bookmarked or shared. Julia adds two fields for its
parameter: `#julia@x,y,zoom,re,im`. Its `C` has its own inputs in the HUD,
with the original's four named parameters as chips. A colourway other than
Pen rides along as `?palette=classic` before the hash, and the last pick is
remembered per browser. A turned view adds `?angle=31.5`, degrees
anticlockwise. A link without it opens level. The complex plane adds
`?plane=1`, and that pick too is remembered per browser.

**P**, or the grid button, draws that plane over the picture: the real and
imaginary axes, a grid, and the number each line stands for. The step is the
1, 2 or 5 × 10^d nearest a hundred pixels, so it changes with the zoom. A
number sits on the axis it counts along, as it would on a plotted plane. Where
that axis has left the screen, which is most of a deep zoom, the number goes to
the end of its own line at the edge of the frame instead, and one that would
land on a number already written is dropped. It finds the lines in the camera's
own fixed point rather than in a double, so a grid at 10^-40 lands on the
digits the HUD shows and every label is exact: a whole multiple of the step
with its point moved. Past twelve characters a number keeps only its last six
digits, the ones that differ from line to line, since the HUD carries the
coordinate in full. The plane draws on a second canvas over the picture, so
switching it on costs no frame, and a saved PNG has it too.

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

The go-to form takes the real and imaginary parts, a zoom (`1e12`, `2^1000`,
`10^301`) and a rotation in degrees, or one pasted line in any of these shapes:
a share link or its hash, `x, y, zoom`, or the HUD's own `x + yi @ zoom`.
Pasting such a line anywhere in the viewer goes there directly.

**F**, or the die button, drops the view into a spot picked out of the frame
on screen: five doublings of zoom over two and a half seconds, the rate a held
**E** zooms at. A spot picked evenly over the frame would nearly always land in
the black of the interior or the flat wash behind the set, where a zoom ends on
one colour, so the pick is weighted by how much the picture changes from one
pixel to the next. Flat regions score nothing, a band of colour shifts a level
or two, and the filaments along the boundary swing the width of the palette;
squaring that weight leaves them the likely pick even where they cover a
fraction of the frame. Forty spots picked this way on the Mandelbrot set as it
opens sat on pixels whose neighbours stand 235 grey levels apart, against 6 for
an even draw. None of the forty landed on the flat, where an even draw put 26
of them.

The frame it reads is the one already on screen, in `app/dive.js`, so the press
costs no render, and it leaves out a tenth of the frame around the edge so the
spot has its surroundings in view. About 40,000 pixels are scored whatever the
size of the canvas, in one pass that keeps a running total of the weight and
replaces the pick in proportion to it. The spot's offset across the screen runs
down to nothing over the fall, so it drifts in a straight line to the middle
while the view closes in on it, rather than swinging out and back. A drag, the
wheel, a key or a bookmark stops the fall where it is, and a second press picks
a new spot out of wherever it stopped. A set with less than half a doubling
left under its zoom limit says so instead of moving, and one with more than
that but less than five falls as far as it can.
Under `prefers-reduced-motion` the view arrives without the fall.

## Rendering

One fullscreen triangle, one fragment shader per set. Cheap frames are a
single draw call. Expensive frames are drawn in horizontal strips across
successive animation frames so no draw call runs long enough to trip the GPU
watchdog. Every input event starts a new frame and cancels the old one.

Rotation happens where a pixel becomes a complex number. Each shader takes the
pixel's offset from the centre of the screen, turns it onto the plane's axes,
then scales it by the pixel size. The camera centre, the reference orbit and
the precision tiers are untouched. Panning and zooming take the same turn on
the way from the screen to the camera, so a drag follows the hand and W moves
up the screen at any angle. The Julia map and the menu thumbnails are drawn
without an angle and stay upright.

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

**Webb**, **Collatz**, **Julia**, **Burning Ship**, **MandelBug** and **The
Octopus** iterate directly in float32 up to 10^6 zoom and use the same three
tiers beyond it, with their own reference orbits and shaders. **Pacman** is
perturbed at every zoom, like Mandelbrot, but has only the first tier.

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

Pacman is Mandelbrot with the two halves of a step taken in sequence rather
than together. The imaginary part is Mandelbrot's own, `Zi' = 2 Zr Zi + Ci`,
and the real part then reads it back out of the step it belongs to instead of
the step before: `Zr' = Zr² − Zi'² + Cr`. The delta follows the same order,
`di ← 2(Zr di + Zi dr + dr di) + dci` first and
`dr ← dr(2 Zr + dr) − di(2 Zi' + di) + dcr` after, where `Zi'` is the
reference's next imaginary part, one texel along from the one the step began
on. Every term is a delta against a reference value, so nothing cancels, and
`Z₀ = 0`, so Mandelbrot's rebasing is used unchanged. The zoom stops at 2^40,
where the other sets hand their reference to BigInt. The map is multiplication
and addition, as MandelBug's is, so that tier would take it; the BigInt orbit
is simply not written.

The order is the whole difference. Conjugate symmetry survives it, `c` and `c̄`
still drawing mirrored orbits, and on the real axis, where `Im z` starts at zero
and stays there, the map is the real Mandelbrot, so the set meets the axis over
the same `[−2, 0.25]`. Off the axis the body runs much further right than
Mandelbrot's does, to `Re c ≈ 0.87` at `Im c ≈ ±0.44`, and the wedge those two
lobes leave around the `0.25` tip is the mouth the set is named for. It is a
different mouth from the old set's, which came out of `z ← z^z + c` having a
`Re(z ln z) → −∞` half-plane; this one is an edge of the body. Past the lips the
escape times fall into dendrites with islands of bounded orbits strewn along
them, detached from the body and reaching `Re c ≈ 1.21`.

The Octopus squares `w = (Re z + Im c) + i(|Im z| − Re c)` rather than `z`, so
the two parts of `c` cross over. The real part of `w` takes `Im c`, and the
imaginary part takes `−Re c` under the Burning Ship's `|·|`. The delta is a
square's, `d ← (2W + w) w + dc`, where `w` is the delta on `W`. Its real part
is `dr + dci`, and its imaginary part is the Burning Ship's exact
`|Zi + di| − |Zi|` less `dcr`, so nothing cancels. `W` cannot be rebuilt from
`Z` alone, since it holds `c` and the shader never sees `c`, so the texel
carries it in the two channels Mandelbrot's leaves empty. `Z₀ = 0`, so the
rebasing is Mandelbrot's unchanged, and all three tiers follow.

Zoomed out the set is a straight rod at 45°, 2.50 long and 0.320 wide, running
from a tip near `−0.26 + 0.39i` to one near `1.54 − 1.34i`. Its flanks are the
lines `Re c + Im c = −0.1838424` and `Re c + Im c = 0.2683454`, each constant
to seven digits along the rod. The fold is the reason. An orbit below the real
axis has `|Im z| = −Im z`, and there `η = conj(z) − ic` iterates as
`η ← conj(η)² + K`, the Mandelbar's map, with `K = (1 − i)(Re c + Im c)`. That
parameter depends on `c` only through the sum of its two parts, so every `c`
along a 45° line runs the same Mandelbar, and the escape boundary is that line.
Inside the rod the orbit is below the axis at nearly every step. The seed
`η₀ = −ic` keeps moving along the rod where `K` does not, and that tapers the
two ends to points. Neither `c̄` nor a reflection across the rod repeats a
point, so the set has no symmetry of its own. The detail is on the flanks. Off
the lower tip, at `1.33005701471 − 1.43723164942i`, the escape times break into
Mandelbrot-like islands that hold their shape past 2^90 zoom.

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
imaginary parts of the point being checked, and so does the line itself, where
`x` reads the same value on every step; for a `z` or a `c` in a starting
value, the editor names the field it belongs to instead of calling it unknown.
The usual pair, `z₀ = 0` and `c = x+yi`, is the Mandelbrot arrangement. Fix `c`
at a constant and start `z` at the pixel instead, `z₀ = x+yi`, and it draws the
Julia set of that constant.

**+ Variable**, under the pair, adds a value of your own: a letter and a
starting value the orbit keeps for the whole run, exactly as `c` does. It is
written the way `z₀` and `c` are, so it takes `x` and `y` as well as numbers;
`k = x+yi` with `c = 0` and `z ← z² + k` is the Mandelbrot set with the
parameter carried by `k` instead. The editor takes the first free letter, and
the box holding it renames it. `z`, `c`, `x`, `y`, `i` and `e` are spoken for, which leaves
twenty on offer; a second variable by the same letter, or none at all, is
refused rather than rendered. The × beside a letter drops it. `z₀` and `c`
have no ×, since the formula and the pixel are written in terms of them. A
letter joins the key under the formula the moment it exists, so `z² + kc`
reads `k` as a variable once `k` is there and as an unknown name before
that.

Beside the fields is a live preview of the view **Render** will open on, at
most 640 pixels across. It redraws a quarter second after the last keystroke,
on the same GL canvas the menu cards use, and prints underneath how the parser
read the line, so a typed `zᶻ + c` shows as `z ← z^(z) + c`, with either
starting value that is not the usual one beside it. Text the parser cannot
read leaves the last picture up, dimmed, rather than blanking mid-keystroke. A
formula previewed and then cancelled is dropped, and the shader goes back to
the last one rendered.

### Finding the fractal

Where a typed formula's set sits is not something the text says. `z² + c` is
around −0.7, a Julia set is around the origin, `z² + c + 3` is around −3.7,
and `c = 50(x+yi)` draws the Mandelbrot set a fiftieth of the size. So the
preview, the view Render opens on and a saved fractal's thumbnail are all
framed on a measurement rather than a guess.

The survey is in `app/framing.js`. It draws the formula into a 128×96
greyscale map of how far through the iteration budget each pixel got, with the
points that never escape at full white, and takes the bounding box of the
slowest pixels. Those are the set and the filaments around it, wherever they
are. The reading starts at the whitest grey level that has any pixels and
takes in each level under it that fits in a fiftieth of the picture. It stops
short of that fiftieth rather than overshooting it, because the points that
escape on the first or second step are one enormous level, and a reading that
falls into that level boxes the bailout radius instead of the set.

One box is only as tight as the view it was measured in, so the survey opens
eight units tall at the origin and closes in over up to five passes. A box
against the edge of the survey gives a direction rather than a centre, so the
next pass moves to that box and looks twice as wide. A box clear of the edges
is fitted, a quarter of its span is left as margin, and the fit is measured
again. On the Mandelbrot arrangement the survey settles on −0.679 at 137×,
against the hand-picked −0.7 at 135× the built-in set opens on, and on the
editor's MandelBug it settles on −0.981 + 0.972i against −0.97 + 0.97i by
hand.

An unbounded set, `zᶻ + c` among them, never gives a box clear of the edges,
and nor does a set too large for the widest view the app allows. With no
extent to frame, the survey falls back to where the fractal's kind usually sits: the
origin for a Julia set, whose pixel is z₀ under a fixed parameter, and −0.7
for a parameter plane. A lost GL context takes the same fallback. Each pass
costs one GPU readback, and the survey runs once per formula rather than once
per keystroke: about 7 ms per saved fractal at startup, and 30 to 80 ms behind
the preview's quarter-second wait.

**Save**, beside Render, puts the formula in the menu under the name in the
Name field. An empty field names it `Fractal 3`, counting the ones already
saved. A saved fractal becomes a set of its own, with its shader compiled
under an id of `saved1`, `saved2` and so on, a card and thumbnail at the end
of the menu, and a hash of its own, `#saved2@x,y,zoom`. Its Menu button goes
to the menu rather than back to the editor. The list is kept in this browser's
local storage, so it survives a reload but does not travel with a link, and a
`#saved2@` link only opens for the browser that saved it.

**Edit**, in the top left of every card, opens that set in the editor with its
formula, its two starting values and any variables it carries already in the
fields. A built-in set brings no variables, so the rows start empty. On a
fractal you saved, Save replaces it where it stands, under the same id, the
same `#saved2@` link and the same place in the menu. On a built-in set it is a
line to start from rather than a change to the set itself. Mandelbrot stays
Mandelbrot, and Save adds what you made beside it.

Six of the eight built-in sets are written out for the editor. Mandelbrot is
`z^2 + c`. Julia is the same line with `z₀ = x+yi` and `c` held at
`-0.74543+0.11301i`. Burning Ship is `(|re(z)| + i|im(z)|)^2 + conj(c)`,
MandelBug is `re(z^2) + 2i(re(z) + im(z)) + c`, Pacman is
`re(z)^2 - im(z^2+c)^2 + re(c) + i*im(z^2+c)`, and The Octopus is
`(re(z) + im(c) + i(|im(z)| - re(c)))^2 + c`. Any copy iterates in float32
like a typed formula, so it stops at 10⁶ zoom where the original hands over to
a reference orbit.

Collatz and Webb are greyed out, and the button says why. Collatz picks one of
two formulas each step, and Webb needs the term before last. Neither is one
formula in `z` and `c`.

The × in the top right of a saved card removes it. It puts the question over
the card first, and Cancel or Esc backs out. Delete drops the card, its shader and
its stored entry. Ids count up rather than filling the gap a deletion leaves,
so an old `#saved1@` link falls back to the menu instead of opening a
different fractal.

What it reads: `z`, `c`, `x`, `y` and any variable you have added, decimal
numbers, `i`, `pi` and `e`; `+ - * / ^` with brackets, two values side by
side for multiplication, letters written together as well, so `x+yi` reads
as `x + y·i`; `abs re im conj exp log sqrt sin cos tan sinh cosh tanh`, each of
one argument; and bars for absolute value, so Burning Ship is
`(|re(z)| + i|im(z)|)² + conj(c)`. The notation the cards use works as typed
— superscripts, subscripts, `←`, `×`, `÷`, `−` — so the card line
`z ← z² + c` goes straight into the field. A whole-number exponent squares and
multiplies rather than going through `exp` and `log`, which is faster and,
unlike the log, defined at `z = 0`.

The same character has to open and close the pair, so a bar opens where a
value is due and closes where one has just ended. `||z| + |c||` and `2|z|`
come out as written. A bracket starts the count over, so a bar inside brackets
pairs inside them.

The editor colours each line as you type. Brackets and bars take a colour from
their nesting depth and the six colours cycle, so a pair matches and the pairs
either side of it do not. `z`, `c`, `x`, `y` and the letters you have added,
numbers, `i pi e`, the function names and the operators each have a colour of
their own. The index on `zₙ₊₁` is dim, since the parser drops it, and a bracket
or bar left open turns red, as does a name that belongs to a different field,
such as `z` in a starting value. A layer
behind each field carries the colours; the field itself keeps the caret, the
selection and the scrolling.
The help line under a field prints each group in its colour, so it doubles as
the key.

Everything else is fixed in this first version: the orbit escapes at
`|z| > 100`. There is no perturbed form of an arbitrary recurrence, so a typed
set iterates directly in float32 and stops at 10^6 zoom, where the others hand
over to a reference orbit. A formula can also overshoot the
bailout or reach NaN, neither of which the smooth count survives, so a count
it cannot read falls back to the step number. The text rides in the URL as
`?f=` before the hash, with `?z=` and `?c=` for the starting values when they
are not the usual pair and a `?v=k:0.5` for each variable added, so a custom
view shares like any other.

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
