// Doc 09 §11.1 — the transport seam. `client.ts` owns lifecycle and backoff; a
// transport owns only the socket. Keeping them separate makes the mock (§11.2)
// and the real `EventSource` interchangeable and unit-testable.
import type { SseFrame } from "./types";

export interface TransportHandlers {
  onOpen(): void;
  /** default (`message`) events, and any frame the server did not name */
  onMessage(data: string, lastEventId: string): void;
  /** explicitly named events: `stream.reset`, `stream.reconnect`, `error` */
  onNamedEvent(name: string, data: string, lastEventId: string): void;
  onError(): void;
}

export interface Transport {
  close(): void;
}

export type TransportFactory = (url: string, handlers: TransportHandlers) => Transport;

/** Events that `EventSource.onmessage` never delivers (named `event:` values). */
export const NAMED_EVENTS = ["stream.reset", "stream.reconnect", "error"] as const;

/** Real transport: a single `EventSource`, with the browser's native reconnect. */
export const eventSourceTransport: TransportFactory = (url, handlers) => {
  const source = new EventSource(url);

  source.onopen = () => handlers.onOpen();
  source.onmessage = (event: MessageEvent<string>) => {
    handlers.onMessage(event.data, event.lastEventId ?? "");
  };
  for (const name of NAMED_EVENTS) {
    source.addEventListener(name, (event: Event) => {
      const message = event as MessageEvent<string>;
      handlers.onNamedEvent(name, message.data ?? "", message.lastEventId ?? "");
    });
  }
  source.onerror = () => handlers.onError();

  return {
    close() {
      source.onopen = null;
      source.onmessage = null;
      source.onerror = null;
      for (const name of NAMED_EVENTS) source.removeEventListener(name, () => {});
      source.close();
    },
  };
};

/** Frame a bare data payload the way the wire would have framed it. */
export function frameFromData(data: string, event: string, lastEventId: string): SseFrame {
  // `EventSource` has already stripped the `id:`/`event:`/`data:` framing, so the
  // payload must be wrapped directly — parsing it as wire text would lose the data.
  let name = event;
  if (!name) {
    // Doc 09 §5.1: `event:` mirrors `data.type`; recover it when the browser
    // delivered a plain `message` event.
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null) {
        const type = (parsed as { type?: unknown }).type;
        if (typeof type === "string") name = type;
      }
    } catch {
      // Not JSON: leave the event name empty.
    }
  }
  return {
    id: lastEventId || null,
    event: name,
    data,
    retry: null,
    comment: null,
    receivedAt: Date.now(),
  };
}
