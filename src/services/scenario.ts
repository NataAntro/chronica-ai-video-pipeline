import { ZodError } from "zod";
import type { VideoScript } from "../domain/types.js";
import { parseVideoScript } from "../domain/validation.js";
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
  let candidate: unknown;
  let errors: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      candidate =
        attempt === 1
          ? await provider.generate(topic)
          : await provider.repair(candidate, errors);
      return parseVideoScript(candidate);
    } catch (error) {
      errors = explain(error);
    }
  }
  throw new Error(`Сценарий не восстановлен: ${errors.join("; ")}`);
};
