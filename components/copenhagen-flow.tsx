"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";

const BASE_PATH = "/Copenhagen";
const LOOP_MS = 60_000;
const DAY_SECONDS = 86_400;

type Coordinate = [number, number];

type FlowRoute = {
  id: string;
  path: Coordinate[];
  lengthMeters: number;
  weight: number;
  category: "Cykelsti" | "Cykelmulighed" | "Grøn" | "Supercykelsti";
};

type PackedRoute = [
  categoryIndex: number,
  lengthMeters: number,
  weight: number,
  coordinateDeltas: number[],
];

type FlowDataFile = {
  metadata: {
    generatedAt: string;
    routeCount: number;
    recentCountLocations: number;
    modelDescription: string;
  };
  hourlyProfile: number[];
  routes: PackedRoute[];
};

type FlowData = Omit<FlowDataFile, "routes"> & { routes: FlowRoute[] };

type HydratedRoute = FlowRoute & {
  cumulative: number[];
};

type ParticleSeed = {
  route: HydratedRoute;
  phase: number;
  activation: number;
  speed: number;
  reverse: boolean;
  size: number;
};

type RenderParticle = {
  position: Coordinate;
  alpha: number;
  size: number;
};

type WaterPolygon = {
  geometry: {
    type: "Polygon";
    coordinates: Coordinate[][];
  };
};

type WaterDataFile = {
  type: "FeatureCollection";
  features: WaterPolygon[];
};

const VIEW_STATE = {
  longitude: 12.565,
  latitude: 55.675,
  zoom: 10.9,
  minZoom: 9.8,
  maxZoom: 14,
  pitch: 0,
  bearing: 0,
};

const NETWORK_COLORS: Record<FlowRoute["category"], [number, number, number, number]> = {
  Cykelsti: [8, 56, 72, 108],
  Cykelmulighed: [10, 77, 87, 72],
  Grøn: [30, 108, 83, 92],
  Supercykelsti: [190, 57, 23, 150],
};

const PACKED_CATEGORIES: FlowRoute["category"][] = [
  "Cykelmulighed",
  "Cykelsti",
  "Grøn",
  "Supercykelsti",
];

function unpackRoutes(routes: PackedRoute[]): FlowRoute[] {
  return routes.map(([categoryIndex, lengthMeters, weight, deltas], routeIndex) => {
    const path: Coordinate[] = [];
    let longitude = 0;
    let latitude = 0;
    for (let index = 0; index < deltas.length; index += 2) {
      longitude += deltas[index];
      latitude += deltas[index + 1];
      path.push([longitude / 1_000_000, latitude / 1_000_000]);
    }
    return {
      id: String(routeIndex),
      category: PACKED_CATEGORIES[categoryIndex],
      lengthMeters,
      weight,
      path,
    };
  });
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * 111_320 * Math.cos(latitude);
  const y = (b[1] - a[1]) * 110_540;
  return Math.hypot(x, y);
}

function hydrateRoute(route: FlowRoute): HydratedRoute {
  const cumulative = [0];
  for (let index = 1; index < route.path.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + distanceMeters(route.path[index - 1], route.path[index]),
    );
  }
  return { ...route, cumulative };
}

