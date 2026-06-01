import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // CHANGELOG.md ist die Quelle für das In-App-Änderungsprotokoll (/changelog).
  // Beim standalone-Build wird die Datei sonst nicht mitkopiert und zur Laufzeit
  // nicht gefunden – daher explizit ins File-Tracing aufnehmen.
  outputFileTracingIncludes: {
    "/changelog": ["./CHANGELOG.md"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
