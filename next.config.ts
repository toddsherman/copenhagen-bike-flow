import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // The source lives separately, while its export is hosted by todd.sh.
  // Keeping this prefix makes the generated JS, CSS, and data URLs
  // work when the generated files are copied into todd.sh/public/Copenhagen.
  basePath: "/Copenhagen",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