function interpolatePosition(route: HydratedRoute, rawProgress: number): Coordinate {
  const progress = Math.max(0, Math.min(0.999999, rawProgress));
  const target = progress * route.cumulative[route.cumulative.length - 1];
  let low = 1;
  let high = route.cumulative.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.cumulative[middle] < target) low = middle + 1;
    else high = middle;
  }

  const endIndex = low;
  const startIndex = Math.max(0, endIndex - 1);
  const startDistance = route.cumulative[startIndex];
  const segmentLength = Math.max(1, route.cumulative[endIndex] - startDistance);
  const segmentProgress = (target - startDistance) / segmentLength;
  const start = route.path[startIndex];
  const end = route.path[endIndex];

  return [
    start[0] + (end[0] - start[0]) * segmentProgress,
    start[1] + (end[1] - start[1]) * segmentProgress,
  ];
}

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function formatClock(simulatedSeconds: number) {
  const hour = Math.floor(simulatedSeconds / 3600) % 24;
  const minute = Math.floor((simulatedSeconds % 3600) / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function activityAt(profile: number[], simulatedSeconds: number) {
  const hour = simulatedSeconds / 3600;
  const index = Math.floor(hour) % 24;
  const next = (index + 1) % 24;
  const fraction = hour - Math.floor(hour);
  return profile[index] + (profile[next] - profile[index]) * fraction;
}

function daylightAt(simulatedSeconds: number) {
  const hour = simulatedSeconds / 3600;
  if (hour < 4.5 || hour > 22) return 0;
  if (hour < 7) return (hour - 4.5) / 2.5;
  if (hour > 19.5) return (22 - hour) / 2.5;
  return 1;
}

function PlayIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 5 11 7-11 7z" />
    </svg>
  );
}

