import { describe, expect, it } from "vitest";
import { frameJson, flushSseBuffer, parseFullFrame, parseSseChunk } from "@/lib/sse/frame";
import { frameFromData } from "@/lib/sse/transport";

describe("SSE frame parser", () => {
  it("parses a complete frame with id/event/data", () => {
    const { frames, rest } = parseSseChunk("", 'id: evt_1\nevent: task.log\ndata: {"seq":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe("evt_1");
    expect(frames[0].event).toBe("task.log");
    expect(frames[0].data).toBe('{"seq":1}');
    expect(rest).toBe("");
  });

  it("buffers a frame split across chunks", () => {
    const first = parseSseChunk("", 'id: evt_2\nevent: task.log\ndata: {"seq":');
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBeGreaterThan(0);

    const second = parseSseChunk(first.rest, "2}\n\n");
    expect(second.frames).toHaveLength(1);
    expect(JSON.parse(second.frames[0].data)).toEqual({ seq: 2 });
  });

  it("joins multi-line data with newlines", () => {
    const { frames } = parseSseChunk("", "data: line1\ndata: line2\n\n");
    expect(frames[0].data).toBe("line1\nline2");
  });

  it("surfaces comment frames", () => {
    const ping = parseSseChunk("", ": ping\n\n");
    expect(ping.frames[0].comment).toBe("ping");
    expect(ping.frames[0].data).toBe("");
  });

  it("records the retry hint", () => {
    const { frames } = parseSseChunk("", "retry: 3000\n\n");
    expect(frames[0].retry).toBe(3000);
  });

  it("handles CRLF line endings", () => {
    const { frames } = parseSseChunk("", 'id: a\r\nevent: x\r\ndata: {"k":1}\r\n\r\n');
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("x");
    expect(frames[0].id).toBe("a");
  });

  it("treats an empty id as null so Last-Event-ID is not reset", () => {
    const { frames } = parseSseChunk("", "id: \nevent: stream.reset\ndata: {}\n\n");
    expect(frames[0].id).toBeNull();
  });

  it("parses a realistic mixed stream in order", () => {
    const wire =
      ": ping\n\n" +
      'id: evt_3\nevent: task.log\ndata: {"seq":3,"type":"task.log"}\n\n' +
      'id: evt_4\nevent: task.status_changed\ndata: {"seq":4}\n\n';
    const { frames } = parseSseChunk("", wire);
    expect(frames).toHaveLength(3);
    expect(frames[0].comment).toBe("ping");
    expect(frames[1].id).toBe("evt_3");
    expect(frames[2].id).toBe("evt_4");
    expect(frames[1].data).toBe('{"seq":3,"type":"task.log"}');
  });

  it("parseFullFrame handles the already-unframed body EventSource delivers", () => {
    const frame = frameFromData('{"seq":9,"type":"task.log","message":"hi"}', "", "evt_9");
    expect(frame).not.toBeNull();
    expect(frameJson(frame!)).toMatchObject({ seq: 9, type: "task.log" });
  });

  it("flushes a trailing partial frame at EOF", () => {
    const frame = flushSseBuffer('id: z\ndata: {"a":1}\n');
    expect(frame).not.toBeNull();
    expect(frame!.id).toBe("z");
  });

  it("frameJson returns null for unparseable data", () => {
    expect(frameJson(parseFullFrame("data: not json\n")!)).toBeNull();
    expect(frameJson(parseFullFrame('data: {"ok":true}\n')!)).toEqual({ ok: true });
  });
});
