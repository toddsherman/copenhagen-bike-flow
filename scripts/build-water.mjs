import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const ZOOM = 12;
const BOUNDS = {
  west: 12.25,
  south: 55.48,
  east: 12.86,
  north: 55.88,
};

function tileForCoordinate(longitude, latitude) {
  const scale = 2 ** ZOOM;
  return {
    x: Math.floor(((longitude + 180) / 360) * scale),
    y: Math.floor(
      ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) *
        scale,
    ),
  };
}

function roundCoordinates(value) {
  if (typeof value[0] === "number") {
    return value.map((coordinate) => Number(coordinate.toFixed(6)));
  }
  return value.map(roundCoordinates);
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const tileJsonResponse = await fetch(TILEJSON_URL);
  if (!tileJsonResponse.ok) {
    throw new Error(`${tileJsonResponse.status} fetching ${TILEJSON_URL}`);
  }
  const tileJson = await tileJsonResponse.json();
  const tileTemplate = tileJson.tiles?.[0];
  if (!tileTemplate) throw new Error("OpenFreeMap TileJSON did not contain a tile URL.");

  const northWest = tileForCoordinate(BOUNDS.west, BOUNDS.north);
  const southEast = tileForCoordinate(BOUNDS.east, BOUNDS.south);
  const tiles = [];

  for (let x = northWest.x; x <= southEast.x; x += 1) {
    for (let y = northWest.y; y <= southEast.y; y += 1) {
      tiles.push({ x, y });
    }
  }

  const features = (
    await Promise.all(
      tiles.map(async ({ x, y }) => {
        const url = tileTemplate
          .replace("{z}", String(ZOOM))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
        const tile = new VectorTile(new PbfReader(await fetchBuffer(url)));
        const water = tile.layers.water;
        if (!water) return [];

        const tileFeatures = [];
        for (let index = 0; index < water.length; index += 1) {
          const feature = water.feature(index).toGeoJSON(x, y, ZOOM);
          const polygons =
            feature.geometry.type === "MultiPolygon"
              ? feature.geometry.coordinates
              : [feature.geometry.coordinates];

          for (const coordinates of polygons) {
            tileFeatures.push({
              type: "Feature",
              properties: { class: feature.properties?.class ?? "water" },
              geometry: {
                type: "Polygon",
                coordinates: roundCoordinates(coordinates),
              },
            });
          }
        }
        return tileFeatures;
      }),
    )
  ).flat();

  const output = {
    type: "FeatureCollection",
    metadata: {
      source: TILEJSON_URL,
      sourceVersion: tileJson.version,
      generatedAt: new Date().toISOString(),
      zoom: ZOOM,
      bounds: BOUNDS,
    },
    features,
  };

  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const outputDirectory = path.resolve(currentDirectory, "../public/data");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "copenhagen-water.json"),
    `${JSON.stringify(output)}\n`,
    "utf8",
  );
  console.log(
    `Wrote ${features.length.toLocaleString("en")} water polygons from ${tiles.length} vector tiles.`,
  );
}

await main();
