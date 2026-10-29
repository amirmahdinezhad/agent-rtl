# Bundled font

Vazir 30.1.0 is bundled for Persian and English text.

- `Vazir-Regular.woff2`: embedded in the app payload, without downloading.
- `Vazir-Regular.ttf` and `Vazir-Bold.ttf`: registered only within the installer process, without system-wide installation.
- `Vazir-OFL.txt`: the complete SIL Open Font License 1.1 and copyright notice.

Files are unchanged from the [official source](https://github.com/rastikerdar/vazirmatn/tree/v30.1.0).

## Rasta brand assets

- `rasta-mark.svg`: charcoal app tile with the approved lavender text mark.
- `rasta-glyph.svg`: transparent mark for small interface surfaces.

The panel uses the same three right-aligned strokes. The native `drawBrand` function draws them for Setup and all generated macOS icon sizes. Brand colors stay charcoal (`#252529`) and lavender (`#AD8CF3`) independently of the selected control accent. The panel darkens lavender on light surfaces to preserve contrast. The approved generated concept is saved in `docs/branding/rasta-approved-concept.png`.
