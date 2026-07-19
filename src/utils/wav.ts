const SAMPLE_RATE = 16_000;
const HEADER_BYTES = 44;

const header = (buffer: Buffer, dataBytes: number): void => {
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
};

export const createToneWav = (durationMs: number, frequency = 220): Buffer => {
  const samples = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  const result = Buffer.alloc(HEADER_BYTES + samples * 2);
  header(result, samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(index / 300, (samples - index) / 300, 1);
    const value =
      Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * 1800 * fade;
    result.writeInt16LE(Math.round(value), HEADER_BYTES + index * 2);
  }
  return result;
};

export const concatenateWav = (inputs: Buffer[]): Buffer => {
  if (inputs.length === 0) throw new Error("Нет WAV chunks для склейки");
  const payloads = inputs.map((input) => {
    if (input.subarray(0, 4).toString() !== "RIFF") {
      throw new Error("TTS provider вернул неподдерживаемый WAV");
    }
    return input.subarray(HEADER_BYTES);
  });
  const dataBytes = payloads.reduce((sum, payload) => sum + payload.length, 0);
  const result = Buffer.alloc(HEADER_BYTES + dataBytes);
  header(result, dataBytes);
  Buffer.concat(payloads).copy(result, HEADER_BYTES);
  return result;
};

export const estimateDurationMs = (text: string): number =>
  Math.max(650, Math.min(1_800, Math.round(text.length * 13)));
