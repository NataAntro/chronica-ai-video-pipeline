import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LlmProvider } from "../src/providers/llm.js";
import { LocalScriptProvider } from "../src/providers/llm.js";
import type { SynthesizedAudio, TtsProvider } from "../src/providers/tts.js";
import { LocalToneTtsProvider } from "../src/providers/tts.js";
import { runPipeline } from "../src/pipeline/runPipeline.js";
import { resolveArtifactPath } from "../src/services/manifest.js";
import { generateScenarioWithRecovery } from "../src/services/scenario.js";
import {
  buildHeuristicSubtitles,
  chunkSpeech,
} from "../src/services/speech.js";
import { parseVideoScript } from "../src/domain/validation.js";

test("chunking соблюдает лимит и сохраняет порядок текста", () => {
  const text =
    "Первое предложение объясняет контекст. Второе предложение добавляет инженерную деталь. Третье завершает блок.";
  const chunks = chunkSpeech([{ id: "block", sectionId: "section", text }], 55);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 55));
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), text);
});

test("heuristic timing создаёт непрерывные непересекающиеся cues", () => {
  const cues = buildHeuristicSubtitles([
    {
      id: "a",
      sectionId: "one",
      text: "Первый фрагмент",
      chunkIndex: 0,
      durationMs: 800,
    },
    {
      id: "b",
      sectionId: "two",
      text: "Второй фрагмент",
      chunkIndex: 0,
      durationMs: 1200,
    },
  ]);
  assert.deepEqual(
    cues.map(({ startMs, endMs }) => [startMs, endMs]),
    [
      [0, 800],
      [800, 2000],
    ],
  );
});

test("структурная валидация отклоняет неполный сценарий", () => {
  assert.throws(() => parseVideoScript({ title: "Слишком мало полей" }));
});

test("artifact path не может выйти за каталог проекта", () => {
  assert.throws(
    () => resolveArtifactPath("/safe/project", "../private/secret.json"),
    /escapes project root/,
  );
});

test("recovery передаёт ошибки provider и принимает repaired результат", async () => {
  const valid = await new LocalScriptProvider().generate("technology");
  let repairs = 0;
  const provider: LlmProvider = {
    async generate() {
      return { title: "сломано" };
    },
    async repair(_candidate, errors) {
      repairs += 1;
      assert.ok(errors.some((error) => error.includes("sections")));
      return valid;
    },
  };
  const result = await generateScenarioWithRecovery(provider, "technology", 2);
  assert.equal(repairs, 1);
  assert.equal(result.sections.length, 3);
});

test("local pipeline без renderer создаёт проверяемый manifest", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-media-pipeline-"));
  const result = await runPipeline({
    llm: new LocalScriptProvider(),
    tts: new LocalToneTtsProvider(),
    projectRoot,
    mode: "local",
    render: false,
    runId: "test-run",
  });
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
    artifacts: Array<{ kind: string; sha256: string }>;
    stages: Array<{ stage: string; status: string; attempts: number }>;
  };
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.kind),
    ["script", "audio", "narration-metadata", "subtitles"],
  );
  assert.ok(manifest.stages.every(({ attempts }) => attempts === 1));
  assert.ok(
    manifest.artifacts.every((artifact) => artifact.sha256.length === 64),
  );
  assert.deepEqual(
    manifest.stages.map(({ stage, status }) => [stage, status]),
    [
      ["scenario", "completed"],
      ["narration", "completed"],
      ["subtitles", "completed"],
    ],
  );
});

test("pipeline продолжается с checkpoint без повторных LLM и TTS вызовов", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-recovery-"));
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  await assert.rejects(
    runPipeline({
      llm,
      tts,
      projectRoot,
      mode: "local",
      render: false,
      runId: "recoverable-run",
      afterStage(stage) {
        if (stage === "narration") throw new Error("simulated process crash");
      },
    }),
    /simulated process crash/,
  );
  const callsAfterCrash = tts.calls;
  assert.equal(llm.generateCalls, 1);
  assert.ok(callsAfterCrash > 0);

  const recovered = await runPipeline({
    llm,
    tts,
    projectRoot,
    mode: "local",
    render: false,
    runId: "recoverable-run",
  });
  const manifest = JSON.parse(
    await readFile(recovered.manifestPath, "utf8"),
  ) as {
    stages: Array<{ stage: string; status: string; lastDecision: string }>;
  };
  assert.equal(llm.generateCalls, 1);
  assert.equal(tts.calls, callsAfterCrash);
  assert.ok(manifest.stages.every(({ status }) => status === "completed"));
  assert.deepEqual(
    manifest.stages.map(({ stage, lastDecision }) => [stage, lastDecision]),
    [
      ["scenario", "reused"],
      ["narration", "reused"],
      ["subtitles", "executed"],
    ],
  );
});

