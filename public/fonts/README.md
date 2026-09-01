# Display font subsets

`noto-serif-sc-display.woff2` is a static 800-weight subset of
[Noto Serif SC](https://github.com/google/fonts/blob/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf).
It covers the static Chinese copy used across the public site. Dynamic titles gracefully fall back
to the platform Songti family for glyphs outside this set.

`noto-sans-sc-roles.woff2` is a 100–900 variable-weight subset of
[Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf).
It contains only the four glyphs used by the role display (`U+505A`, `U+6253`, `U+64AD`, and
`U+8BF4`), keeping the typography consistent across Apple, Windows, and Android browsers. Both
browser fonts remain under the SIL Open Font License in `noto-serif-sc-OFL.txt`.

`noto-serif-sc-og-800.ttf` is a static 800-weight subset for the five glyphs in the generated Open
Graph title. `ImageResponse` reads this TTF directly because its renderer does not use the browser
WOFF2 file.

If public copy changes, regenerate the display subset from the official source. Build the Unicode
list from public routes, public-facing components, and the local fixture before running
`pyftsubset`:

```sh
SERIF_UNICODES=$(rg -o --no-filename -P '\p{Han}' 'app/(public)' components/domain \
  components/home components/layout cloudflare/fixtures/local-seed.sql | LC_ALL=C sort -u | \
  perl -CSD -ne 'chomp; printf "U+%04X,", ord($_)')

uvx --from 'fonttools[woff]' fonttools varLib.instancer 'NotoSerifSC[wght].ttf' \
  wght=800 --output='NotoSerifSC-800.ttf'

uvx --from 'fonttools[woff]' pyftsubset 'NotoSerifSC-800.ttf' \
  --output-file='public/fonts/noto-serif-sc-display.woff2' \
  --flavor=woff2 \
  --unicodes="${SERIF_UNICODES}U+FF01-FF65" \
  --layout-features='*' \
  --name-IDs='*' \
  --name-languages='*' \
  --name-legacy \
  --glyph-names \
  --symbol-cmap \
  --legacy-cmap \
  --notdef-glyph \
  --notdef-outline \
  --recommended-glyphs
```

Regenerate the role display subset with:

```sh
uvx --from 'fonttools[woff]' pyftsubset 'NotoSansSC[wght].ttf' \
  --output-file='public/fonts/noto-sans-sc-roles.woff2' \
  --flavor=woff2 \
  --unicodes='U+505A,U+6253,U+64AD,U+8BF4' \
  --layout-features='*' \
  --name-IDs='*' \
  --name-languages='*' \
  --name-legacy \
  --glyph-names \
  --symbol-cmap \
  --legacy-cmap \
  --notdef-glyph \
  --notdef-outline \
  --recommended-glyphs
```

Create the Open Graph font from a static instance of the same official variable source:

```sh
uvx --from 'fonttools[woff]' fonttools varLib.instancer 'NotoSerifSC[wght].ttf' \
  wght=800 --output='NotoSerifSC-800.ttf'
uvx --from 'fonttools[woff]' pyftsubset 'NotoSerifSC-800.ttf' \
  --output-file='public/fonts/noto-serif-sc-og-800.ttf' \
  --unicodes='U+5B81,U+7406,U+7535,U+793E,U+7ADE' \
  --layout-features='*' \
  --name-IDs='*' \
  --name-languages='*' \
  --name-legacy \
  --glyph-names \
  --symbol-cmap \
  --legacy-cmap \
  --notdef-glyph \
  --notdef-outline \
  --recommended-glyphs
```
