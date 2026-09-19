import type { FetchLike, FetchRequestInit, FetchResponse } from '../http';

/**
 * A `fetch` replacement for tests.
 *
 * Records every call so a test can assert the exact URL, method, headers and
 * JSON body the client produced — the whole point of testing the client without
 * a network. Deliberately not re-exported from `src/index.ts`, and excluded from
 * the build, because it is test scaffolding rather than package surface.
 */

export interface RecordedRequest {
  readonly url: string;
  readonly init: FetchRequestInit;
}

export interface ResponseSpec {
  readonly status?: number;
  /** Serialized with `JSON.stringify` and served as `application/json`. */
  readonly body?: unknown;
  /** Raw body text. Use this to serve something that is deliberately not JSON. */
  readonly text?: string;
  readonly headers?: Record<string, string>;
  /** Reject as if the request never reached the server. */
  readonly rejectWith?: unknown;
  /** Never settle until the request's signal aborts. Used to test timeouts. */
  readonly holdUntilAborted?: boolean;
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export interface FetchDouble {
  readonly calls: readonly RecordedRequest[];
  /** The most recent call, for the common single-request assertion. */
  lastCall(): RecordedRequest;
  /** The most recent request body parsed back into an object. */
  lastBody<T = unknown>(): T;
  readonly fetchImpl: FetchLike;
}

export function createFetchDouble(...queue: ResponseSpec[]): FetchDouble {
  const calls: RecordedRequest[] = [];
  let cursor = 0;

  const fetchImpl: FetchLike = (url: string, init: FetchRequestInit) => {
    calls.push({ url, init });

    const spec = queue[cursor];
    cursor += 1;

    if (spec === undefined) {
      // A missing response is a broken test, not a broken client: say so loudly
      // rather than silently returning something plausible.
      return Promise.reject(
        new Error(
          `fetch double received request #${cursor} (${init.method} ${url}) but only ${queue.length} response(s) were queued`,
        ),
      );
    }

    if (spec.rejectWith !== undefined) {
      return Promise.reject(spec.rejectWith);
    }

    if (spec.holdUntilAborted === true) {
      return new Promise<FetchResponse>((_resolve, reject) => {
        const signal = init.signal;
        if (signal === undefined) {
          return;
        }
        // A signal can already be aborted before it is handed over: the `abort`
        // event has fired and will not fire again, so the listener alone would
        // hang forever.
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        if (typeof signal.addEventListener !== 'function') {
          return;
        }
        signal.addEventListener('abort', () => reject(abortError()));
      });
    }

    const status = spec.status ?? 200;
    const text = spec.text ?? (spec.body === undefined ? '' : JSON.stringify(spec.body));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...spec.headers,
    };

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
      text: () => Promise.resolve(text),
    } satisfies FetchResponse);
  };

  function lastCall(): RecordedRequest {
    const call = calls[calls.length - 1];
    if (call === undefined) {
      throw new Error('No requests were made');
    }
    return call;
  }

  return {
    calls,
    lastCall,
    lastBody<T = unknown>(): T {
      const body = lastCall().init.body;
      if (body === undefined) {
        throw new Error('The last request had no body');
      }
      return JSON.parse(body) as T;
    },
    fetchImpl,
  };
}
