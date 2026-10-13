import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "schedule-tests-"));
try {
  const entries = ["goals.test", "calendar-hydration.test", "labels.test", "mcp.test"];
  await build({
    entryPoints: entries.map((name) => `tests/${name}.ts`),
    outdir: dir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning"
  });
  const result = spawnSync(
    process.execPath,
    ["--test", ...entries.map((name) => join(dir, `${name}.cjs`))],
    { stdio: "inherit", env: process.env }
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
