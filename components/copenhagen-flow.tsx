"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";

const BASE_PATH = "/Copenhagen";
const LOOP_MS = 60_000;
const DAY_SECONDS = 86_400;
const TRAIL_SEGMENTS = 4;

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
    journeyTemplateCount: number;
    modeledDailyJourneys: number;
    observedDaytimeCrossings: number;
    routeCount: number;
    recentCountLocations: number;
    modelDescription: string;
  };
  hourlyProfile: number[];
  hourlyJourneyCounts: number[];
  journeys: PackedJourney[];
  routes: PackedRoute[];
};

type PackedJourney = [
  lengthMeters: number,
  demandWeight: number,
  coordinateDeltas: number[],
];

type FlowJourney = {
  id: string;
  path: Coordinate[];
  lengthMeters: number;
  demandWeight: number;
};

type FlowData = Omit<FlowDataFile, "journeys" | "routes"> & {
  journeys: FlowJourney[];
  routes: FlowRoute[];
};

type HydratedRoute = FlowRoute & {
  cumulative: number[];
};

type HydratedJourney = FlowJourney & {
  cumulative: number[];
};

type SyntheticTrip = {
  id: number;
  journey: HydratedJourney;
  reverse: boolean;
  size: number;
  speedMetersPerSecond: number;
  startSeconds: number;
};

type RenderParticle = {
  position: Coordinate;
  alpha: number;
  size: number;
};

type RenderTrail = {
  path: [Coordinate, Coordinate];
  alpha: number;
  width: number;
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
  Cykelsti: [46, 77, 79, 145],
  Cykelmulighed: [68, 97, 92, 100],
  Grøn: [51, 105, 79, 120],
  Supercykelsti: [14, 70, 82, 165],
};

const PACKED_CATEGORIES: FlowRoute["category"][] = [
  "Cykelmulighed",
  "Cykelsti",
  "Grøn",
  "Supercykelsti",
];

function unpackPath(deltas: number[]): Coordinate[] {
  const path: Coordinate[] = [];
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < deltas.length; index += 2) {
    longitude += deltas[index];
    latitude += deltas[index + 1];
    path.push([longitude / 1_000_000, latitude / 1_000_000]);
  }
  return path;
}

function unpackRoutes(routes: PackedRoute[]): FlowRoute[] {
  return routes.map(([categoryIndex, lengthMeters, weight, deltas], routeIndex) => {
    return {
      id: String(routeIndex),
      category: PACKED_CATEGORIES[categoryIndex],
      lengthMeters,
      weight,
      path: unpackPath(deltas),
    };
  });
}

function unpackJourneys(journeys: PackedJourney[]): FlowJourney[] {
  return journeys.map(([lengthMeters, demandWeight, deltas], journeyIndex) => ({
    id: String(journeyIndex),
    demandWeight,
    lengthMeters,
    path: unpackPath(deltas),
  }));
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * 111_320 * Math.cos(latitude);
  const y = (b[1] - a[1]) * 110_540;
  return Math.hypot(x, y);
}

function hydratePath<T extends FlowRoute | FlowJourney>(route: T): T & { cumulative: number[] } {
  const cumulative = [0];
  for (let index = 1; index < route.path.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + distanceMeters(route.path[index - 1], route.path[index]),
    );
  }
  return { ...route, cumulative };
}

function interpolatePosition(
  route: { path: Coordinate[]; cumulative: number[] },
  rawProgress: number,
): Coordinate {
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
  return {
    dateTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    display: `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`,
    period: hour < 12 ? "AM" : "PM",
  };
}

function daylightAt(simulatedSeconds: number) {
  const hour = simulatedSeconds / 3600;
  if (hour < 4.5 || hour > 22) return 0;
  if (hour < 7) return (hour - 4.5) / 2.5;
  if (hour > 19.5) return (22 - hour) / 2.5;
  return 1;
}

