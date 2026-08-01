import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CYCLE_NETWORK_URL =
  "https://wfs-kbhkort.kk.dk/k101/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=k101:cykeldata_kk&outputFormat=json&SRSNAME=EPSG:4326";
const TRAFFIC_COUNTS_URL =
  "https://wfs-kbhkort.kk.dk/k101/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=k101:trafiktaelling&outputFormat=json&SRSNAME=EPSG:4326";

// Mean normalized 24-hour shape from 91 direction-total rows observed on
// summer Sundays in Copenhagen's 2014 fixed-counter workbook. Its only job in
// the composite is to supply the hours missing from the recent manual counts.
const HISTORIC_SUNDAY_PROFILE = [
  0.357, 0.2581, 0.2075, 0.1557, 0.1308, 0.1042, 0.1567, 0.226,
  0.3518, 0.6261, 0.7431, 0.9598, 1, 0.9592, 0.8624, 0.814,
  0.7961, 0.7702, 0.6928, 0.5886, 0.4811, 0.4226, 0.328, 0.2405,
];

// Bicycles counted at four Amager Strand locations, 07:00–19:00 on Sunday
// 22 June 2025. The day was warm and partly sunny, with Copenhagen Sprint in
// town, so it is treated as a busy-day rhythm rather than a typical-day total.
const RECENT_SUNDAY_COUNTS = [
  133, 303, 528, 737, 1054, 1282, 1622, 1958, 1526, 1356, 996, 632,
];

const CATEGORY_FACTOR = {
  Cykelmulighed: 0.72,
  Cykelsti: 1,
  Grøn: 0.88,
  Supercykelsti: 1.28,
};

const CATEGORY_INDEX = {
  Cykelmulighed: 0,
  Cykelsti: 1,
  Grøn: 2,
  Supercykelsti: 3,
};

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function distanceMeters(a, b) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * 111_320 * Math.cos(latitude);
  const y = (b[1] - a[1]) * 110_540;
  return Math.hypot(x, y);
}

function lineLength(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function cleanPath(coordinates) {
  const result = [];
  for (const coordinate of coordinates) {
    const point = [Number(coordinate[0].toFixed(6)), Number(coordinate[1].toFixed(6))];
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      result.push(point);
    }
  }
  return result;
}

function pathCenter(coordinates) {
  const middle = coordinates[Math.floor(coordinates.length / 2)];
  return middle;
}

function packPath(coordinates) {
  const packed = [];
  let previousLongitude = 0;
  let previousLatitude = 0;
  for (const coordinate of coordinates) {
    const longitude = Math.round(coordinate[0] * 1_000_000);
    const latitude = Math.round(coordinate[1] * 1_000_000);
    packed.push(longitude - previousLongitude, latitude - previousLatitude);
    previousLongitude = longitude;
    previousLatitude = latitude;
  }
  return packed;
}

function buildHourlyProfile() {
  const recentPeak = Math.max(...RECENT_SUNDAY_COUNTS);
  const profile = [...HISTORIC_SUNDAY_PROFILE];
  for (let hour = 7; hour <= 18; hour += 1) {
    const recent = RECENT_SUNDAY_COUNTS[hour - 7] / recentPeak;
    const recentBlend = hour === 7 || hour === 18 ? 0.25 : hour === 8 || hour === 17 ? 0.45 : 0.6;
    // Recent observations dominate the visible daytime; the wider historic
    // sample tempers the beach/event-specific peak. The blend tapers at both
    // ends so the unobserved hours join without an artificial density jump.
    profile[hour] =
      recent * recentBlend + HISTORIC_SUNDAY_PROFILE[hour] * (1 - recentBlend);
  }
  const peak = Math.max(...profile);
  return profile.map((value) => Number((value / peak).toFixed(4)));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return response.json();
}

