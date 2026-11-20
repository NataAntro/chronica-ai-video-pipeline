import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalScriptProvider,
  OpenAIResponsesProvider,
} from "../providers/llm.js";
import { generateScenarioWithTrace } from "../services/scenario.js";
import {
  evaluateScript,
  type ScriptEvaluationPolicy,
} from "./scriptEvaluation.js";

type EvaluationCase = ScriptEvaluationPolicy & {
  id: string;
  topic: string;
};

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures: unknown = JSON.parse(
  await readFile(join(projectRoot, "fixtures/evaluation-topics.json"), "utf8"),
);
if (!Array.isArray(fixtures))
  throw new Error("Evaluation fixtures must be an array");
const evaluationCases = fixtures as EvaluationCase[];
const external = process.env.EVAL_PROVIDER === "external";
const provider = external
  ? new OpenAIResponsesProvider(
      required("LLM_ENDPOINT"),
      required("LLM_API_KEY"),
      required("LLM_MODEL"),
    )
  : new LocalScriptProvider();
const providerName = external
  ? process.env.LLM_MODEL
  : "local-deterministic-v2";
const runsPerCase = parseRuns(process.env.EVAL_RUNS ?? "3");
const cases = [];

for (const fixture of evaluationCases) {
  const runs = [];
  for (let run = 1; run <= runsPerCase; run += 1) {
    const startedAt = performance.now();
    try {
      const generated = await generateScenarioWithTrace(
        provider,
        fixture.topic,
      );
      runs.push({
        run,
        durationMs: Math.round(performance.now() - startedAt),
        evaluation: evaluateScript(generated.script, fixture),
        trace: generated.trace,
      });
    } catch (error) {
      runs.push({
        run,
        durationMs: Math.round(performance.now() - startedAt),
        evaluation: {
          passed: false,
          issues: [error instanceof Error ? error.message : String(error)],
        },
        trace: [],
      });
    }
  }
  const passedRuns = runs.filter((item) => item.evaluation.passed).length;
  const firstPassRuns = runs.filter(
    (item) => item.trace.length === 1 && item.trace[0]?.accepted,
  ).length;
  const stabilityRate = passedRuns / runs.length;
  cases.push({
    id: fixture.id,
    topic: fixture.topic,
    runs,
    aggregate: {
      passed: stabilityRate >= 2 / 3,
      stabilityRate,
      firstPassRate: firstPassRuns / runs.length,
      p95LatencyMs: percentile(
        runs.map((item) => item.durationMs),
        0.95,
      ),
    },
  });
}

const passedCases = cases.filter((item) => item.aggregate.passed).length;
const report = {
  evaluationVersion: "chronica-script-eval-v2",
  provider: providerName,
  runsPerCase,
  cases,
  summary: {
    totalCases: cases.length,
    passedCases,
    casePassRate: passedCases / cases.length,
    meanStabilityRate:
      cases.reduce((sum, item) => sum + item.aggregate.stabilityRate, 0) /
      cases.length,
    adversarialCases: evaluationCases.filter((item) =>
      item.id.includes("injection"),
    ).length,
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (passedCases !== cases.length) process.exitCode = 1;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Evaluation requires ${name}`);
  return value;
}

function parseRuns(value: string): number {
  const runs = Number(value);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) {
    throw new Error("EVAL_RUNS must be an integer from 1 to 10");
  }
  return runs;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  );
  return sorted[index] ?? 0;
}
