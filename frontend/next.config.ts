import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["10.13.0.4", "intent.jatnikonm.tech"],
  skipTrailingSlashRedirect: true,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/separate",
        destination: "http://localhost:8011/api/separate/",
      },
      {
        source: "/api/:path*",
        destination: "http://localhost:8011/api/:path*",
      },
      {
        source: "/outputs/:path*",
        destination: "http://localhost:8011/outputs/:path*",
      },
    ];
  },
};

export default nextConfig;
