export type StorySection = {
  id: string;
  title: string;
  narration: string;
  accent: string;
};

export type VideoScript = {
  title: string;
  edition: string;
  sections: StorySection[];
  closing: string;
};

export type SpeechBlock = { id: string; sectionId: string; text: string };
export type TtsChunk = SpeechBlock & { chunkIndex: number };
export type AudioChunk = TtsChunk & { filePath: string; durationMs: number };
export type SubtitleCue = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type RenderProps = {
  title: string;
  edition: string;
  sections: Array<Pick<StorySection, "title" | "accent">>;
  subtitles: SubtitleCue[];
  audioPath: string;
  durationInFrames: number;
};

export type ArtifactEntry = {
  kind:
    | "script"
    | "scenario-trace"
    | "audio"
    | "narration-metadata"
    | "subtitles"
    | "video";
  path: string;
  sha256: string;
  bytes: number;
};

export type PipelineStage = "scenario" | "narration" | "subtitles" | "render";

export type StageEntry = {
  stage: PipelineStage;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  lastDecision?: "reused" | "executed";
  decisionReason?: string;
  inputFingerprint?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type ArtifactManifest = {
  schemaVersion: 2;
  runId: string;
  mode: "local" | "external";
  updatedAt: string;
  stages: StageEntry[];
  artifacts: ArtifactEntry[];
};
