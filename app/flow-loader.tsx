"use client";

import dynamic from "next/dynamic";

const CopenhagenFlow = dynamic(
  () => import("@/components/copenhagen-flow"),
  {
    ssr: false,
    loading: () => (
      <main className="loading-poster" aria-label="Loading bicycle traffic">
        <div className="loading-poster__sun" />
        <div className="loading-poster__copy">
          <p>One summer Sunday</p>
          <h1>Copenhagen</h1>
          <span>Loading the bicycle city…</span>
        </div>
      </main>
    ),
  },
);

export default function FlowLoader() {
  return <CopenhagenFlow />;
}
