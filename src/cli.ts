import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProviders } from "./config.js";
import { runPipeline } from "./pipeline/runPipeline.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const providers = createProviders(process.env);
const result = await runPipeline({
  ...providers,
  projectRoot,
  render: !process.argv.includes("--skip-render"),
  ...(process.env.RUN_ID ? { runId: process.env.RUN_ID } : {}),
});
process.stdout.write(`Manifest: ${result.manifestPath}\n`);
if (result.videoPath) process.stdout.write(`Видео: ${result.videoPath}\n`);
