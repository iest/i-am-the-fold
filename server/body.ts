export class BodyError extends Error {
  constructor(
    public status: 400 | 408 | 413,
    message: string,
  ) {
    super(message);
  }
}

export async function readJsonBody(
  req: Request,
  maxBytes = 4096,
  timeoutMs = 3000,
): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > maxBytes)
    throw new BodyError(413, "Request too large");
  const reader = req.body?.getReader();
  if (!reader) throw new BodyError(400, "Missing body");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel = false;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new BodyError(408, "Request timed out")),
      timeoutMs,
    );
  });
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new BodyError(413, "Request too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    cancel = true;
    throw error;
  } finally {
    clearTimeout(timeout);
    // A slow sender must not delay the rejection while its stream cancels.
    if (cancel) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
