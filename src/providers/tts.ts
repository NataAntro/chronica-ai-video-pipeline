import {
  createToneWav,
  estimateDurationMs,
  inspectPcmWav,
} from "../utils/wav.js";

export type SynthesizedAudio = { wav: Buffer; durationMs: number };
export interface TtsProvider {
  synthesize(text: string, index: number): Promise<SynthesizedAudio>;
}

type Fetch = typeof fetch;

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
    private readonly requestTimeoutMs = 20_000,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}
  async synthesize(text: string, index: number): Promise<SynthesizedAudio> {
    void index;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text, format: "wav" }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`TTS provider: HTTP ${response.status}`);
      }
      const wav = Buffer.from(await response.arrayBuffer());
      const { durationMs } = inspectPcmWav(wav);
      return {
        wav,
        durationMs,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `TTS provider timed out after ${this.requestTimeoutMs} ms`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
