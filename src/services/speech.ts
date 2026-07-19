import type {
  SpeechBlock,
  SubtitleCue,
  TtsChunk,
  VideoScript,
} from "../domain/types.js";

export const buildSpeechBlocks = (script: VideoScript): SpeechBlock[] => [
  { id: "intro", sectionId: "intro", text: script.title },
  ...script.sections.map((section) => ({
    id: `speech-${section.id}`,
    sectionId: section.id,
    text: `${section.title}. ${section.narration}`,
  })),
  { id: "closing", sectionId: "closing", text: script.closing },
];

const splitWords = (text: string, limit: number): string[] => {
  const output: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      output.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) output.push(current);
  return output;
};

export const chunkSpeech = (
  blocks: SpeechBlock[],
  maxCharacters = 140,
): TtsChunk[] =>
  blocks.flatMap((block) => {
    const sentences = block.text.match(/[^.!?]+[.!?]?/gu) ?? [block.text];
    const pieces = sentences.flatMap((sentence) =>
      splitWords(sentence.trim(), maxCharacters),
    );
    const chunks: string[] = [];
    let current = "";
    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (candidate.length > maxCharacters && current) {
        chunks.push(current);
        current = piece;
      } else current = candidate;
    }
    if (current) chunks.push(current);
    return chunks.map((text, chunkIndex) => ({ ...block, text, chunkIndex }));
  });

export const buildHeuristicSubtitles = (
  chunks: Array<TtsChunk & { durationMs: number }>,
): SubtitleCue[] => {
  let cursorMs = 0;
  return chunks.map((chunk) => {
    const cue = {
      id: `${chunk.id}-${chunk.chunkIndex}`,
      text: chunk.text,
      startMs: cursorMs,
      endMs: cursorMs + chunk.durationMs,
    };
    cursorMs = cue.endMs;
    return cue;
  });
};