test("checkpoint сценария исключает повторный LLM-вызов после остановки", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "chronica-scenario-checkpoint-"),
  );
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  await assert.rejects(
    runPipeline({
      llm,
      tts,
      projectRoot,
      mode: "local",
      render: false,
      runId: "scenario-checkpoint",
      afterStage(stage) {
        if (stage === "scenario") throw new Error("stop after scenario");
      },
    }),
    /stop after scenario/,
  );
  assert.equal(llm.generateCalls, 1);
  assert.equal(tts.calls, 0);

  const recovered = await runPipeline({
    llm,
    tts,
    projectRoot,
    mode: "local",
    render: false,
    runId: "scenario-checkpoint",
  });
  const manifest = JSON.parse(
    await readFile(recovered.manifestPath, "utf8"),
  ) as {
    stages: Array<{ stage: string; attempts: number; lastDecision: string }>;
  };
  assert.equal(llm.generateCalls, 1);
  assert.ok(tts.calls > 0);
  assert.deepEqual(
    manifest.stages.map(({ stage, attempts, lastDecision }) => [
      stage,
      attempts,
      lastDecision,
    ]),
    [
      ["scenario", 1, "reused"],
      ["narration", 1, "executed"],
      ["subtitles", 1, "executed"],
    ],
  );
});

test("повреждённый artifact пересоздаётся вместе с зависимыми этапами", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-integrity-"));
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  const options = {
    llm,
    tts,
    projectRoot,
    mode: "local" as const,
    render: false,
    runId: "integrity-run",
  };
  const first = await runPipeline(options);
  const initialTtsCalls = tts.calls;
  await writeFile(join(first.runDirectory, "script.json"), "{}\n", "utf8");

  await runPipeline(options);

  assert.equal(llm.generateCalls, 2);
  assert.ok(tts.calls > initialTtsCalls);
  const manifest = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    stages: Array<{ stage: string; attempts: number; decisionReason: string }>;
  };
  assert.ok(manifest.stages.every(({ attempts }) => attempts === 2));
  assert.deepEqual(
    manifest.stages.map(({ decisionReason }) => decisionReason),
    [
      "artifact_integrity_mismatch",
      "upstream_invalidated",
      "upstream_invalidated",
    ],
  );
});

test("повреждение аудио сохраняет сценарий и инвалидирует только зависимые этапы", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-dependencies-"));
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  const options = {
    llm,
    tts,
    projectRoot,
    mode: "local" as const,
    render: false,
    runId: "dependency-run",
  };
  const first = await runPipeline(options);
  const before = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    artifacts: Array<{ kind: string; path: string }>;
  };
  const audio = before.artifacts.find(({ kind }) => kind === "audio");
  assert.ok(audio);
  await writeFile(join(projectRoot, audio.path), "corrupted audio", "utf8");

  await runPipeline(options);

  const after = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    stages: Array<{
      stage: string;
      attempts: number;
      lastDecision: string;
      decisionReason: string;
    }>;
  };
  assert.equal(llm.generateCalls, 1);
  assert.deepEqual(
    after.stages.map(({ stage, attempts, lastDecision, decisionReason }) => [
      stage,
      attempts,
      lastDecision,
      decisionReason,
    ]),
    [
      ["scenario", 1, "reused", "artifacts_verified"],
      ["narration", 2, "executed", "artifact_integrity_mismatch"],
      ["subtitles", 2, "executed", "upstream_invalidated"],
    ],
  );
});

test("повреждение субтитров не повторяет сценарий и озвучку", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "chronica-subtitle-dependency-"),
  );
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  const options = {
    llm,
    tts,
    projectRoot,
    mode: "local" as const,
    render: false,
    runId: "subtitle-dependency-run",
  };
  const first = await runPipeline(options);
  const before = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    artifacts: Array<{ kind: string; path: string }>;
  };
  const subtitles = before.artifacts.find(({ kind }) => kind === "subtitles");
  assert.ok(subtitles);
  const initialTtsCalls = tts.calls;
  await writeFile(join(projectRoot, subtitles.path), "[]", "utf8");

  await runPipeline(options);

  const after = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    stages: Array<{
      stage: string;
      attempts: number;
      lastDecision: string;
      decisionReason: string;
    }>;
  };
  assert.equal(llm.generateCalls, 1);
  assert.equal(tts.calls, initialTtsCalls);
  assert.deepEqual(
    after.stages.map(({ stage, attempts, lastDecision, decisionReason }) => [
      stage,
      attempts,
      lastDecision,
      decisionReason,
    ]),
    [
      ["scenario", 1, "reused", "artifacts_verified"],
      ["narration", 1, "reused", "artifacts_verified"],
      ["subtitles", 2, "executed", "artifact_integrity_mismatch"],
    ],
  );
});

class CountingLlmProvider implements LlmProvider {
  generateCalls = 0;
  private readonly delegate = new LocalScriptProvider();

  async generate(topic: string): Promise<unknown> {
    this.generateCalls += 1;
    return this.delegate.generate(topic);
  }

  async repair(candidate: unknown, errors: string[]): Promise<unknown> {
    return this.delegate.repair(candidate, errors);
  }
}

class CountingTtsProvider implements TtsProvider {
  calls = 0;
  private readonly delegate = new LocalToneTtsProvider();

  async synthesize(text: string, index: number): Promise<SynthesizedAudio> {
    this.calls += 1;
    return this.delegate.synthesize(text, index);
  }
}
