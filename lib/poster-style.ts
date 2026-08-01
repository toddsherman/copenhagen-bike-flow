import type { StyleSpecification } from "maplibre-gl";

const OPEN_FREE_MAP = "https://tiles.openfreemap.org/planet";

/**
 * A deliberately small OpenMapTiles style. The palette borrows the warm ink,
 * turquoise water, cream paper, and deep navy outlines of mid-century travel
 * posters while keeping Copenhagen's geography legible beneath the flow.
 */
export const POSTER_STYLE = {
  version: 8,
  name: "Copenhagen travel poster",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: {
      type: "vector",
      url: OPEN_FREE_MAP,
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "paper",
      type: "background",
      paint: { "background-color": "#f4e3bd" },
    },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": "#9dbb87", "fill-opacity": 0.44 },
    },
    {
      id: "parks",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": "#78a77e", "fill-opacity": 0.62 },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "residential",
          "#f1cf91",
          "commercial",
          "#eab66e",
          "industrial",
          "#dca56e",
          "#efdbaf",
        ],
        "fill-opacity": 0.34,
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#48bfd0" },
    },
    {
      id: "waterways",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": "#2a9eb5", "line-width": 1.2 },
    },
    {
      id: "buildings",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 12,
      paint: {
        "fill-color": "#d96b32",
        "fill-opacity": 0.5,
        "fill-outline-color": "#5c3b32",
      },
    },
    {
      id: "roads-shadow",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary"],
        true,
        false,
      ],
      paint: {
        "line-color": "#183a46",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 15, 7],
        "line-opacity": 0.58,
      },
    },
    {
      id: "roads",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary"],
          "#f5c447",
          ["secondary", "tertiary"],
          "#f8df9f",
          "#f5e9c9",
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.35, 15, 4],
        "line-opacity": 0.93,
      },
    },
    {
      id: "city-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 9,
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 14, 16],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
      },
      paint: {
        "text-color": "#123646",
        "text-halo-color": "#f4e3bd",
        "text-halo-width": 1.6,
        "text-opacity": 0.72,
      },
    },
  ],
} as StyleSpecification;
