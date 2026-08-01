# Copenhagen Bike Flow

A sixty-second, continuously looping visualization of a modeled summer Sunday of bicycle traffic across Copenhagen. It is designed for `todd.sh/Copenhagen` and runs as a standalone Next.js app on Vercel.

## What the visualization represents

The glowing particles are illustrative flows, not GPS traces or recorded individual trips. The model combines:

- Copenhagen's current bicycle-infrastructure network for the paths.
- The latest available 2023–25 municipal bicycle traffic counts to weight where flows are strongest.
- Four manual Sunday counts from 22 June 2025 to shape the daytime rhythm.
- The 2014 fixed-counter archive only to fill the hours the 2025 counts did not observe.

The source and model distinction also appears on-screen. See `scripts/build-data.mjs` for the complete, reproducible transformation.

## Run locally

```bash
npm install
npm run generate:data
npm run dev
```

Because the app uses `basePath: "/Copenhagen"`, open [http://localhost:3000/Copenhagen](http://localhost:3000/Copenhagen).

## Data sources and licensing

- [Copenhagen Cykeldata](https://www.opendata.dk/city-of-copenhagen/cykeldata) — CC BY 4.0.
- [Copenhagen Trafiktal](https://www.opendata.dk/city-of-copenhagen/trafiktal) — CC0; the project reads the live municipal WFS rather than the stale portal cache.
- [Copenhagen fixed bicycle counts](https://www.opendata.dk/city-of-copenhagen/faste-cykeltaellinger) — CC BY 4.0.
- Basemap tiles from [OpenFreeMap](https://openfreemap.org), derived from [OpenStreetMap](https://www.openstreetmap.org/copyright) data under ODbL.

The site displays required basemap attribution. Any reuse of the generated data should preserve the municipal data attribution above.

## Technology

Next.js and React provide the application shell. MapLibre renders a custom travel-poster basemap, while deck.gl renders the bicycle network and animated particle layers in WebGL.