function weightedIndex(cumulativeWeights: number[], target: number) {
  let low = 0;
  let high = cumulativeWeights.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulativeWeights[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
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
  const methodologyDialog = useRef<HTMLDialogElement>(null);
  const resumeAfterMethodology = useRef(false);
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
        setFlowData({
          ...data,
          journeys: unpackJourneys(data.journeys),
          routes: unpackRoutes(data.routes),
        });
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
    () => flowData?.routes.map(hydratePath) ?? [],
    [flowData],
  );

  const journeys = useMemo(
    () => flowData?.journeys.map(hydratePath) ?? [],
    [flowData],
  );

  const trips = useMemo<SyntheticTrip[]>(() => {
    if (!flowData || journeys.length === 0) return [];
    const cumulativeWeights: number[] = [];
    let totalWeight = 0;
    for (const journey of journeys) {
      totalWeight += journey.demandWeight;
      cumulativeWeights.push(totalWeight);
    }

    const result: SyntheticTrip[] = [];
    let tripId = 0;
    for (let hour = 0; hour < flowData.hourlyJourneyCounts.length; hour += 1) {
      const count = flowData.hourlyJourneyCounts[hour];
      for (let index = 0; index < count; index += 1) {
        const key = `trip:${tripId}`;
        const startFraction = (index + hashUnit(`${key}:start`)) / count;
        const journeyIndex = weightedIndex(
          cumulativeWeights,
          hashUnit(`${key}:journey`) * totalWeight,
        );
        result.push({
          id: tripId,
          journey: journeys[journeyIndex],
          reverse: hashUnit(`${key}:direction`) > 0.5,
          size: 1 + hashUnit(`${key}:size`) * 0.7,
          speedMetersPerSecond: 3.8 + hashUnit(`${key}:speed`) * 1.4,
          startSeconds: hour * 3600 + startFraction * 3600,
        });
        tripId += 1;
      }
    }
    return result;
  }, [flowData, journeys]);

  const simulatedSeconds = (elapsedMs / LOOP_MS) * DAY_SECONDS;
  const daylight = daylightAt(simulatedSeconds);
  const clock = formatClock(simulatedSeconds);

  const { particles, trails } = useMemo<{
    particles: RenderParticle[];
    trails: RenderTrail[];
  }>(() => {
    if (!flowData) return { particles: [], trails: [] };
    const particleResult: RenderParticle[] = [];
    const trailResult: RenderTrail[] = [];

    for (const trip of trips) {
      const ageSeconds =
        (simulatedSeconds - trip.startSeconds + DAY_SECONDS) % DAY_SECONDS;
      const pathLength = trip.journey.cumulative[trip.journey.cumulative.length - 1];
      const durationSeconds = pathLength / trip.speedMetersPerSecond;
      if (ageSeconds > durationSeconds) continue;
      const journeyProgress = ageSeconds / durationSeconds;
      const progress = trip.reverse ? 1 - journeyProgress : journeyProgress;
      const alpha = 0.82 + trip.journey.demandWeight * 0.14;
      particleResult.push({
        position: interpolatePosition(trip.journey, progress),
        alpha,
        size: trip.size,
      });

      const direction = trip.reverse ? -1 : 1;
      const trailSpan = Math.min(
        0.18,
        (145 + trip.journey.demandWeight * 55) /
          Math.max(1, pathLength),
      );
      for (let index = 0; index < TRAIL_SEGMENTS; index += 1) {
        const nearOffset = (index / TRAIL_SEGMENTS) * trailSpan;
        const farOffset = ((index + 1) / TRAIL_SEGMENTS) * trailSpan;
        const nearProgress = progress - direction * nearOffset;
        const farProgress = progress - direction * farOffset;
        if (
          nearProgress < 0 ||
          nearProgress >= 1 ||
          farProgress < 0 ||
          farProgress >= 1
        ) {
          continue;
        }
        const fade = Math.pow(1 - index / TRAIL_SEGMENTS, 1.65);
        trailResult.push({
          path: [
            interpolatePosition(trip.journey, farProgress),
            interpolatePosition(trip.journey, nearProgress),
          ],
          alpha: alpha * fade,
          width: Math.max(0.82, trip.size * (1.1 - index * 0.095)),
        });
      }
    }
    return { particles: particleResult, trails: trailResult };
  }, [flowData, simulatedSeconds, trips]);

  const layers = useMemo(
    () => [
      new PolygonLayer<WaterPolygon>({
        id: "water",
        data: waterPolygons,
        getPolygon: (feature) => feature.geometry.coordinates,
        getFillColor: [61, 181, 194, 255],
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
      new PathLayer<RenderTrail>({
        id: "bicycle-trails",
        data: trails,
        getPath: (trail) => trail.path,
        getColor: (trail) => [221, 73, 39, Math.round(245 * trail.alpha)],
        getWidth: (trail) => trail.width,
        widthUnits: "pixels",
        widthMinPixels: 0.85,
        widthMaxPixels: 2.8,
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
      new ScatterplotLayer<RenderParticle>({
        id: "bicycles",
        data: particles,
        getPosition: (particle) => particle.position,
        getRadius: (particle) => particle.size * 1.1,
        radiusUnits: "pixels",
        radiusMinPixels: 1.2,
        getFillColor: (particle) => [237, 77, 18, Math.round(252 * particle.alpha)],
        stroked: true,
        getLineColor: (particle) => [255, 240, 198, Math.round(248 * particle.alpha)],
        getLineWidth: 0.65,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.45,
        pickable: false,
      }),
    ],
    [particles, routes, trails, waterPolygons],
  );

  const togglePlayback = useCallback(() => setPlaying((value) => !value), []);
  const replay = useCallback(() => {
    setElapsedMs(0);
    setPlaying(true);
  }, []);
  const openMethodology = useCallback(() => {
    resumeAfterMethodology.current = playing;
    setPlaying(false);
    methodologyDialog.current?.showModal();
  }, [playing]);
  const closeMethodology = useCallback(() => {
    methodologyDialog.current?.close();
  }, []);
  const restorePlayback = useCallback(() => {
    if (resumeAfterMethodology.current) setPlaying(true);
    resumeAfterMethodology.current = false;
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
        style={{ opacity: 0.03 + (1 - daylight) * 0.22 }}
        aria-hidden="true"
      />
      <div className="paper-grain" aria-hidden="true" />

      <header className="masthead">
        <p className="eyebrow">One summer Sunday · a modeled day</p>
        <h1>Copenhagen</h1>
        <p className="dek">
          <span>Twenty-four hours of bicycle traffic</span>{" "}
          <span>in sixty seconds</span>
        </p>
      </header>

      <aside className="weather-note" aria-label="Modeled day conditions">
        <span className="weather-note__day">Sunday</span>
        <span className="weather-note__temperature">25°C</span>
        <span className="weather-note__conditions">Partly sunny</span>
        {flowData ? (
          <span className="weather-note__journeys">
            {flowData.metadata.modeledDailyJourneys.toLocaleString("en")} count-equivalent
            journeys
          </span>
        ) : null}
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
        <time className="clock" dateTime={`T${clock.dateTime}`}>
          <span>{clock.display}</span>
          <span className="clock__period">{clock.period}</span>
        </time>
        <button className="replay" type="button" onClick={replay}>
          Replay day
        </button>
      </section>

      <section className="day-cycle" aria-label="Daylight cycle from midnight to midnight">
        <div className="day-cycle__labels" aria-hidden="true">
          <span className="day-cycle__midnight-start">Midnight</span>
          <span className="day-cycle__noon">12 noon</span>
          <span className="day-cycle__midnight-end">Midnight</span>
        </div>
        <div className="day-cycle__bar" aria-hidden="true">
          <span
            className="day-cycle__marker"
            style={{ left: `${(elapsedMs / LOOP_MS) * 100}%` }}
          />
        </div>
      </section>

      <footer className="source-note">
        <span className="source-note__truth">
          <span>Count-constrained simulation</span>
          <span>Modeled, not tracked</span>
        </span>
        <button
          className="methodology-trigger"
          type="button"
          onClick={openMethodology}
          disabled={!flowData}
        >
          About the data &amp; model <span aria-hidden="true">→</span>
        </button>
      </footer>

      <dialog
        className="methodology"
        ref={methodologyDialog}
        aria-labelledby="methodology-title"
        aria-describedby="methodology-intro"
        onClose={restorePlayback}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMethodology();
        }}
      >
        <div className="methodology__panel">
          <header className="methodology__header">
            <div>
              <p>Data &amp; methodology</p>
              <h2 id="methodology-title">What you are seeing</h2>
            </div>
            <button
              className="methodology__close"
              type="button"
              onClick={closeMethodology}
              autoFocus
            >
              Close
            </button>
          </header>

          <div className="methodology__scroll">
            <p className="methodology__intro" id="methodology-intro">
              This is a count-constrained synthetic simulation, not a recording of
              individual cyclists. Public observations determine when and where the city
              appears busiest; the moving journeys are generated on Copenhagen&apos;s official
              bicycle network.
            </p>

            {flowData ? (
              <dl className="methodology__stats">
                <div>
                  <dt>Recent count locations</dt>
                  <dd>{flowData.metadata.recentCountLocations.toLocaleString("en")}</dd>
                </div>
                <div>
                  <dt>Observed 07:00–19:00 crossings</dt>
                  <dd>{flowData.metadata.observedDaytimeCrossings.toLocaleString("en")}</dd>
                </div>
                <div>
                  <dt>Count-equivalent journeys</dt>
                  <dd>{flowData.metadata.modeledDailyJourneys.toLocaleString("en")}</dd>
                </div>
                <div>
                  <dt>Connected path templates</dt>
                  <dd>{flowData.metadata.journeyTemplateCount.toLocaleString("en")}</dd>
                </div>
              </dl>
            ) : null}

            <section className="methodology__section">
              <p className="methodology__kicker">01 · Observed</p>
              <h3>What comes directly from public data</h3>
              <p>
                The map uses 3,014 existing bicycle-infrastructure lines published by the
                City of Copenhagen. Relative route demand comes from the latest available
                2023–25 municipal bicycle traffic values at 321 locations.
              </p>
              <p>
                The daytime rhythm is anchored to 12,127 aggregate bicycle crossings counted
                at four Amager Strand locations from 07:00–19:00 on Sunday, 22 June 2025. The
                broader 2014 fixed-counter archive supplies the hours not observed in 2025.
              </p>
            </section>

            <section className="methodology__section">
              <p className="methodology__kicker">02 · Modeled</p>
              <h3>How the journeys are generated</h3>
              <ol className="methodology__steps">
                <li>Nearby recent traffic counts weight the official network.</li>
                <li>
                  Network endpoints within 32 metres are joined into 720 continuous path
                  templates.
                </li>
                <li>
                  Integer hourly departures preserve exactly 17,681 count-equivalent journeys,
                  including exactly 12,127 from 07:00–19:00.
                </li>
                <li>
                  Every synthetic journey receives a stable ID, start time, direction, path,
                  and a cycling speed between 13.7 and 18.7 km/h.
                </li>
              </ol>
            </section>

            <section className="methodology__section methodology__limits">
              <p className="methodology__kicker">03 · Limits</p>
              <h3>What the visualization cannot claim</h3>
              <p>
                Counter data does not identify unique bicycles, origins, destinations, or GPS
                trajectories. A person passing several counters may be counted several times.
                These are therefore count-equivalent modeled journeys—not reconstructed real
                trips or a citywide count of unique cyclists.
              </p>
              <p>
                The recent Sunday sample is concentrated around Amager Strand and coincided
                with Copenhagen Sprint, so the result should be read as a plausible busy summer
                Sunday rather than a statistically typical Sunday.
              </p>
            </section>

            <section className="methodology__section">
              <p className="methodology__kicker">Sources</p>
              <h3>Public datasets</h3>
              <ul className="methodology__sources">
                <li>
                  <a
                    href="https://www.opendata.dk/city-of-copenhagen/cykeldata"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Copenhagen Cykeldata
                  </a>
                  <span>Official bicycle-infrastructure geometry · CC BY 4.0</span>
                </li>
                <li>
                  <a
                    href="https://www.opendata.dk/city-of-copenhagen/trafiktal"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Copenhagen Trafiktal
                  </a>
                  <span>Recent spatial counts and June 2025 reports · CC0</span>
                </li>
                <li>
                  <a
                    href="https://www.opendata.dk/city-of-copenhagen/faste-cykeltaellinger"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Fixed bicycle counts
                  </a>
                  <span>Summer-Sunday hourly shape for unobserved hours · CC BY 4.0</span>
                </li>
                <li>
                  <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                    OpenFreeMap / OpenStreetMap
                  </a>
                  <span>Bundled shoreline and water context · ODbL</span>
                </li>
              </ul>
            </section>

            <a
              className="methodology__repo"
              href="https://github.com/toddsherman/copenhagen-bike-flow#what-the-visualization-represents"
              target="_blank"
              rel="noreferrer"
            >
              Read the reproducible method and source code on GitHub →
            </a>
          </div>
        </div>
      </dialog>
      <div className="map-attribution">
        <a href="https://openfreemap.org">OpenFreeMap</a>
        <span> · </span>
        <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
      </div>
    </main>
  );
}
