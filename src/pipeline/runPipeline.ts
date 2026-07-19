import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  ArtifactEntry,
  ArtifactManifest,
  AudioChunk,
  PipelineStage,
  RenderProps,
  StageEntry,
  SubtitleCue,
  VideoScript,
} from "../domain/types.js";
import { parseVideoScript } from "../domain/validation.js";
import type { LlmProvider } from "../providers/llm.js";
import type { TtsProvider } from "../providers/tts.js";
import {
  describeArtifact,
  readManifest,
  resolveArtifactPath,
  verifyArtifact,
  writeManifest,
} from "../services/manifest.js";
import { synthesizeNarration } from "../services/narration.js";
import { renderVideo } from "../services/render.js";
import { generateScenarioWithRecovery } from "../services/scenario.js";
import {
  buildHeuristicSubtitles,
  buildSpeechBlocks,
  chunkSpeech,
} from "../services/speech.js";

export type PipelineDependencies = {
  llm: LlmProvider;
  tts: TtsProvider;
  projectRoot: string;
  mode: "local" | "external";
  render: boolean;
  runId?: string;
  afterStage?: (stage: PipelineStage) => Promise<void> | void;
};

export type PipelineResult = {
  runDirectory: string;
  manifestPath: string;
  videoPath?: string;
};

