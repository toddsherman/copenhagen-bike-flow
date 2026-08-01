# Copenhagen Bike Flow

A sixty-second, continuously looping visualization of count-constrained synthetic bicycle journeys across Copenhagen. It is designed for `todd.sh/Copenhagen`. The source stays in this standalone repository; its static Next.js export is published by the existing todd.sh Vercel project.

## What the visualization represents

The moving marks are synthetic journeys with stable identities, start times, continuous network paths, and realistic cycling speeds. They are not GPS traces, recovered journeys, or unique real cyclists. The model combines:

- Copenhagen's current bicycle-infrastructure network for the paths.
- The latest available 2023–25 municipal bicycle traffic counts to weight where flows are strongest.
- Four manual Sunday counts from 22 June 2025 to shape the daytime rhythm.
- The 2014 fixed-counter archive only to fill the hours the 2025 counts did not observe.

The generator joins nearby official network segments into 720 connected path templates. It schedules exactly 17,681 count-equivalent journeys across the day: the daytime total is constrained to the 12,127 aggregate crossings observed at four locations from 07:00–19:00 on 22 June 2025, while the documented composite profile estimates the remaining hours. Every modeled journey counts once and moves at 13.7–18.7 km/h. The total is a conserved simulation unit, not a claim about the number of unique people or bicycles citywide.

The source and model distinction also appears on-screen. See `scripts/build-data.mjs` for the complete, reproducible transformation.

## Run locally

```bash
npm install
npm run generate:data
npm run verify:data
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

Next.js and React provide the application shell. deck.gl renders the static land/water map, cool-gray bicycle network, and animated synthetic journeys in one WebGL canvas. The traffic layer uses pale bicycle heads with short coral trails, kept deliberately distinct from the routes beneath them. A midnight-to-midnight bar shows the modeled time and the late-June transition through sunrise, daylight, sunset, and darkness. Keeping the coastline in the static export makes the map reliable and removes a runtime tile dependency.
