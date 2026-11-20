import type { VideoScript } from "../domain/types.js";
import { videoScriptJsonSchema } from "../domain/validation.js";
import {
  buildGenerationPrompt,
  buildRepairPrompt,
  type ScenarioPrompt,
} from "../prompts/scenario.js";

export interface LlmProvider {
  generate(topic: string): Promise<unknown>;
  repair(candidate: unknown, errors: string[]): Promise<unknown>;
}

const topicDetails = (topic: string): [string, string, string] => {
  const normalized = topic.toLocaleLowerCase("ru");
  if (normalized.includes("мультимодаль")) {
    return [
      "локальное выполнение мультимодальной модели сокращает передачу данных во внешнее облако",
      "приватность проверяется на границе изображений, текста и метаданных",
      "качество сравнивается на одинаковом наборе входов и версиях модели",
    ];
  }
  if (normalized.includes("медиаконвейер") || normalized.includes("рендер")) {
    return [
      "сценарий и параметры рендера фиксируются как версионируемые артефакты",
      "готовое аудио задаёт длительность субтитров и кадров",
      "контрольные суммы позволяют воспроизводимо продолжить медиаконвейер",
    ];
  }
  if (normalized.includes("rag") || normalized.includes("поиск")) {
    return [
      "retrieval связывает найденный фрагмент с проверяемым источником",
      "grounded ответ отделяет факты контекста от предположений модели",
      "evaluation измеряет recall, ранжирование и корректность ссылок",
    ];
  }
  if (normalized.includes("приват") || normalized.includes("данн")) {
    return [
      "минимизация данных оставляет только необходимые для запроса поля",
      "прямые идентификаторы маскируются до передачи внешней модели",
      "аудит фиксирует разрешённые поля без сохранения чувствительного текста",
    ];
  }
  if (normalized.includes("дрейф") || normalized.includes("регресс")) {
    return [
      "версии модели и промпта входят в fingerprint контрольного прогона",
      "регрессионный набор отделён от примеров в инструкциях",
      "дрейф виден по распределению метрик в нескольких запусках",
    ];
  }
  return [
    "типизированная схема проверяет структуру каждого ответа агента",
    "ограниченные повторы и трасса решений делают восстановление наблюдаемым",
    "evaluation отделяет корректный JSON от качества итогового материала",
  ];
};

const technologyDigestScript = (topic: string): VideoScript => {
  const safeTopic =
    topic.split(/[.!?]/u)[0]?.trim().slice(0, 58) || "AI-системы";
  const details = topicDetails(safeTopic);
  return {
    title: `Технологический радар: ${safeTopic}`,
    edition: "Технологический дайджест 01",
    sections: [
      {
        id: "local-models",
        title: "Проверяемая граница",
        narration: `Для темы «${safeTopic}» важен инженерный контракт: ${details[0]}.`,
        accent: "#68D8D6",
      },
      {
        id: "reliable-agents",
        title: "Управляемое выполнение",
        narration: `Следующий слой контроля для темы «${safeTopic}»: ${details[1]}.`,
        accent: "#F7B267",
      },
      {
        id: "media-code",
        title: "Измеримый результат",
        narration: `Критерий готовности материала по теме «${safeTopic}»: ${details[2]}.`,
        accent: "#A78BFA",
      },
    ],
    closing:
      "Результат принимается после проверки структуры, качества и воспроизводимости каждого этапа.",
  };
};

export class LocalScriptProvider implements LlmProvider {
  async generate(topic: string): Promise<unknown> {
    return technologyDigestScript(topic);
  }
  async repair(candidate: unknown, errors: string[]): Promise<unknown> {
    void candidate;
    void errors;
    return technologyDigestScript("Восстановленный технологический сценарий");
  }
}

type Fetch = typeof fetch;

type ResponsesBody = {
  output_text?: unknown;
  output?: unknown;
};

export class OpenAIResponsesProvider implements LlmProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly requestTimeoutMs = 20_000,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  private async request(prompt: ScenarioPrompt): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "x-prompt-version": prompt.version,
        },
        body: JSON.stringify({
          model: this.model,
          instructions: prompt.instructions,
          input: prompt.input,
          text: {
            format: {
              type: "json_schema",
              name: "chronica_video_script",
              strict: true,
              schema: videoScriptJsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LLM provider: HTTP ${response.status}`);
      }
      const body = (await response.json()) as ResponsesBody;
      return JSON.parse(extractOutputText(body));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `LLM provider timed out after ${this.requestTimeoutMs} ms`,
          {
            cause: error,
          },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(topic: string): Promise<unknown> {
    return this.request(buildGenerationPrompt(topic));
  }
  async repair(candidate: unknown, errors: string[]): Promise<unknown> {
    return this.request(buildRepairPrompt(candidate, errors));
  }
}

const extractOutputText = (body: ResponsesBody): string => {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) {
    throw new Error("LLM provider response does not contain structured output");
  }
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !("content" in item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
    }
  }
  throw new Error("LLM provider response does not contain output text");
};
