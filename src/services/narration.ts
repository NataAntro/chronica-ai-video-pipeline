import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioChunk, TtsChunk } from "../domain/types.js";
import type { TtsProvider } from "../providers/tts.js";
import { concatenateWav, inspectPcmWav } from "../utils/wav.js";

export const synthesizeNarration = async (
  chunks: TtsChunk[],
  provider: TtsProvider,
  workDirectory: string,
  maxConcurrency = 3,
): Promise<{ chunks: AudioChunk[]; narrationPath: string }> => {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }
  const chunkDirectory = join(workDirectory, "audio-chunks");
  await mkdir(chunkDirectory, { recursive: true });
  const rendered: Array<AudioChunk | undefined> = Array.from({
    length: chunks.length,
  });
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      const chunk = chunks[index];
      if (!chunk) continue;
      const audio = await provider.synthesize(chunk.text, index);
      const measured = inspectPcmWav(audio.wav);
      const filePath = join(
        chunkDirectory,
        `${String(index).padStart(2, "0")}-${chunk.id}.wav`,
      );
      await writeFile(filePath, audio.wav);
      rendered[index] = { ...chunk, filePath, durationMs: measured.durationMs };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, chunks.length) }, async () =>
      worker(),
    ),
  );
  const completed = rendered.map((chunk) => {
    if (!chunk) throw new Error("TTS worker did not produce every audio chunk");
    return chunk;
  });
  const wavs = await Promise.all(
    completed.map((chunk) => readFile(chunk.filePath)),
  );
  const narrationPath = join(workDirectory, "narration.wav");
  await writeFile(narrationPath, concatenateWav(wavs));
  return { chunks: completed, narrationPath };
};