function latestRecentCounts(features) {
  const latestByLocation = new Map();
  for (const feature of features) {
    const properties = feature.properties ?? {};
    if (
      properties.aar < 2023 ||
      properties.aar > 2025 ||
      !Number.isFinite(properties.aadt_cykler) ||
      properties.aadt_cykler <= 0 ||
      feature.geometry?.type !== "Point"
    ) {
      continue;
    }
    const key = String(properties.t_nr);
    const existing = latestByLocation.get(key);
    if (!existing || properties.taelle_dato > existing.date) {
      latestByLocation.set(key, {
        coordinate: feature.geometry.coordinates,
        aadt: properties.aadt_cykler,
        date: properties.taelle_dato,
      });
    }
  }
  return [...latestByLocation.values()];
}

function estimateTraffic(center, counts) {
  const nearest = counts
    .map((count) => ({ ...count, distance: distanceMeters(center, count.coordinate) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  let weightedTotal = 0;
  let totalWeight = 0;
  for (const count of nearest) {
    const weight = Math.exp(-count.distance / 1_350);
    weightedTotal += count.aadt * weight;
    totalWeight += weight;
  }
  if (totalWeight < 0.025) return 2_500;
  return weightedTotal / totalWeight;
}

async function main() {
  const [network, traffic] = await Promise.all([
    fetchJson(CYCLE_NETWORK_URL),
    fetchJson(TRAFFIC_COUNTS_URL),
  ]);
  const counts = latestRecentCounts(traffic.features);
  const routes = [];

  for (const feature of network.features) {
    const properties = feature.properties ?? {};
    if (properties.status !== "Eksisterende") continue;
    const category = properties.kategori;
    if (!(category in CATEGORY_FACTOR)) continue;

    const geometry = feature.geometry;
    const lines =
      geometry?.type === "MultiLineString"
        ? geometry.coordinates
        : geometry?.type === "LineString"
          ? [geometry.coordinates]
          : [];

    for (let part = 0; part < lines.length; part += 1) {
      const routePath = cleanPath(lines[part]);
      if (routePath.length < 2) continue;
      const lengthMeters = lineLength(routePath);
      if (lengthMeters < 12) continue;

      const estimatedAadt = estimateTraffic(pathCenter(routePath), counts);
      const spatial = clamp(
        (Math.log(estimatedAadt) - Math.log(1_200)) /
          (Math.log(28_000) - Math.log(1_200)),
        0,
        1,
      );
      const weight = clamp((0.22 + spatial * 0.88) * CATEGORY_FACTOR[category], 0.12, 1.25);

      routes.push({
        id: `${properties.id}-${part}`,
        category,
        path: routePath,
        lengthMeters: Number(lengthMeters.toFixed(1)),
        weight: Number(weight.toFixed(3)),
      });
    }
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      routeCount: routes.length,
      recentCountLocations: counts.length,
      modelDescription:
        "Existing bicycle infrastructure weighted by the latest 2023–25 municipal bicycle AADT nearby. Daytime rhythm blends June 2025 Sunday observations with a broader 2014 summer-Sunday profile; the older profile supplies unobserved night hours. Particles are illustrative flow, not recorded trajectories.",
      sources: {
        network: CYCLE_NETWORK_URL,
        trafficCounts: TRAFFIC_COUNTS_URL,
        recentSunday: "Copenhagen municipal manual counts, 22 June 2025",
        overnightShape: "Copenhagen fixed bicycle counters, summer Sundays 2014",
      },
    },
    hourlyProfile: buildHourlyProfile(),
    // Tuple schema: [category index, length in meters, relative weight,
    // delta-encoded coordinates in millionths of a degree]. This keeps the
    // public artifact small without hiding or changing the model.
    routes: routes.map((route) => [
      CATEGORY_INDEX[route.category],
      route.lengthMeters,
      route.weight,
      packPath(route.path),
    ]),
  };

  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const outputDirectory = path.resolve(currentDirectory, "../public/data");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "copenhagen-flow.json"),
    `${JSON.stringify(output)}\n`,
    "utf8",
  );
  console.log(
    `Wrote ${routes.length.toLocaleString("en")} routes calibrated from ${counts.length.toLocaleString("en")} recent count locations.`,
  );
}

await main();
