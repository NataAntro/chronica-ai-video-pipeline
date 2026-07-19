import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LlmProvider } from "../src/providers/llm.js";
import {
  LocalScriptProvider,
  OpenAIResponsesProvider,
} from "../src/providers/llm.js";
import type { SynthesizedAudio, TtsProvider } from "../src/providers/tts.js";
import { HttpTtsProvider, LocalToneTtsProvider } from "../src/providers/tts.js";
import { runPipeline, validateRunId } from "../src/pipeline/runPipeline.js";
import { resolveArtifactPath } from "../src/services/manifest.js";
import {
  generateScenarioWithRecovery,
  generateScenarioWithTrace,
} from "../src/services/scenario.js";
import { synthesizeNarration } from "../src/services/narration.js";
import { evaluateScript } from "../src/evaluation/scriptEvaluation.js";
import { scenarioPromptVersion } from "../src/prompts/scenario.js";
import {
  buildHeuristicSubtitles,
  chunkSpeech,
} from "../src/services/speech.js";
import { parseVideoScript } from "../src/domain/validation.js";
import { createToneWav, inspectPcmWav } from "../src/utils/wav.js";

test("chunking соблюдает лимит и сохраняет порядок текста", () => {
  const text =
    "Первое предложение объясняет контекст. Второе предложение добавляет инженерную деталь. Третье завершает блок.";
  const chunks = chunkSpeech([{ id: "block", sectionId: "section", text }], 55);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 55));
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), text);
});

test("chunking ограничивает одиночный токен длиннее лимита", () => {
  const longToken = `https://example.test/${"segment".repeat(20)}`;
  const chunks = chunkSpeech(
    [{ id: "url", sectionId: "section", text: longToken }],
    40,
  );
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 40));
  assert.equal(chunks.map((chunk) => chunk.text).join(""), longToken);
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

test("runId ограничен безопасным именем каталога", () => {
  assert.equal(validateRunId("weekly-2026_07_20"), "weekly-2026_07_20");
  for (const runId of [
    "../../outside",
    "/tmp/outside",
    ".",
    "run id",
    "язык",
  ]) {
    assert.throws(() => validateRunId(runId), /runId должен содержать/);
  }
  assert.throws(
    () => validateRunId(`run-${"x".repeat(64)}`),
    /runId должен содержать/,
  );
});

test("pipeline отклоняет небезопасный runId до записи артефактов", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-run-id-"));
  await assert.rejects(
    runPipeline({
      llm: new LocalScriptProvider(),
      tts: new LocalToneTtsProvider(),
      projectRoot,
      mode: "local",
      render: false,
      runId: "../../outside",
    }),
    /runId должен содержать/,
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

test("scenario agent сохраняет трассу generate -> repair", async () => {
  const valid = await new LocalScriptProvider().generate("technology");
  const result = await generateScenarioWithTrace(
    {
      async generate() {
        return { title: "сломано" };
      },
      async repair() {
        return valid;
      },
    },
    "technology",
    2,
  );
  assert.deepEqual(
    result.trace.map(({ action, accepted }) => [action, accepted]),
    [
      ["generate", false],
      ["repair", true],
    ],
  );
});

test("scenario agent повторяет generate после сетевой ошибки без пустого repair", async () => {
  const valid = await new LocalScriptProvider().generate("technology");
  let generateCalls = 0;
  let repairCalls = 0;
  const result = await generateScenarioWithTrace(
    {
      async generate() {
        generateCalls += 1;
        if (generateCalls === 1) throw new Error("temporary network failure");
        return valid;
      },
      async repair() {
        repairCalls += 1;
        return valid;
      },
    },
    "technology",
    2,
  );
  assert.equal(generateCalls, 2);
  assert.equal(repairCalls, 0);
  assert.deepEqual(
    result.trace.map(({ action, accepted }) => [action, accepted]),
    [
      ["generate", false],
      ["generate", true],
    ],
  );
});

test("HTTP TTS выводит длительность из PCM WAV и ограничивает время запроса", async () => {
  const measured = new HttpTtsProvider(
    "https://tts.example.test",
    "secret",
    1_000,
    async () =>
      new Response(new Uint8Array(createToneWav(900)), {
        status: 200,
        headers: { "x-audio-duration-ms": "NaN" },
      }),
  );
  const audio = await measured.synthesize("text", 0);
  assert.ok(Math.abs(audio.durationMs - 900) <= 1);

  const invalidWav = new HttpTtsProvider(
    "https://tts.example.test",
    "secret",
    1_000,
    async () => new Response(Buffer.from("not-a-wav"), { status: 200 }),
  );
  await assert.rejects(invalidWav.synthesize("text", 0), /WAV/);

  const timedOut = new HttpTtsProvider(
    "https://tts.example.test",
    "secret",
    5,
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );
  await assert.rejects(timedOut.synthesize("text", 0), /timed out after 5 ms/);
});

test("WAV inspector отклоняет повреждённый заголовок и измеряет PCM", () => {
  const wav = createToneWav(750);
  assert.ok(Math.abs(inspectPcmWav(wav).durationMs - 750) <= 1);
  const corrupted = Buffer.from(wav);
  corrupted.write("MP3!", 8);
  assert.throws(() => inspectPcmWav(corrupted), /WAV/);
});

test("narration ограничивает конкурентные TTS-вызовы и сохраняет порядок", async () => {
  const workDirectory = await mkdtemp(join(tmpdir(), "chronica-tts-pool-"));
  let active = 0;
  let maximumActive = 0;
  const provider: TtsProvider = {
    async synthesize(): Promise<SynthesizedAudio> {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      return { wav: createToneWav(100), durationMs: 100 };
    },
  };
  const chunks = Array.from({ length: 5 }, (_, index) => ({
    id: `chunk-${index}`,
    sectionId: "section",
    text: `Текст ${index}`,
    chunkIndex: index,
  }));

  const result = await synthesizeNarration(chunks, provider, workDirectory, 2);

  assert.equal(maximumActive, 2);
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.id),
    chunks.map((chunk) => chunk.id),
  );
});

