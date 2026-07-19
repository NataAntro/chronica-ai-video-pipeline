import { videoScriptSchema } from "../domain/validation.js";

export type ScriptEvaluation = {
  passed: boolean;
  schemaValid: boolean;
  metrics: {
    sectionCount: number;
    uniqueTitleRatio: number;
    lexicalDiversity: number;
    narrationCharacters: number;
    uniqueSectionIdRatio: number;
    topicCoverage: number;
    conceptCoverage: number;
    repeatedSentenceRatio: number;
    unsupportedNumericClaimCount: number;
    forbiddenPatternCount: number;
  };
  issues: string[];
};

export type ScriptEvaluationPolicy = {
  topicTerms?: string[];
  requiredConcepts?: string[][];
  forbiddenPatterns?: string[];
};

const words = (text: string): string[] =>
  text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}-]+/gu) ?? [];

const coverage = (groups: string[][], text: string): number =>
  groups.length === 0
    ? 1
    : groups.filter((group) =>
        group.some((term) => text.includes(term.toLocaleLowerCase("ru"))),
      ).length / groups.length;

export const evaluateScript = (
  candidate: unknown,
  policy: ScriptEvaluationPolicy = {},
): ScriptEvaluation => {
  const parsed = videoScriptSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      passed: false,
      schemaValid: false,
      metrics: {
        sectionCount: 0,
        uniqueTitleRatio: 0,
        lexicalDiversity: 0,
        narrationCharacters: 0,
        uniqueSectionIdRatio: 0,
        topicCoverage: 0,
        conceptCoverage: 0,
        repeatedSentenceRatio: 0,
        unsupportedNumericClaimCount: 0,
        forbiddenPatternCount: 0,
      },
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    };
  }

  const script = parsed.data;
  const titles = script.sections.map((section) =>
    section.title.trim().toLocaleLowerCase("ru"),
  );
  const uniqueTitleRatio = new Set(titles).size / titles.length;
  const uniqueSectionIdRatio =
    new Set(script.sections.map((section) => section.id)).size /
    script.sections.length;
  const narration = script.sections
    .map((section) => section.narration)
    .join(" ");
  const tokens = words(narration);
  const lexicalDiversity =
    tokens.length === 0 ? 0 : new Set(tokens).size / tokens.length;
  const evaluatedText = [
    script.title,
    ...script.sections.flatMap((section) => [section.title, section.narration]),
    script.closing,
  ]
    .join(" ")
    .toLocaleLowerCase("ru");
  const topicCoverage = coverage(
    (policy.topicTerms ?? []).map((term) => [term]),
    evaluatedText,
  );
  const conceptCoverage = coverage(
    policy.requiredConcepts ?? [],
    evaluatedText,
  );
  const sentences = evaluatedText
    .split(/[.!?]+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
  const repeatedSentenceRatio =
    sentences.length === 0
      ? 0
      : (sentences.length - new Set(sentences).size) / sentences.length;
  const unsupportedNumericClaimCount = (
    evaluatedText.match(
      /\b\d+(?:[.,]\d+)?\s*(?:%|процент|миллион|млрд)(?=\s|[.,!?]|$)/gu,
    ) ?? []
  ).length;
  const forbiddenPatternCount = (policy.forbiddenPatterns ?? []).filter(
    (pattern) => new RegExp(pattern, "iu").test(evaluatedText),
  ).length;
  const issues: string[] = [];
  if (uniqueTitleRatio < 1) issues.push("Заголовки разделов повторяются");
  if (uniqueSectionIdRatio < 1)
    issues.push("Идентификаторы разделов повторяются");
  if (lexicalDiversity < 0.45) issues.push("Низкое лексическое разнообразие");
  if (topicCoverage < 0.6) issues.push("Сценарий недостаточно раскрывает тему");
  if (conceptCoverage < 0.67) issues.push("Не покрыты обязательные понятия");
  if (repeatedSentenceRatio > 0) issues.push("Сценарий повторяет предложения");
  if (unsupportedNumericClaimCount > 0) {
    issues.push("Обнаружены числовые утверждения без опоры на источник");
  }
  if (forbiddenPatternCount > 0) {
    issues.push("Обнаружен запрещённый паттерн ответа");
  }

  return {
    passed: issues.length === 0,
    schemaValid: true,
    metrics: {
      sectionCount: script.sections.length,
      uniqueTitleRatio,
      lexicalDiversity,
      narrationCharacters: narration.length,
      uniqueSectionIdRatio,
      topicCoverage,
      conceptCoverage,
      repeatedSentenceRatio,
      unsupportedNumericClaimCount,
      forbiddenPatternCount,
    },
    issues,
  };
};
