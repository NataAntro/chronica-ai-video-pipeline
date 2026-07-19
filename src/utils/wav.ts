const SAMPLE_RATE = 16_000;
const HEADER_BYTES = 44;

export type PcmWav = {
  payload: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
};

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

export const inspectPcmWav = (input: Buffer): PcmWav => {
  if (
    input.length < HEADER_BYTES ||
    input.subarray(0, 4).toString("ascii") !== "RIFF" ||
    input.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    throw new Error("TTS provider вернул неподдерживаемый WAV");
  }
  const riffBytes = input.readUInt32LE(4) + 8;
  if (riffBytes < 12 || riffBytes > input.length) {
    throw new Error("WAV RIFF size не соответствует размеру файла");
  }

  let offset = 12;
  let format: Omit<PcmWav, "payload" | "durationMs"> | undefined;
  let payload: Buffer | undefined;
  while (offset + 8 <= input.length) {
    const chunkId = input.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = input.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > input.length) {
      throw new Error(`WAV chunk ${chunkId} выходит за границы файла`);
    }
    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("WAV fmt chunk слишком короткий");
      const audioFormat = input.readUInt16LE(chunkStart);
      const channels = input.readUInt16LE(chunkStart + 2);
      const sampleRate = input.readUInt32LE(chunkStart + 4);
      const byteRate = input.readUInt32LE(chunkStart + 8);
      const blockAlign = input.readUInt16LE(chunkStart + 12);
      const bitsPerSample = input.readUInt16LE(chunkStart + 14);
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (
        audioFormat !== 1 ||
        channels !== 1 ||
        sampleRate !== SAMPLE_RATE ||
        bitsPerSample !== 16 ||
        blockAlign !== expectedBlockAlign ||
        byteRate !== sampleRate * expectedBlockAlign
      ) {
        throw new Error("Поддерживается только mono PCM WAV 16 kHz / 16 bit");
      }
      format = { sampleRate, channels, bitsPerSample };
    } else if (chunkId === "data") {
      payload = input.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!format || !payload || payload.length === 0) {
    throw new Error("WAV не содержит корректные fmt и data chunks");
  }
  const blockAlign = format.channels * (format.bitsPerSample / 8);
  if (payload.length % blockAlign !== 0) {
    throw new Error("WAV data chunk не выровнен по PCM frame");
  }
  const bytesPerSecond =
    format.sampleRate * format.channels * (format.bitsPerSample / 8);
  return {
    ...format,
    payload,
    durationMs: Math.round((payload.length / bytesPerSecond) * 1000),
  };
};

export const concatenateWav = (inputs: Buffer[]): Buffer => {
  if (inputs.length === 0) throw new Error("Нет WAV chunks для склейки");
  const inspected = inputs.map(inspectPcmWav);
  const reference = inspected[0];
  if (!reference) throw new Error("Нет WAV chunks для склейки");
  if (
    inspected.some(
      (item) =>
        item.sampleRate !== reference.sampleRate ||
        item.channels !== reference.channels ||
        item.bitsPerSample !== reference.bitsPerSample,
    )
  ) {
    throw new Error("WAV chunks имеют несовместимые PCM-параметры");
  }
  const payloads = inspected.map((item) => item.payload);
  const dataBytes = payloads.reduce((sum, payload) => sum + payload.length, 0);
  const result = Buffer.alloc(HEADER_BYTES + dataBytes);
  header(result, dataBytes);
  Buffer.concat(payloads).copy(result, HEADER_BYTES);
  return result;
};

export const estimateDurationMs = (text: string): number =>
  Math.max(650, Math.min(1_800, Math.round(text.length * 13)));
