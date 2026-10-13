import { createConfig, envConfigProvider, jsonConfigProvider } from "@gotch/nextsignal";
import { z } from "zod";
import { timeZone } from "@/nextsignal/mcp/schemas";

// NextSignal's environment provider returns strings; normalize configured allowlists here.
const stringList = z.preprocess(
  (input) => {
    if (typeof input !== "string") return input;
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  },
  z.array(z.string().min(1))
);

export const appConfigSchema = z
  .object({
    mcp: z
      .object({
        access_token: z.string(),
        time_zone: timeZone,
        allowed_hosts: stringList,
        allowed_origins: stringList
      })
      .passthrough()
  })
  .passthrough();

export const config = createConfig({
  schema: appConfigSchema,
  providers: [
    jsonConfigProvider("config/default.json"),
    envConfigProvider({ prefix: "NEXTSIGNAL_" })
  ]
});
