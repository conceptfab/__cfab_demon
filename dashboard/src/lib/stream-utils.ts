export async function readStreamToChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for (;;) {
    /* eslint-disable-next-line react-doctor/async-await-in-loop -- sequential stream read */
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const chunk of chunks) totalLen += chunk.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
