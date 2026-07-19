import { z } from "zod";
import type { AudioChunk, SubtitleCue, VideoScript } from "./types.js";

const sectionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(4).max(80),
    narration: z.string().min(30).max(500),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const videoScriptSchema = z
  .object({
    title: z.string().min(8).max(100),
    edition: z.string().min(4).max(40),
    sections: z.array(sectionSchema).min(2).max(5),
    closing: z.string().min(10).max(180),
  })
  .strict();

export const videoScriptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "edition", "sections", "closing"],
  properties: {
    title: { type: "string", minLength: 8, maxLength: 100 },
    edition: { type: "string", minLength: 4, maxLength: 40 },
    sections: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "narration", "accent"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$" },
          title: { type: "string", minLength: 4, maxLength: 80 },
          narration: { type: "string", minLength: 30, maxLength: 500 },
          accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        },
      },
    },
    closing: { type: "string", minLength: 10, maxLength: 180 },
  },
} as const;

export const parseVideoScript = (candidate: unknown): VideoScript =>
  videoScriptSchema.parse(candidate);

const audioChunkSchema = z
  .object({
    id: z.string().min(1),
    sectionId: z.string().min(1),
    text: z.string().min(1),
    chunkIndex: z.number().int().nonnegative(),
    filePath: z.string().min(1),
    durationMs: z.number().int().positive(),
  })
  .strict();

const subtitleCueSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((cue) => cue.endMs > cue.startMs, {
    message: "subtitle endMs must be greater than startMs",
  });

export const parseAudioChunks = (candidate: unknown): AudioChunk[] =>
  z.array(audioChunkSchema).min(1).parse(candidate);

export const parseSubtitleCues = (candidate: unknown): SubtitleCue[] =>
  z.array(subtitleCueSchema).min(1).parse(candidate);
