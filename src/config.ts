import {
  LocalScriptProvider,
  OpenAIResponsesProvider,
} from "./providers/llm.js";
import { HttpTtsProvider, LocalToneTtsProvider } from "./providers/tts.js";

export const createProviders = (environment: NodeJS.ProcessEnv) => {
  const mode =
    environment.PIPELINE_PROVIDER === "external" ? "external" : "local";
  if (mode === "local") {
    return {
      mode,
      llm: new LocalScriptProvider(),
      tts: new LocalToneTtsProvider(),
      llmProfile: "local-script-v2",
      ttsProfile: "local-tone-pcm-v1",
    } as const;
  }
  const llmEndpoint = environment.LLM_ENDPOINT;
  const llmApiKey = environment.LLM_API_KEY;
  const llmModel = environment.LLM_MODEL;
  const ttsEndpoint = environment.TTS_ENDPOINT;
  const ttsApiKey = environment.TTS_API_KEY;
  if (!llmEndpoint || !llmApiKey || !llmModel || !ttsEndpoint || !ttsApiKey) {
    throw new Error(
      "External-режим требует LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL, TTS_ENDPOINT и TTS_API_KEY",
    );
  }
  return {
    mode,
    llm: new OpenAIResponsesProvider(llmEndpoint, llmApiKey, llmModel),
    tts: new HttpTtsProvider(ttsEndpoint, ttsApiKey),
    llmProfile: `responses:${llmModel}`,
    ttsProfile: "http-pcm-wav-v1",
  } as const;
};
