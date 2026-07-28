import { createSchemaValidationAdapter, type NextSignalAdapters } from "@gotch/nextsignal";

export const adapters: NextSignalAdapters = {
  validation: createSchemaValidationAdapter()
};