const newStage = (stage: PipelineStage): StageEntry => ({
  stage,
  status: "pending",
  attempts: 0,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const stageDescendants: Record<PipelineStage, PipelineStage[]> = {
  scenario: ["narration", "subtitles", "render"],
  narration: ["subtitles", "render"],
  subtitles: ["render"],
  render: [],
};

export const runPipeline = async (
  dependencies: PipelineDependencies,
): Promise<PipelineResult> => {
  const runId = dependencies.runId ?? randomUUID();
  const runDirectory = join(dependencies.projectRoot, "artifacts", runId);
  const manifestPath = join(runDirectory, "artifact-manifest.json");
  await mkdir(runDirectory, { recursive: true });

  const requiredStages: PipelineStage[] = [
    "scenario",
    "narration",
    "subtitles",
    ...(dependencies.render ? (["render"] as const) : []),
  ];
  const existing = await readManifest(manifestPath);
  const manifest: ArtifactManifest =
    existing?.runId === runId && existing.mode === dependencies.mode
      ? existing
      : {
          schemaVersion: 2,
          runId,
          mode: dependencies.mode,
          updatedAt: new Date().toISOString(),
          stages: requiredStages.map(newStage),
          artifacts: [],
        };
  for (const stage of requiredStages) {
    if (!manifest.stages.some((entry) => entry.stage === stage)) {
      manifest.stages.push(newStage(stage));
    }
  }

  const persistManifest = async (): Promise<void> => {
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifestPath, manifest);
  };
  await persistManifest();

  const stageEntry = (stage: PipelineStage): StageEntry => {
    const entry = manifest.stages.find(
      (candidate) => candidate.stage === stage,
    );
    if (!entry) throw new Error(`Unknown pipeline stage: ${stage}`);
    return entry;
  };
  const artifact = (kind: ArtifactEntry["kind"]): ArtifactEntry | undefined =>
    manifest.artifacts.find((entry) => entry.kind === kind);
  const artifactPath = (kind: ArtifactEntry["kind"]): string => {
    const entry = artifact(kind);
    if (!entry) throw new Error(`Missing artifact: ${kind}`);
    return resolveArtifactPath(dependencies.projectRoot, entry.path);
  };
  const removeArtifacts = (kinds: ArtifactEntry["kind"][]): void => {
    manifest.artifacts = manifest.artifacts.filter(
      (entry) => !kinds.includes(entry.kind),
    );
  };
  const recordArtifact = async (
    kind: ArtifactEntry["kind"],
    path: string,
  ): Promise<void> => {
    const described = await describeArtifact(kind, path);
    removeArtifacts([kind]);
    manifest.artifacts.push({
      ...described,
      path: relative(dependencies.projectRoot, described.path),
    });
  };
  const invalidatedStages = new Set<PipelineStage>();
  const canReuse = async (
    stage: PipelineStage,
    kinds: ArtifactEntry["kind"][],
  ): Promise<boolean> => {
    const entry = stageEntry(stage);
    let reason: string | undefined;
    if (invalidatedStages.has(stage)) {
      reason = "upstream_invalidated";
    } else if (entry.status !== "completed") {
      reason = `stage_status:${entry.status}`;
    }
    const entries = kinds.map(artifact);
    if (!reason && entries.some((candidate) => candidate === undefined)) {
      reason = "artifact_missing";
    }
    if (!reason) {
      const verified = await Promise.all(
        entries.map((candidate) =>
          verifyArtifact(dependencies.projectRoot, candidate as ArtifactEntry),
        ),
      );
      if (!verified.every(Boolean)) reason = "artifact_integrity_mismatch";
    }

    if (!reason) {
      entry.lastDecision = "reused";
      entry.decisionReason = "artifacts_verified";
      await persistManifest();
      return true;
    }

    entry.lastDecision = "executed";
    entry.decisionReason = reason;
    for (const descendant of stageDescendants[stage]) {
      invalidatedStages.add(descendant);
    }
    await persistManifest();
    return false;
  };
  const executeStage = async <Result>(
    stage: PipelineStage,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const entry = stageEntry(stage);
    entry.status = "running";
    entry.attempts += 1;
    entry.startedAt = new Date().toISOString();
    delete entry.completedAt;
    delete entry.error;
    await persistManifest();
    try {
      const result = await operation();
      entry.status = "completed";
      entry.completedAt = new Date().toISOString();
      await persistManifest();
      await dependencies.afterStage?.(stage);
      return result;
    } catch (error) {
      if (entry.status !== "completed") {
        entry.status = "failed";
        entry.error = errorMessage(error);
        await persistManifest();
      }
      throw error;
    }
  };

  let script: VideoScript;
  if (await canReuse("scenario", ["script"])) {
    script = parseVideoScript(
      JSON.parse(await readFile(artifactPath("script"), "utf8")),
    );
  } else {
    removeArtifacts(["script"]);
    script = await executeStage("scenario", async () => {
      const generated = await generateScenarioWithRecovery(
        dependencies.llm,
        "Еженедельный технологический дайджест",
      );
      const path = join(runDirectory, "script.json");
      await writeFile(path, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
      await recordArtifact("script", path);
      return generated;
    });
  }

  let narration: { chunks: AudioChunk[]; narrationPath: string };
  if (await canReuse("narration", ["audio", "narration-metadata"])) {
    const storedChunks = JSON.parse(
      await readFile(artifactPath("narration-metadata"), "utf8"),
    ) as AudioChunk[];
    narration = {
      chunks: storedChunks.map((chunk) => ({
        ...chunk,
        filePath: resolve(dependencies.projectRoot, chunk.filePath),
      })),
      narrationPath: artifactPath("audio"),
    };
  } else {
    removeArtifacts(["audio", "narration-metadata"]);
    narration = await executeStage("narration", async () => {
      const ttsChunks = chunkSpeech(buildSpeechBlocks(script), 120);
      const generated = await synthesizeNarration(
        ttsChunks,
        dependencies.tts,
        runDirectory,
      );
      const metadataPath = join(runDirectory, "narration-metadata.json");
      const portableChunks = generated.chunks.map((chunk) => ({
        ...chunk,
        filePath: relative(dependencies.projectRoot, chunk.filePath),
      }));
      await writeFile(
        metadataPath,
        `${JSON.stringify(portableChunks, null, 2)}\n`,
        "utf8",
      );
      await recordArtifact("audio", generated.narrationPath);
      await recordArtifact("narration-metadata", metadataPath);
      return generated;
    });
  }

  let subtitles: SubtitleCue[];
  if (await canReuse("subtitles", ["subtitles"])) {
    subtitles = JSON.parse(
      await readFile(artifactPath("subtitles"), "utf8"),
    ) as SubtitleCue[];
  } else {
    removeArtifacts(["subtitles"]);
    subtitles = await executeStage("subtitles", async () => {
      const generated = buildHeuristicSubtitles(narration.chunks);
      const path = join(runDirectory, "subtitles.json");
      await writeFile(path, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
      await recordArtifact("subtitles", path);
      return generated;
    });
  }

  const generatedDirectory = join(
    dependencies.projectRoot,
    "public",
    "generated",
  );
  await mkdir(generatedDirectory, { recursive: true });
  await copyFile(
    narration.narrationPath,
    join(generatedDirectory, `${runId}.wav`),
  );

  const totalDurationMs = subtitles.at(-1)?.endMs ?? 1_000;
  const props: RenderProps = {
    title: script.title,
    edition: script.edition,
    sections: script.sections.map(({ title, accent }) => ({ title, accent })),
    subtitles,
    audioPath: `generated/${runId}.wav`,
    durationInFrames: Math.ceil((totalDurationMs / 1000) * 24) + 6,
  };
  await writeFile(
    join(runDirectory, "render-props.json"),
    `${JSON.stringify(props, null, 2)}\n`,
    "utf8",
  );

  let videoPath: string | undefined;
  if (dependencies.render) {
    if (await canReuse("render", ["video"])) {
      videoPath = artifactPath("video");
    } else {
      removeArtifacts(["video"]);
      videoPath = join(runDirectory, "video.mp4");
      await executeStage("render", async () => {
        await renderVideo(props, videoPath as string);
        await recordArtifact("video", videoPath as string);
      });
    }
  }

  return {
    runDirectory,
    manifestPath,
    ...(videoPath ? { videoPath } : {}),
  };
};
