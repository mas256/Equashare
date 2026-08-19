# Equashare

### Write a formula. Turn it into an image. Share it.

When you just want to share a single formula with someone, you shouldn't have to build a whole PDF for it.
Equashare is a lightweight formula editor that turns LaTeX math into an image in a few keystrokes.

Type only the formula and watch it render in real time. No document structure, no PDF pipeline to think
about — just the formula itself.

The toolbar helps you write LaTeX: common notation and structures can be inserted with a click, so you
spend less time looking up commands and more time writing the formula.

Once it's ready, copy the finished formula to the clipboard as PNG, or save it as PNG, JPEG, or SVG.

Rust-powered processing and efficient rendering keep everything snappy, from typing to preview. The goal
is the simplest possible path from "writing a formula" to "having an image of it."

No large PDF. No dedicated viewer. Just the image of the formula, and nothing else.

It's a tool for producing images to paste into slides or documents that contain math, and it works
entirely offline.

## Key features

- **Real-time preview**: see the LaTeX formula rendered as you type, without stutter while typing
- **Preview zoom/pan**, **light/dark theme**, and drag-to-resize layout
- **Japanese support**: text rendered with Noto Serif JP
- **Choose how to export**: copy to clipboard (`Ctrl+Shift+C`) or save to a file (`Ctrl+S`) — no file is
  ever written unless you explicitly save
- **Two ways to save the LaTeX source**:
  - **Save source (.tex)**: saves the contents of the input box as-is (without a `\documentclass` etc.)
    as `.tex`, for pasting into an existing LaTeX document
- **Output format**: choose SVG (vector) or PNG, with font size, resolution scale, padding (px), text
  color, and background color (including transparency)
- **Input assistance**: insert common formula samples, plus template buttons for fractions, roots,
  sub/superscripts, summation, integrals, and more

See the ? button in the top right of the app for full details.

## Requirements

- Windows 10 / 11 (64-bit)

## Development

```
npm install
npm run dev      # dev server
npm test         # unit tests
npm run build    # verify the frontend build
```

When verifying `.tex` export, in addition to `npm run build`, it's recommended to actually compile the
output with a real LaTeX engine (pdflatex/xelatex, etc.). MathJax in the preview is more lenient with
syntax than a real LaTeX engine, so the preview showing no error doesn't guarantee it will actually
compile.

## Usage

1. When the app starts, a sample formula appears in the input box on the left
2. Type a formula in LaTeX in the input box, and a real-time preview appears on the right (one formula
   per line)
3. Adjust the output format, size, and colors in the settings area above
4. Export with `Ctrl+S` (save file) or `Ctrl+Shift+C` (copy to clipboard)
5. For detailed usage, check the "?" button in the title bar

## License

The app itself is [MIT licensed](LICENSE).

The bundled Japanese font (Noto Serif JP) is licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/). Redistribution and modification are free, but
the OFL has separate conditions around use of the font's name, etc. See
`public/fonts/LICENSE-NotoSerifJP.txt` for details.