test("Responses provider отправляет versioned prompt и strict schema", async () => {
  const valid = await new LocalScriptProvider().generate("technology");
  let requestBody: Record<string, unknown> = {};
  let promptVersion = "";
  const provider = new OpenAIResponsesProvider(
    "https://api.example.test/v1/responses",
    "secret",
    "model-test",
    1_000,
    async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      promptVersion = new Headers(init?.headers).get("x-prompt-version") ?? "";
      return new Response(
        JSON.stringify({ output_text: JSON.stringify(valid) }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );

  const result = await provider.generate("technology");

  assert.deepEqual(result, valid);
  assert.equal(requestBody.model, "model-test");
  assert.equal(promptVersion, scenarioPromptVersion);
  assert.equal(
    (requestBody.text as { format: { strict: boolean } }).format.strict,
    true,
  );
});

test("local provider создаёт тематически различимые deterministic baselines", async () => {
  const provider = new LocalScriptProvider();
  const cases = [
    ["Локальные мультимодальные модели", "приватность"],
    ["Воспроизводимый медиаконвейер", "артефакты"],
    ["Качество RAG-поиска", "retrieval"],
    ["Приватность данных", "минимизация"],
    ["Дрейф модели", "регрессионный"],
  ] as const;
  for (const [topic, expected] of cases) {
    const script = parseVideoScript(await provider.generate(topic));
    assert.match(JSON.stringify(script), new RegExp(expected, "iu"));
  }
});

test("evaluation gate отклоняет повторяющиеся разделы", async () => {
  const valid = parseVideoScript(
    await new LocalScriptProvider().generate("technology"),
  );
  const repeated = {
    ...valid,
    sections: valid.sections.map((section) => ({
      ...section,
      title: "Один заголовок",
    })),
  };
  const evaluation = evaluateScript(repeated);
  assert.equal(evaluation.schemaValid, true);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.issues.some((issue) => issue.includes("повторяются")));
});

test("evaluation gate проверяет тему, concepts, IDs, claims и injection patterns", async () => {
  const valid = parseVideoScript(
    await new LocalScriptProvider().generate("Надёжные AI-агенты"),
  );
  const policy = {
    topicTerms: ["надёжные", "агенты"],
    requiredConcepts: [["схема"], ["восстанов"], ["evaluation"]],
    forbiddenPatterns: ["system prompt"],
  };
  assert.equal(evaluateScript(valid, policy).passed, true);

  const adversarial = {
    ...valid,
    sections: valid.sections.map((section, index) => ({
      ...section,
      id: "duplicate-id",
      narration:
        index === 0
          ? "Одинаковое предложение содержит 100% обещание и system prompt. Одинаковое предложение содержит 100% обещание и system prompt. Одинаковое предложение содержит 100% обещание и system prompt."
          : section.narration,
    })),
  };
  const evaluation = evaluateScript(adversarial, {
    topicTerms: ["отсутствующая-тема"],
    requiredConcepts: [["zzzz-unfindable-concept"]],
    forbiddenPatterns: ["system prompt"],
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.metrics.uniqueSectionIdRatio < 1, true);
  assert.equal(evaluation.metrics.topicCoverage, 0);
  assert.equal(evaluation.metrics.conceptCoverage, 0);
  assert.equal(evaluation.metrics.unsupportedNumericClaimCount > 0, true);
  assert.equal(evaluation.metrics.forbiddenPatternCount, 1);
  assert.equal(evaluation.metrics.repeatedSentenceRatio > 0, true);
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
    ["script", "scenario-trace", "audio", "narration-metadata", "subtitles"],
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

test("изменение темы с тем же runId инвалидирует сценарий и зависимости", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "chronica-fingerprint-"));
  const llm = new CountingLlmProvider();
  const tts = new CountingTtsProvider();
  const common = {
    llm,
    tts,
    projectRoot,
    mode: "local" as const,
    render: false,
    runId: "semantic-run",
    llmProfile: "model-v1",
    ttsProfile: "voice-v1",
  };
  const first = await runPipeline({ ...common, topic: "Надёжные AI-агенты" });
  const firstTtsCalls = tts.calls;

  await runPipeline({ ...common, topic: "Приватность данных во внешней LLM" });

  const manifest = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
    stages: Array<{
      stage: string;
      attempts: number;
      decisionReason: string;
      inputFingerprint: string;
    }>;
  };
  assert.equal(llm.generateCalls, 2);
  assert.ok(tts.calls > firstTtsCalls);
  assert.ok(manifest.stages.every((stage) => stage.attempts === 2));
  assert.equal(manifest.stages[0]?.decisionReason, "input_fingerprint_changed");
  assert.ok(
    manifest.stages.every((stage) => stage.inputFingerprint.length === 64),
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
