import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(currentDirectory, "../public/data/copenhagen-flow.json");
const data = JSON.parse(await fs.readFile(dataPath, "utf8"));

invariant(data.hourlyJourneyCounts?.length === 24, "Expected 24 hourly journey counts.");
invariant(
  data.hourlyJourneyCounts.every(Number.isInteger),
  "Hourly journey counts must be integers.",
);
const scheduledJourneys = data.hourlyJourneyCounts.reduce(
  (sum, count) => sum + count,
  0,
);
const scheduledDaytimeCrossings = data.hourlyJourneyCounts
  .slice(7, 19)
  .reduce((sum, count) => sum + count, 0);

invariant(
  scheduledJourneys === data.metadata.modeledDailyJourneys,
  `Scheduled ${scheduledJourneys} journeys but metadata declares ${data.metadata.modeledDailyJourneys}.`,
);
invariant(
  scheduledDaytimeCrossings === data.metadata.observedDaytimeCrossings,
  `Scheduled ${scheduledDaytimeCrossings} daytime journeys but expected ${data.metadata.observedDaytimeCrossings}.`,
);
invariant(
  data.journeys?.length === data.metadata.journeyTemplateCount,
  "Journey template count does not match metadata.",
);
invariant(
  data.journeys.every(
    ([lengthMeters, demandWeight, deltas]) =>
      lengthMeters >= 900 &&
      demandWeight > 0 &&
      deltas.length >= 4 &&
      deltas.length % 2 === 0,
  ),
  "Every journey template must contain a valid connected path and demand weight.",
);

console.log(
  `Verified ${scheduledJourneys.toLocaleString("en")} count-equivalent journeys across ${data.journeys.length.toLocaleString("en")} connected templates; the 07:00–19:00 total is exactly ${scheduledDaytimeCrossings.toLocaleString("en")}.`,
);
