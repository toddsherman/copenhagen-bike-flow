import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The standalone Vercel project is proxied through todd.sh/Copenhagen.
  // Keeping the same prefix here also makes its JS, CSS, and data URLs work
  // when the project is accessed directly on its vercel.app domain.
  basePath: "/Copenhagen",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
