# docs/ — Landing Page & Assets

Landing page for [Contractor](https://endlessblink.github.io/contractor/), served via GitHub Pages from `/docs`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Landing page — single HTML file, all CSS/JS inline |
| `demo.gif` | Animated demo of the app (hero section) |
| `demo.webm` | Source video for the GIF |
| `screenshot-chat.png` | Document builder — chat + form view |
| `screenshot-form.png` | Document builder — pricing + payment view |
| `screenshot-dashboard.png` | Dashboard overview |
| `screenshot-knowledge.png` | Knowledge base panel |
| `contractor-cover.png` | Original cover image (not used in current landing page) |

## Regenerating the Demo GIF

```bash
npm run demo                    # Records a 26s demo via Playwright
# Then convert:
ffmpeg -i docs/demo.webm -vf "fps=8,scale=720:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" /tmp/palette.png
ffmpeg -i docs/demo.webm -i /tmp/palette.png -lavfi "fps=8,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" -loop 0 docs/demo.gif
```

The demo script (`e2e/record-demo.mjs`) runs the app binary in an isolated data directory with demo data — no personal information is used.

## Retaking Screenshots

Screenshots are taken via Playwright from a clean app instance:
1. Build the binary: `npm run build`
2. Start with isolation: `CONTRACTOR_DATA_DIR=$(mktemp -d) PORT=16832 dist/executables/contractor-linux-x64-vX.X.X &`
3. Set up demo profile via API
4. Take screenshots with Playwright MCP or `page.screenshot()`

## GitHub Pages

Deployed from: **Settings → Pages → Source: master branch, /docs folder**
URL: https://endlessblink.github.io/contractor/

## Design System

- Theme: "Ink & Frost" — teal `#00d2b4` on dark `#0c0e13`
- Font: Heebo (Google Fonts)
- Direction: RTL Hebrew
- Style: Linear/Vercel-inspired
