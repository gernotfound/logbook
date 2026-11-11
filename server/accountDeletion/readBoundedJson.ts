// A recovery/deletion command is a small JSON instruction, never a bulk upload.
// This protects function memory and processing time independently of the proxy's
// maximum body size, including chunked requests without Content-Length.
export class BoundedJsonBodyError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413 = 400) {
    super(message);
    this.name = 'BoundedJsonBodyError';
  }
}

export const MAX_TRUSTED_COMMAND_BYTES = 8 * 1024;
const MAX_BODY_READ_MS = 2_000;

export function assertBoundedJsonContentLength(request: Request): void {
  const length = request.headers.get('content-length');
  if (length === null) return;
  if (!/^\d+$/.test(length)) throw new BoundedJsonBodyError('Lunghezza richiesta non valida.');
  if (Number(length) > MAX_TRUSTED_COMMAND_BYTES) {
    throw new BoundedJsonBodyError('Richiesta troppo grande.', 413);
  }
}

export async function readBoundedJsonObject(request: Request): Promise<Record<string, unknown>> {
  assertBoundedJsonContentLength(request);
  if (!request.body) throw new BoundedJsonBodyError('Corpo JSON non valido.');

  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_TRUSTED_COMMAND_BYTES);
  let used = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => resolve(null), MAX_BODY_READ_MS);
  });
  try {
    let emptyChunks = 0;
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === null) throw new BoundedJsonBodyError('Lettura della richiesta scaduta. Riprova.', 408);
      if (part.done) break;
      if (part.value.byteLength === 0) {
        if (++emptyChunks >= 16) throw new BoundedJsonBodyError('Lettura della richiesta scaduta. Riprova.', 408);
        continue;
      }
      if (part.value.byteLength > MAX_TRUSTED_COMMAND_BYTES - used) {
        throw new BoundedJsonBodyError('Richiesta troppo grande.', 413);
      }
      bytes.set(part.value, used);
      used += part.value.byteLength;
      emptyChunks = 0;
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new BoundedJsonBodyError('Corpo JSON non valido.');
  }
}