export default function CopenhagenFlow() {
  const [flowData, setFlowData] = useState<FlowData | null>(null);
  const [waterPolygons, setWaterPolygons] = useState<WaterPolygon[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const lastFrame = useRef<number | null>(null);
  const [initialViewState] = useState(() => ({
    ...VIEW_STATE,
    zoom: window.innerWidth <= 720 ? 10.25 : VIEW_STATE.zoom,
  }));

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${BASE_PATH}/data/copenhagen-flow.json`, { signal: controller.signal }),
      fetch(`${BASE_PATH}/data/copenhagen-water.json`, { signal: controller.signal }),
    ])
      .then(([flowResponse, waterResponse]) => {
        if (!flowResponse.ok) {
          throw new Error(`Traffic data request failed: ${flowResponse.status}`);
        }
        if (!waterResponse.ok) {
          throw new Error(`Map data request failed: ${waterResponse.status}`);
        }
        return Promise.all([
          flowResponse.json() as Promise<FlowDataFile>,
          waterResponse.json() as Promise<WaterDataFile>,
        ]);
      })
      .then(([data, water]) => {
        setFlowData({ ...data, routes: unpackRoutes(data.routes) });
        setWaterPolygons(water.features);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playing) {
      lastFrame.current = null;
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      if (lastFrame.current === null) lastFrame.current = now;
      const delta = now - lastFrame.current;
      if (delta >= 30) {
        setElapsedMs((value) => (value + delta) % LOOP_MS);
        lastFrame.current = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const routes = useMemo(
    () => flowData?.routes.map(hydrateRoute) ?? [],
    [flowData],
  );

  const seeds = useMemo<ParticleSeed[]>(() => {
    const result: ParticleSeed[] = [];
    for (const route of routes) {
      const count = Math.max(
        1,
        Math.min(
          6,
          Math.round((route.lengthMeters / 175) * (0.34 + route.weight * 0.9)),
        ),
      );
      for (let index = 0; index < count; index += 1) {
        const key = `${route.id}:${index}`;
        result.push({
          route,
          phase: hashUnit(`${key}:phase`),
          activation: hashUnit(`${key}:active`),
          speed: 0.045 + hashUnit(`${key}:speed`) * 0.095,
          reverse: hashUnit(`${key}:direction`) > 0.5,
          size: 1 + hashUnit(`${key}:size`) * 0.85,
        });
      }
    }
    return result;
  }, [routes]);

  const simulatedSeconds = (elapsedMs / LOOP_MS) * DAY_SECONDS;
  const activity = flowData
    ? activityAt(flowData.hourlyProfile, simulatedSeconds)
    : 0;
  const daylight = daylightAt(simulatedSeconds);

  const particles = useMemo<RenderParticle[]>(() => {
    if (!flowData) return [];
    const elapsedSeconds = elapsedMs / 1000;
    const visibleThreshold = 0.05 + activity * 0.52;
    const result: RenderParticle[] = [];

    for (const seed of seeds) {
      if (seed.activation > visibleThreshold) continue;
      let progress = (seed.phase + elapsedSeconds * seed.speed) % 1;
      if (seed.reverse) progress = 1 - progress;
      result.push({
        position: interpolatePosition(seed.route, progress),
        alpha: 0.7 + activity * 0.3,
        size: seed.size * (0.92 + seed.route.weight * 0.16),
      });
    }
    return result;
  }, [activity, elapsedMs, flowData, seeds]);

  const layers = useMemo(
    () => [
      new PolygonLayer<WaterPolygon>({
        id: "water",
        data: waterPolygons,
        getPolygon: (feature) => feature.geometry.coordinates,
        getFillColor: [43, 145, 163, 255],
        filled: true,
        stroked: false,
        pickable: false,
      }),
      new PathLayer<HydratedRoute>({
        id: "cycle-network",
        data: routes,
        getPath: (route) => route.path,
        getColor: (route) => NETWORK_COLORS[route.category],
        getWidth: (route) => 0.55 + route.weight * 1.45,
        widthUnits: "pixels",
        widthMinPixels: 0.45,
        widthMaxPixels: 3,
        jointRounded: true,
        capRounded: true,
        pickable: false,
      }),
      new ScatterplotLayer<RenderParticle>({
        id: "bicycles",
        data: particles,
        getPosition: (particle) => particle.position,
        getRadius: (particle) => particle.size * 1.35,
        radiusUnits: "pixels",
        radiusMinPixels: 1.25,
        getFillColor: (particle) => [210, 68, 42, Math.round(238 * particle.alpha)],
        stroked: true,
        getLineColor: (particle) => [248, 235, 205, Math.round(220 * particle.alpha)],
        getLineWidth: 0.75,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.6,
        pickable: false,
      }),
    ],
    [particles, routes, waterPolygons],
  );

  const togglePlayback = useCallback(() => setPlaying((value) => !value), []);
  const replay = useCallback(() => {
    setElapsedMs(0);
    setPlaying(true);
  }, []);

  if (loadError) {
    return (
      <main className="error-state">
        <p>THE BICYCLE CITY IS RESTING</p>
        <h1>Traffic data could not be loaded.</h1>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="experience">
      <div className="map-stage">
        <DeckGL
          initialViewState={initialViewState}
          controller={false}
          layers={layers}
        />
      </div>

      <div
        className="night-wash"
        style={{ opacity: 0.04 + (1 - daylight) * 0.38 }}
        aria-hidden="true"
      />
      <div className="paper-grain" aria-hidden="true" />

      <header className="masthead">
        <p className="eyebrow">One summer Sunday · a modeled day</p>
        <h1>Copenhagen</h1>
        <p className="dek">Twenty-four hours of bicycle traffic in sixty seconds</p>
      </header>

      <aside className="weather-note" aria-label="Modeled day conditions">
        <span>Sunday</span>
        <span>25°C</span>
        <span>Partly sunny</span>
      </aside>

      <section className="playback" aria-label="Playback controls">
        <button
          className="playback__button"
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause playback" : "Resume playback"}
        >
          <PlayIcon playing={playing} />
        </button>
        <time className="clock" dateTime={`T${formatClock(simulatedSeconds)}`}>
          {formatClock(simulatedSeconds)}
        </time>
        <button className="replay" type="button" onClick={replay}>
          Replay day
        </button>
      </section>

      <div className="progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${elapsedMs / LOOP_MS})` }} />
      </div>

      <footer className="source-note">
        Modeled, not tracked trips · Copenhagen municipal data 2014–25
      </footer>
      <div className="map-attribution">
        <a href="https://openfreemap.org">OpenFreeMap</a>
        <span> · </span>
        <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
      </div>
    </main>
  );
}
