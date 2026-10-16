// A large backup must never require one contiguous copy of the JSON source.
// Keep only a bounded read buffer; the decoded business data is still retained
// for the existing validation, conflict preview and atomic save contract.
const READ_BYTES = 256 * 1024;

type JsonFrame =
    | { kind: 'array'; value: unknown[]; state: 'first' | 'next' | 'comma' }
    | { kind: 'object'; value: Record<string, unknown>; state: 'first' | 'next' | 'colon' | 'value' | 'comma'; key: string };

export async function parseLargeBackupJson(
    file: Blob,
    assertCurrent: () => void = () => {},
    chunkBytes = READ_BYTES,
): Promise<unknown> {
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new Error('Dimensione buffer non valida.');
    const stack: JsonFrame[] = [];
    let root: unknown;
    let rootSet = false;
    let token: 'string' | 'number' | 'literal' | null = null;
    let stringIsKey = false;
    let escaped = false;
    let raw = '';

    const invalid = (): never => { throw new Error('Formato JSON non valido. Il file originale resta intatto.'); };
    const assign = (value: unknown) => {
        const frame = stack[stack.length - 1];
        if (!frame) {
            if (rootSet) invalid();
            root = value;
            rootSet = true;
        } else if (frame.kind === 'array') {
            if (frame.state !== 'first' && frame.state !== 'next') invalid();
            frame.value.push(value);
            frame.state = 'comma';
        } else {
            if (frame.state !== 'value') invalid();
            // JSON.parse preserves "__proto__" as an own data key, never a setter.
            Object.defineProperty(frame.value, frame.key, { value, configurable: true, enumerable: true, writable: true });
            frame.state = 'comma';
        }
    };
    const open = (kind: 'array' | 'object') => {
        if (stack.length >= 512) invalid(); // Invalid/unreasonable nesting, not a file-size cap.
        if (kind === 'array') {
            const value: unknown[] = [];
            assign(value);
            stack.push({ kind, value, state: 'first' });
        } else {
            const value: Record<string, unknown> = {};
            assign(value);
            stack.push({ kind, value, state: 'first', key: '' });
        }
    };
    const finishPrimitive = () => {
        let value: unknown;
        try { value = JSON.parse(raw); } catch { return invalid(); }
        token = null;
        raw = '';
        assign(value);
    };
    const accept = (chunk: string) => {
        for (let i = 0; i < chunk.length; i++) {
            const char = chunk[i];
            if (token === 'string') {
                raw += char;
                if (escaped) { escaped = false; continue; }
                if (char === '\\') { escaped = true; continue; }
                if (char !== '"') continue;
                let value = '';
                try { value = JSON.parse(raw) as string; } catch { invalid(); }
                token = null;
                raw = '';
                if (stringIsKey) {
                    const frame = stack[stack.length - 1];
                    if (frame && frame.kind === 'object') {
                        if (frame.state !== 'first' && frame.state !== 'next') invalid();
                        frame.key = value;
                        frame.state = 'colon';
                    } else {
                        invalid();
                    }
                } else {
                    assign(value);
                }
                continue;
            }
            if (token === 'number' || token === 'literal') {
                if ((token === 'number' ? /[0-9eE+.-]/ : /[a-z]/).test(char)) {
                    raw += char;
                    continue;
                }
                finishPrimitive();
                i--; // Reprocess the separator after the value.
                continue;
            }
            if (char === ' ' || char === '\n' || char === '\t' || char === '\r') continue;
            const frame = stack[stack.length - 1];
            if (frame?.kind === 'object') {
                if (frame.state === 'colon') {
                    if (char !== ':') invalid();
                    frame.state = 'value';
                    continue;
                }
                if (frame.state === 'comma') {
                    if (char === '}') { stack.pop(); continue; }
                    if (char !== ',') invalid();
                    frame.state = 'next';
                    continue;
                }
                if (frame.state === 'first' || frame.state === 'next') {
                    if (char === '}' && frame.state === 'first') { stack.pop(); continue; }
                    if (char !== '"') invalid();
                    token = 'string';
                    stringIsKey = true;
                    escaped = false;
                    raw = '"';
                    continue;
                }
            }
            if (frame?.kind === 'array' && frame.state === 'comma') {
                if (char === ']') { stack.pop(); continue; }
                if (char !== ',') invalid();
                frame.state = 'next';
                continue;
            }
            if (frame?.kind === 'array' && char === ']' && frame.state === 'first') {
                stack.pop();
                continue;
            }
            if (!frame && rootSet) invalid();
            if (frame?.kind === 'object' && frame.state !== 'value') invalid();
            if (char === '{') { open('object'); continue; }
            if (char === '[') { open('array'); continue; }
            if (char === '"') {
                token = 'string';
                stringIsKey = false;
                escaped = false;
                raw = '"';
                continue;
            }
            if (/[0-9-]/.test(char)) { token = 'number'; raw = char; continue; }
            if (char === 't' || char === 'f' || char === 'n') { token = 'literal'; raw = char; continue; }
            invalid();
        }
    };

    const read = (part: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => reader.result instanceof ArrayBuffer
            ? resolve(reader.result) : reject(new Error('Lettura JSON non valida.'));
        reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
        reader.onabort = () => reject(new Error('Lettura del file annullata.'));
        reader.readAsArrayBuffer(part);
    });

    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
        assertCurrent();
        const bytes = await read(file.slice(offset, Math.min(offset + chunkBytes, file.size)));
        if (bytes.byteLength === 0) throw new Error('Lettura JSON incompleta. Il file originale resta intatto.');
        accept(decoder.decode(bytes, { stream: true }));
    }
    accept(decoder.decode());
    if (token === 'number' || token === 'literal') finishPrimitive();
    if (token || stack.length || !rootSet) invalid();
    assertCurrent();
    return root;
}
