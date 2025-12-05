export type UploadFn<T = any> = (items: T[], index: number) => Promise<void>;
export type SingleFn<T = any> = (item: T, index: number) => Promise<void>;

function assertNotAborted(signal?: AbortSignal) {
  if (!signal) return;
  if (typeof (signal as any).throwIfAborted === "function") {
    try {
      (signal as any).throwIfAborted();
      return;
    } catch (error) {
      throw error;
    }
  }
  if (signal.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }
}

export async function uploadInBatches<T>(
  rows: T[],
  opts: {
    bulk?: UploadFn<T>;
    single?: SingleFn<T>;
    batchSize?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const total = rows.length;
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const onProgress = opts.onProgress ?? (() => {});
  let completed = 0;

  if (total === 0) {
    onProgress(0, 0);
    return;
  }

  if (opts.bulk) {
    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      chunks.push(rows.slice(i, i + batchSize));
    }
    let cursor = 0;

    async function runChunk() {
      while (true) {
        assertNotAborted(opts.signal);
        const index = cursor;
        if (index >= chunks.length) return;
        cursor += 1;
        const chunk = chunks[index];
        await opts.bulk!(chunk, index);
        completed += chunk.length;
        onProgress(Math.min(completed, total), total);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => runChunk());
    await Promise.all(workers);
    return;
  }

  if (!opts.single) {
    throw new Error("uploadInBatches: neither bulk nor single handler was provided");
  }

  let pointer = 0;

  async function runner() {
    while (true) {
      assertNotAborted(opts.signal);
      const index = pointer;
      if (index >= rows.length) return;
      pointer += 1;
      const item = rows[index];
      let attempts = 0;
      // Retry transient failures twice before bubbling up.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await opts.single!(item, index);
          break;
        } catch (error) {
          attempts += 1;
          if (attempts > 2) throw error;
        }
      }
      completed += 1;
      onProgress(Math.min(completed, total), total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, () => runner());
  await Promise.all(workers);
}