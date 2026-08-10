import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/schedule",
  allowedDevOrigins: ["192.168.1.160"],
  outputFileTracingIncludes: {
    "/*": ["./config/**/*.json"]
  }
};

export default nextConfig;
