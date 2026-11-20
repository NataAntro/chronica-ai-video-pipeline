import { ZodError } from "zod";
import type { VideoScript } from "../domain/types.js";
import { parseVideoScript } from "../domain/validation.js";
import { evaluateScript } from "../evaluation/scriptEvaluation.js";
import type { LlmProvider } from "../providers/llm.js";

const explain = (error: unknown): string[] =>
  error instanceof ZodError
    ? error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      )
    : [error instanceof Error ? error.message : String(error)];

export const generateScenarioWithRecovery = async (
  provider: LlmProvider,
  topic: string,
  attempts = 3,
): Promise<VideoScript> => {
  const result = await generateScenarioWithTrace(provider, topic, attempts);
  return result.script;
};

export type ScenarioAttempt = {
  attempt: number;
  action: "generate" | "repair";
  accepted: boolean;
  errors: string[];
};

export type ScenarioResult = {
  script: VideoScript;
  trace: ScenarioAttempt[];
};

export const generateScenarioWithTrace = async (
  provider: LlmProvider,
  topic: string,
  attempts = 3,
): Promise<ScenarioResult> => {
  if (attempts < 1) throw new Error("attempts must be positive");
  let candidate: unknown;
  let hasCandidate = false;
  let errors: string[] = [];
  const trace: ScenarioAttempt[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const action = hasCandidate ? "repair" : "generate";
    try {
      candidate =
        action === "generate"
          ? await provider.generate(topic)
          : await provider.repair(candidate, errors);
      hasCandidate = true;
      const script = parseVideoScript(candidate);
      const evaluation = evaluateScript(script);
      if (!evaluation.passed) throw new Error(evaluation.issues.join("; "));
      trace.push({ attempt, action, accepted: true, errors: [] });
      return { script, trace };
    } catch (error) {
      errors = explain(error);
      trace.push({
        attempt,
        action,
        accepted: false,
        errors,
      });
    }
  }
  throw new Error(`Сценарий не восстановлен: ${errors.join("; ")}`);
};
