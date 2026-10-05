# scripts

Dev-only Node helpers, never bundled into the app.

Regenerate the committed emoji data in `src/model/emoji/`: `node scripts/generate-emoji.mjs`

Responsive layout measurements (D7), needs `npm run dev` running:

    node scripts/measure-layout.mjs [--url=…] [--widths=820x900,390x700,1280x900] [--browser=…]
