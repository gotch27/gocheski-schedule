import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./config/**/*.json"]
  }
};

export default nextConfig;
