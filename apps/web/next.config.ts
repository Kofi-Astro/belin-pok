import type { NextConfig } from "next";

// The API that serves the catalog and product photos. Read at build time:
// the photo host has to be allow-listed for next/image below, and the
// browser-side code has the URL compiled in (NEXT_PUBLIC_ prefix).
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const api = new URL(apiBaseUrl);

const nextConfig: NextConfig = {
  // A self-contained server bundle (.next/standalone) -- what the
  // Dockerfile copies into the runtime image, without node_modules.
  output: "standalone",
  images: {
    // Next refuses to optimize images from local/private IP addresses (a
    // guard against the optimizer being used to probe internal networks).
    // Only for previewing against an API on this machine -- never set
    // NEXT_IMAGE_ALLOW_LOCAL_IP in a deployed build.
    dangerouslyAllowLocalIP: process.env.NEXT_IMAGE_ALLOW_LOCAL_IP === "1",
    // Product photos come from the API's /images/ endpoint. next/image
    // resizes them per device, which matters on mobile data.
    remotePatterns: [
      {
        protocol: api.protocol.replace(":", "") as "http" | "https",
        hostname: api.hostname,
        port: api.port,
        pathname: "/images/**",
      },
    ],
  },
};

export default nextConfig;
