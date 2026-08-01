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

const JOURNEY_TEMPLATE_COUNT = 720;
const CONNECTION_RADIUS_METERS = 32;
const MIN_JOURNEY_METERS = 900;
const MAX_JOURNEY_SEGMENTS = 36;

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

function hashInteger(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function allocateIntegers(values, total) {
  const valueTotal = values.reduce((sum, value) => sum + value, 0);
  const allocations = values.map((value) => Math.floor((value / valueTotal) * total));
  let remainder = total - allocations.reduce((sum, value) => sum + value, 0);
  const rankedRemainders = values
    .map((value, index) => ({
      index,
      remainder: (value / valueTotal) * total - allocations[index],
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) {
    allocations[rankedRemainders[index].index] += 1;
  }
  return allocations;
}

function buildHourlyJourneyCounts(profile) {
  const observedDaytimeCrossings = RECENT_SUNDAY_COUNTS.reduce(
    (sum, value) => sum + value,
    0,
  );
  const daytimeProfile = profile.slice(7, 19);
  const scale =
    observedDaytimeCrossings /
    daytimeProfile.reduce((sum, value) => sum + value, 0);
  const modeledDailyJourneys = Math.round(
    profile.reduce((sum, value) => sum + value, 0) * scale,
  );
  const hourlyJourneyCounts = Array(24).fill(0);
  const daytimeCounts = allocateIntegers(daytimeProfile, observedDaytimeCrossings);
  const nightHours = [...Array(7).keys(), ...Array.from({ length: 5 }, (_, index) => index + 19)];
  const nightCounts = allocateIntegers(
    nightHours.map((hour) => profile[hour]),
    modeledDailyJourneys - observedDaytimeCrossings,
  );
  for (let index = 0; index < daytimeCounts.length; index += 1) {
    hourlyJourneyCounts[index + 7] = daytimeCounts[index];
  }
  for (let index = 0; index < nightHours.length; index += 1) {
    hourlyJourneyCounts[nightHours[index]] = nightCounts[index];
  }
  return { hourlyJourneyCounts, modeledDailyJourneys, observedDaytimeCrossings };
}

function endpointCell(coordinate) {
  return [
    Math.floor(coordinate[0] / 0.0005),
    Math.floor(coordinate[1] / 0.0003),
  ];
}

function endpointKey(x, y) {
  return `${x}:${y}`;
}

function buildEndpointIndex(routes) {
  const grid = new Map();
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex];
    const endpoints = [route.path[0], route.path[route.path.length - 1]];
    for (let endIndex = 0; endIndex < endpoints.length; endIndex += 1) {
      const coordinate = endpoints[endIndex];
      const [cellX, cellY] = endpointCell(coordinate);
      const key = endpointKey(cellX, cellY);
      const entries = grid.get(key) ?? [];
      entries.push({ coordinate, endIndex, routeIndex });
      grid.set(key, entries);
    }
  }
  return grid;
}

function nearbyEndpoints(coordinate, endpointIndex) {
  const [cellX, cellY] = endpointCell(coordinate);
  const result = [];
  for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      const entries = endpointIndex.get(endpointKey(cellX + xOffset, cellY + yOffset));
      if (entries) result.push(...entries);
    }
  }
  return result;
}

function vectorAlignment(incomingStart, junction, outgoingEnd) {
  const incomingX = junction[0] - incomingStart[0];
  const incomingY = junction[1] - incomingStart[1];
  const outgoingX = outgoingEnd[0] - junction[0];
  const outgoingY = outgoingEnd[1] - junction[1];
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  if (incomingLength === 0 || outgoingLength === 0) return 0;
  return (
    (incomingX * outgoingX + incomingY * outgoingY) /
    (incomingLength * outgoingLength)
  );
}

function chooseWeightedRoute(routes, random) {
  let totalWeight = 0;
  for (const route of routes) {
    totalWeight += Math.sqrt(route.lengthMeters) * route.weight;
  }
  let target = random() * totalWeight;
  for (let index = 0; index < routes.length; index += 1) {
    target -= Math.sqrt(routes[index].lengthMeters) * routes[index].weight;
    if (target <= 0) return index;
  }
  return routes.length - 1;
}

function orientPath(route, reverse) {
  return reverse ? [...route.path].reverse() : route.path;
}

