import { createToneWav, estimateDurationMs } from "../utils/wav.js";

export type SynthesizedAudio = { wav: Buffer; durationMs: number };
export interface TtsProvider {
  synthesize(text: string, index: number): Promise<SynthesizedAudio>;
}

export class LocalToneTtsProvider implements TtsProvider {
  async synthesize(text: string, index: number): Promise<SynthesizedAudio> {
    const durationMs = estimateDurationMs(text);
    return {
      durationMs,
      wav: createToneWav(durationMs, 180 + (index % 4) * 35),
    };
  }
}

export class HttpTtsProvider implements TtsProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}
  async synthesize(text: string): Promise<SynthesizedAudio> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text, format: "wav" }),
    });
    if (!response.ok) throw new Error(`TTS provider: HTTP ${response.status}`);
    const duration = response.headers.get("x-audio-duration-ms");
    if (!duration) throw new Error("Нет заголовка x-audio-duration-ms");
    return {
      wav: Buffer.from(await response.arrayBuffer()),
      durationMs: Number(duration),
    };
  }
}
