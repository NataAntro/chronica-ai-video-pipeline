import { z } from "zod";
import type { VideoScript } from "./types.js";

const sectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(4).max(80),
  narration: z.string().min(30).max(500),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const videoScriptSchema = z.object({
  title: z.string().min(8).max(100),
  edition: z.string().min(4).max(40),
  sections: z.array(sectionSchema).min(2).max(5),
  closing: z.string().min(10).max(180),
});

export const parseVideoScript = (candidate: unknown): VideoScript =>
  videoScriptSchema.parse(candidate);
