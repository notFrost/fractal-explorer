# Design system

One source of truth for how this toy looks. Three sheets, loaded in order:

| Sheet | Holds | Change it when |
| --- | --- | --- |
| `tokens.css` | Colours, fonts, blur, motion timing, as custom properties | The look changes |
| `base.css` | Reset, document type, button reset, focus ring | Never, mostly |
| `chrome.css` | Page shell (`.page`, `.page-head`, `.title`, `.lede`, `.page-foot`), controls (`.panel`, `.btn`, `.chip`, `.input`, `.thumb`), the wobble keyframes | A new page or control should look like the rest |

Rules of the road:

- A page's own sheet holds only that page's layout. `app/menu.css`,
  `app/editor.css`, `app/viewer.css` and `app/hud.css` never restate a token
  or a control.
- Nothing outside `tokens.css` uses a raw colour, font stack or duration.
- A control moves into `chrome.css` when a second page needs it, not before.
  `.cbtn`, the round icon button, is still viewer-only for that reason.
- To give one page its own mood, override a token on `:root` in that page's
  sheet. It loads after `tokens.css`, so it wins.
