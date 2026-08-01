# Copenhagen Bike Flow

A sixty-second, continuously looping visualization of a modeled summer Sunday of bicycle traffic across Copenhagen. It is designed for `todd.sh/Copenhagen`. The source stays in this standalone repository; its static Next.js export is published by the existing todd.sh Vercel project.

## What the visualization represents

The moving marks are illustrative flows, not GPS traces or recorded individual trips. The model combines:

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

`npm run build` writes the deployable site to `out/`. Copy the contents of that directory to `todd.sh/public/Copenhagen/`; the todd.sh build automatically discovers the directory and serves its `index.html` at `/Copenhagen`.

## Data sources and licensing

- [Copenhagen Cykeldata](https://www.opendata.dk/city-of-copenhagen/cykeldata) — CC BY 4.0.
- [Copenhagen Trafiktal](https://www.opendata.dk/city-of-copenhagen/trafiktal) — CC0; the project reads the live municipal WFS rather than the stale portal cache.
- [Copenhagen fixed bicycle counts](https://www.opendata.dk/city-of-copenhagen/faste-cykeltaellinger) — CC BY 4.0.
- A static Copenhagen water layer extracted from [OpenFreeMap](https://openfreemap.org) vector tiles, derived from [OpenStreetMap](https://www.openstreetmap.org/copyright) data under ODbL.

The site displays required basemap attribution. Any reuse of the generated data should preserve the municipal data attribution above.

## Technology

Next.js and React provide the application shell. deck.gl renders the static land/water map, bicycle network, and animated traffic marks in one WebGL canvas. Keeping the coastline in the static export makes the map reliable and removes a runtime tile dependency.
