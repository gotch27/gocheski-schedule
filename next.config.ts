import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/schedule",
  outputFileTracingIncludes: {
    "/*": ["./config/**/*.json"]
  }
};

export default nextConfig;