function buildJourneyTemplates(routes) {
  const endpointIndex = buildEndpointIndex(routes);
  const journeys = [];
  const signatures = new Set();

  for (
    let attempt = 0;
    journeys.length < JOURNEY_TEMPLATE_COUNT && attempt < JOURNEY_TEMPLATE_COUNT * 40;
    attempt += 1
  ) {
    const random = createRandom(hashInteger(`journey:${attempt}`));
    const startRouteIndex = chooseWeightedRoute(routes, random);
    const startRoute = routes[startRouteIndex];
    const routeIndexes = [startRouteIndex];
    const usedRoutes = new Set(routeIndexes);
    const path = [...orientPath(startRoute, random() > 0.5)];
    let journeyLength = startRoute.lengthMeters;
    let demandTotal = startRoute.weight * startRoute.lengthMeters;
    const targetLength = 1_800 + random() * 5_200;

    while (
      journeyLength < targetLength &&
      routeIndexes.length < MAX_JOURNEY_SEGMENTS
    ) {
      const junction = path[path.length - 1];
      const incomingStart = path[Math.max(0, path.length - 2)];
      const candidates = [];
      for (const endpoint of nearbyEndpoints(junction, endpointIndex)) {
        if (usedRoutes.has(endpoint.routeIndex)) continue;
        const gap = distanceMeters(junction, endpoint.coordinate);
        if (gap > CONNECTION_RADIUS_METERS) continue;
        const candidateRoute = routes[endpoint.routeIndex];
        const candidatePath = orientPath(candidateRoute, endpoint.endIndex === 1);
        if (candidatePath.length < 2) continue;
        const alignment = vectorAlignment(incomingStart, junction, candidatePath[1]);
        if (alignment < -0.72) continue;
        candidates.push({
          alignment,
          candidatePath,
          gap,
          route: candidateRoute,
          routeIndex: endpoint.routeIndex,
          score: candidateRoute.weight * 0.62 + (alignment + 1) * 0.22 + random() * 0.16,
        });
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => b.score - a.score || a.gap - b.gap);
      const selected = candidates[0];
      const previousEnd = path[path.length - 1];
      const nextStart = selected.candidatePath[0];
      if (previousEnd[0] !== nextStart[0] || previousEnd[1] !== nextStart[1]) {
        path.push(nextStart);
        journeyLength += selected.gap;
      }
      path.push(...selected.candidatePath.slice(1));
      journeyLength += selected.route.lengthMeters;
      demandTotal += selected.route.weight * selected.route.lengthMeters;
      routeIndexes.push(selected.routeIndex);
      usedRoutes.add(selected.routeIndex);
    }

    if (journeyLength < MIN_JOURNEY_METERS) continue;
    const signature = routeIndexes.join(":");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    journeys.push({
      demandWeight: Number((demandTotal / journeyLength).toFixed(3)),
      lengthMeters: Number(journeyLength.toFixed(1)),
      path: cleanPath(path),
    });
  }

  if (journeys.length < JOURNEY_TEMPLATE_COUNT) {
    throw new Error(
      `Only generated ${journeys.length} connected journey templates; expected ${JOURNEY_TEMPLATE_COUNT}.`,
    );
  }
  return journeys;
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

  const hourlyProfile = buildHourlyProfile();
  const journeys = buildJourneyTemplates(routes);
  const {
    hourlyJourneyCounts,
    modeledDailyJourneys,
    observedDaytimeCrossings,
  } = buildHourlyJourneyCounts(hourlyProfile);

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      routeCount: routes.length,
      journeyTemplateCount: journeys.length,
      modeledDailyJourneys,
      observedDaytimeCrossings,
      recentCountLocations: counts.length,
      modelDescription:
        "Count-preserving synthetic journeys on connected existing bicycle infrastructure. Route demand is weighted by the latest 2023–25 municipal bicycle AADT nearby. The exact modeled daily total is calibrated to 12,127 aggregate crossings observed from 07:00–19:00 at four locations on 22 June 2025, with a broader 2014 summer-Sunday profile supplying unobserved hours. Journeys are plausible modeled paths, not recorded trajectories or unique real cyclists.",
      sources: {
        network: CYCLE_NETWORK_URL,
        trafficCounts: TRAFFIC_COUNTS_URL,
        recentSunday: "Copenhagen municipal manual counts, 22 June 2025",
        overnightShape: "Copenhagen fixed bicycle counters, summer Sundays 2014",
      },
    },
    hourlyProfile,
    hourlyJourneyCounts,
    // Tuple schema: [category index, length in meters, relative weight,
    // delta-encoded coordinates in millionths of a degree]. This keeps the
    // public artifact small without hiding or changing the model.
    routes: routes.map((route) => [
      CATEGORY_INDEX[route.category],
      route.lengthMeters,
      route.weight,
      packPath(route.path),
    ]),
    // Tuple schema: [length in meters, relative demand weight,
    // delta-encoded coordinates]. Each template is a connected synthetic path
    // assembled from nearby official network segments. Individual journeys are
    // deterministically scheduled in the browser from hourlyJourneyCounts.
    journeys: journeys.map((journey) => [
      journey.lengthMeters,
      journey.demandWeight,
      packPath(journey.path),
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
    `Wrote ${routes.length.toLocaleString("en")} routes, ${journeys.length.toLocaleString("en")} connected journey templates, and ${modeledDailyJourneys.toLocaleString("en")} count-equivalent modeled journeys calibrated from ${counts.length.toLocaleString("en")} recent count locations.`,
  );
}

await main();
