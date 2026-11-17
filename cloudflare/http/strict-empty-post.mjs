// Browser POSTs, including zero-byte fetches and native forms, can expose a
// non-null body stream. Drain it before any Auth operation: Content-Length: 0
// alone is not proof of emptiness, and a body must never reach the Auth gate.
export async function strictlyEmptyPost(request) {
  const length = request.headers.get('content-length');
  if (length !== null && length !== '0') return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), 2000);
  });
  try {
    for (let count = 0; count < 4; count += 1) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) return false;
      if (chunk.done) return true;
      if (!ArrayBuffer.isView(chunk.value) || chunk.value.BYTES_PER_ELEMENT !== 1 || chunk.value.byteLength > 0) return false;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A timed-out stream may have a pending read. */ }
  }
}
