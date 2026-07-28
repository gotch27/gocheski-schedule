import { loadEnvConfig } from "@next/env";
import { createConfig, envConfigProvider, jsonConfigProvider } from "@gotch/nextsignal";

// Drizzle Kit runs outside Next.js, so load the same root environment files.
loadEnvConfig(process.cwd());

export const config = createConfig({
  providers: [
    jsonConfigProvider("config/default.json"),
    envConfigProvider({ prefix: "NEXTSIGNAL_" })
  ]
});
