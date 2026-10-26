export interface ResponseFilter {
  ondata: ((event: {data: ArrayBuffer}) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  write(data: ArrayBuffer): void;
  close(): void;
  disconnect(): void;
}

// Firefox supplies the decoded response stream. Pass it through unchanged and
// authenticate only after EOF. Oversized/interrupted streams never get a verdict.
export function captureResponse(filter: ResponseFilter, completed: (bytes?: Uint8Array) => void, limit = 16 * 1024 * 1024): void {
  let chunks: Uint8Array[] = [];
  let length = 0;
  let failed = false;
  let finished = false;
  const finish = (bytes?: Uint8Array) => {
    if (finished) return;
    finished = true;
    completed(bytes);
  };
  const abandon = () => { try { filter.disconnect(); } catch { /* Already closed or disconnected. */ } };
  filter.ondata = ({data}) => {
    if (finished) return;
    try {
      filter.write(data);
      length += data.byteLength;
      if (length > limit) { failed = true; chunks = []; }
      if (!failed) chunks.push(new Uint8Array(data).slice());
    } catch { failed = true; chunks = []; abandon(); finish(); }
  };
  filter.onerror = () => { failed = true; chunks = []; abandon(); finish(); };
  filter.onstop = () => {
    if (finished) return;
    try { filter.close(); } catch { failed = true; abandon(); }
    if (failed) { finish(); return; }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    chunks = [];
    finish(bytes);
  };
}
