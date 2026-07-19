import { HttpLlmProvider, LocalScriptProvider } from "./providers/llm.js";
import { HttpTtsProvider, LocalToneTtsProvider } from "./providers/tts.js";

export const createProviders = (environment: NodeJS.ProcessEnv) => {
  const mode =
    environment.PIPELINE_PROVIDER === "external" ? "external" : "local";
  if (mode === "local") {
    return {
      mode,
      llm: new LocalScriptProvider(),
      tts: new LocalToneTtsProvider(),
    } as const;
  }
  const llmEndpoint = environment.LLM_ENDPOINT;
  const llmApiKey = environment.LLM_API_KEY;
  const ttsEndpoint = environment.TTS_ENDPOINT;
  const ttsApiKey = environment.TTS_API_KEY;
  if (!llmEndpoint || !llmApiKey || !ttsEndpoint || !ttsApiKey) {
    throw new Error(
      "External-режим требует LLM_ENDPOINT, LLM_API_KEY, TTS_ENDPOINT и TTS_API_KEY",
    );
  }
  return {
    mode,
    llm: new HttpLlmProvider(llmEndpoint, llmApiKey),
    tts: new HttpTtsProvider(ttsEndpoint, ttsApiKey),
  } as const;
};
