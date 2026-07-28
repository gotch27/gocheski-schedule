import { createConfig, envConfigProvider, objectConfigProvider } from "@gotch/nextsignal";

export const config = createConfig({
  providers: [
    objectConfigProvider({ database: { url: "" } }, "defaults"),
    envConfigProvider({ prefix: "NEXTSIGNAL_" })
  ]
});
