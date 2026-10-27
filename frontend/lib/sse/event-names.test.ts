import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "./event-types";
import { NAMED_EVENTS, SUBSCRIBED_EVENTS, TASK_EVENT_NAMES, frameFromData } from "./transport";

/**
 * Doc 09 §5.1 / §11 — regression guards for the named-event dispatch.
 *
 * The server mirrors the payload `type` into the SSE `event:` field. `EventSource`
 * only fires `onmessage` for nameless events, so an unsubscribed name is dropped
 * without any error. That bug left the activity ring permanently empty.
 */

describe("subscribed event names", () => {
  it("covers every EventType the server can emit", () => {
    for (const type of EVENT_TYPES) {
      expect(SUBSCRIBED_EVENTS).toContain(type);
    }
  });

  it("still listens for the three transport control frames", () => {
    expect(NAMED_EVENTS).toEqual(["stream.reset", "stream.reconnect", "error"]);
    for (const name of NAMED_EVENTS) expect(SUBSCRIBED_EVENTS).toContain(name);
  });

  it("has no duplicates", () => {
    expect(new Set(SUBSCRIBED_EVENTS).size).toBe(SUBSCRIBED_EVENTS.length);
  });

  it("recovers the event name from data.type when the browser sent no name", () => {
    const frame = frameFromData(JSON.stringify({ type: "task.log", seq: 3 }), "", "");
    expect(frame.event).toBe("task.log");
  });

  it("keeps TASK_EVENT_NAMES aligned with EVENT_TYPES", () => {
    expect([...TASK_EVENT_NAMES]).toEqual([...EVENT_TYPES]);
  });
});
