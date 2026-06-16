# Design QA: Irori Site

final result: passed

Reference: the approved anime/character-led landing concept from ImageGen, adjusted to use the project's real logo and project-owned character artwork.

Prototype checked: `http://127.0.0.1:1430/`

## Checks

- Hero uses a character-led anime background and the real Irori logo from `apps/desktop/src-tauri/icons/icon.png`.
- Hero includes the requested real system screenshot captured from the desktop React app preview.
- Language switcher works for Chinese, English, Japanese, and Korean.
- Feature, overview, character, and open-source CTA sections are present.
- Desktop viewport checked at 1280x720.
- Mobile viewport checked at 390x844 with no visible text overflow in the first viewport.
- Production build completed with `pnpm site:build`.

## Notes

- The GitHub CTA points to `https://github.com/hikariming/irori`.
- The page is Vercel-ready via `apps/site/vercel.json`.
