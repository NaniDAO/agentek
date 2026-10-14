/**
 * Throws an error if the fetch response is not OK.
 */
export async function assertOkResponse(
  response: Response,
  context: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`${context}: ${response.status} ${response.statusText}`);
  }
}

/** Read a bounded UTF8 JSON body before parsing any attacker-provided arrays. */
export async function readBoundedJSON(response: Response, maximumBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.byteLength > maximumBytes - size) throw new Error("Oversized response body");
      size += value.byteLength; text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel(); reader.releaseLock(); }
}
