import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const dir = `.next/goals-integration-${process.pid}`;
await mkdir(dir, { recursive: true });
try {
  const outfile = `${dir}/integration.mjs`;
  await build({
    entryPoints: ["tests/goals.integration.ts"],
    outfile,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "warning"
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit", env: process.env });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
