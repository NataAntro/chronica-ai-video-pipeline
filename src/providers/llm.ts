import type { VideoScript } from "../domain/types.js";

export interface LlmProvider {
  generate(topic: string): Promise<unknown>;
  repair(candidate: unknown, errors: string[]): Promise<unknown>;
}

const technologyDigestScript = (): VideoScript => ({
  title: "Технологический радар: локальные AI-инструменты",
  edition: "Технологический дайджест 01",
  sections: [
    {
      id: "local-models",
      title: "Модели становятся ближе",
      narration:
        "Компактные модели запускаются на обычных ноутбуках и помогают обрабатывать рабочие заметки без внешнего облака.",
      accent: "#68D8D6",
    },
    {
      id: "reliable-agents",
      title: "Надёжность важнее магии",
      narration:
        "Инженерные команды добавляют схемы данных, повторные попытки и проверяемые артефакты вместо надежды на один идеальный ответ.",
      accent: "#F7B267",
    },
    {
      id: "media-code",
      title: "Видео как программа",
      narration:
        "Программный рендер делает монтаж воспроизводимым: сценарий, звук, субтитры и короткий ролик собираются одной командой.",
      accent: "#A78BFA",
    },
  ],
  closing:
    "Главный тренд недели — AI-системы становятся не только мощнее, но и инженерно предсказуемее.",
});

export class LocalScriptProvider implements LlmProvider {
  async generate(topic: string): Promise<unknown> {
    void topic;
    return technologyDigestScript();
  }
  async repair(candidate: unknown, errors: string[]): Promise<unknown> {
    void candidate;
    void errors;
    return technologyDigestScript();
  }
}

export class HttpLlmProvider implements LlmProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  private async request(payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`LLM provider: HTTP ${response.status}`);
    return response.json();
  }

  async generate(topic: string): Promise<unknown> {
    return this.request({ task: "structured-tech-digest", topic });
  }
  async repair(candidate: unknown, errors: string[]): Promise<unknown> {
    return this.request({
      task: "repair-structured-output",
      candidate,
      errors,
    });
  }
}
