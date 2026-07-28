import { createConfig, envConfigProvider, jsonConfigProvider } from "@gotch/nextsignal";

export const config = createConfig({
  providers: [
    jsonConfigProvider("config/default.json"),
    envConfigProvider({ prefix: "NEXTSIGNAL_" })
  ]
});
