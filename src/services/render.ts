import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderProps } from "../domain/types.js";

export const renderVideo = async (
  props: RenderProps,
  outputPath: string,
): Promise<void> => {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const serveUrl = await bundle({
    entryPoint: join(projectRoot, "src/remotion/index.ts"),
    publicDir: join(projectRoot, "public"),
  });
  const composition = await selectComposition({
    serveUrl,
    id: "TechDigest",
    inputProps: props,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: props,
  });
};
