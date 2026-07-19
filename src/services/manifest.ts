import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ArtifactEntry, ArtifactManifest } from "../domain/types.js";

export const describeArtifact = async (
  kind: ArtifactEntry["kind"],
  path: string,
): Promise<ArtifactEntry> => {
  const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    kind,
    path,
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: metadata.size,
  };
};

export const writeManifest = async (
  path: string,
  manifest: ArtifactManifest,
): Promise<void> => {
  const stagingPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      stagingPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await rename(stagingPath, path);
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }
};

export const readManifest = async (
  path: string,
): Promise<ArtifactManifest | undefined> => {
  try {
    const candidate: unknown = JSON.parse(await readFile(path, "utf8"));
    return isArtifactManifest(candidate) ? candidate : undefined;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    return undefined;
  }
};

export const verifyArtifact = async (
  projectRoot: string,
  artifact: ArtifactEntry,
): Promise<boolean> => {
  try {
    const current = await describeArtifact(
      artifact.kind,
      resolveArtifactPath(projectRoot, artifact.path),
    );
    return (
      current.sha256 === artifact.sha256 && current.bytes === artifact.bytes
    );
  } catch {
    return false;
  }
};

export const resolveArtifactPath = (
  projectRoot: string,
  artifactPath: string,
): string => {
  const root = resolve(projectRoot);
  const candidate = resolve(root, artifactPath);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Artifact path escapes project root: ${artifactPath}`);
  }
  return candidate;
};

const isArtifactManifest = (
  candidate: unknown,
): candidate is ArtifactManifest => {
  if (typeof candidate !== "object" || candidate === null) return false;
  const manifest = candidate as Partial<ArtifactManifest>;
  if (
    manifest.schemaVersion !== 2 ||
    typeof manifest.runId !== "string" ||
    (manifest.mode !== "local" && manifest.mode !== "external") ||
    typeof manifest.updatedAt !== "string" ||
    !Array.isArray(manifest.stages) ||
    !Array.isArray(manifest.artifacts)
  ) {
    return false;
  }
  const allowedStages = new Set([
    "scenario",
    "narration",
    "subtitles",
    "render",
  ]);
  const allowedStatuses = new Set([
    "pending",
    "running",
    "completed",
    "failed",
  ]);
  const allowedKinds = new Set([
    "script",
    "scenario-trace",
    "audio",
    "narration-metadata",
    "subtitles",
    "video",
  ]);
  return (
    manifest.stages.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        allowedStages.has(entry.stage) &&
        allowedStatuses.has(entry.status) &&
        Number.isSafeInteger(entry.attempts) &&
        entry.attempts >= 0 &&
        (entry.lastDecision === undefined ||
          entry.lastDecision === "reused" ||
          entry.lastDecision === "executed") &&
        (entry.decisionReason === undefined ||
          typeof entry.decisionReason === "string") &&
        (entry.inputFingerprint === undefined ||
          /^[a-f0-9]{64}$/.test(entry.inputFingerprint)),
    ) &&
    manifest.artifacts.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        allowedKinds.has(entry.kind) &&
        typeof entry.path === "string" &&
        /^[a-f0-9]{64}$/.test(entry.sha256) &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0,
    )
  );
};
