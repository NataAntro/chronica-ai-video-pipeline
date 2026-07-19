import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioChunk, TtsChunk } from "../domain/types.js";
import type { TtsProvider } from "../providers/tts.js";
import { concatenateWav } from "../utils/wav.js";

export const synthesizeNarration = async (
  chunks: TtsChunk[],
  provider: TtsProvider,
  workDirectory: string,
): Promise<{ chunks: AudioChunk[]; narrationPath: string }> => {
  const chunkDirectory = join(workDirectory, "audio-chunks");
  await mkdir(chunkDirectory, { recursive: true });
  const rendered = await Promise.all(
    chunks.map(async (chunk, index) => {
      const audio = await provider.synthesize(chunk.text, index);
      const filePath = join(
        chunkDirectory,
        `${String(index).padStart(2, "0")}-${chunk.id}.wav`,
      );
      await writeFile(filePath, audio.wav);
      return { ...chunk, filePath, durationMs: audio.durationMs };
    }),
  );
  const wavs = await Promise.all(
    rendered.map((chunk) => readFile(chunk.filePath)),
  );
  const narrationPath = join(workDirectory, "narration.wav");
  await writeFile(narrationPath, concatenateWav(wavs));
  return { chunks: rendered, narrationPath };
};
