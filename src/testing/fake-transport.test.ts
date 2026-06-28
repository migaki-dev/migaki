import { describe, expect, it } from "vitest";

import { FakeTransport } from "./fake-transport.js";

describe("FakeTransport", () => {
  it("records requests and responses for assertions", async () => {
    const transport = new FakeTransport([
      {
        status: 200,
        body: { ok: true },
      },
    ]);

    const response = await transport.send({
      method: "POST",
      url: "https://provider.example.test/v1/messages",
      body: { prompt: "redacted fixture prompt" },
    });

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(transport.exchanges).toEqual([
      {
        request: {
          method: "POST",
          url: "https://provider.example.test/v1/messages",
          body: { prompt: "redacted fixture prompt" },
        },
        response: {
          status: 200,
          body: { ok: true },
        },
      },
    ]);
  });

  it("records thrown transport errors without hiding the failure", async () => {
    const transport = new FakeTransport([
      new Error("network unavailable in fixture"),
    ]);

    await expect(
      transport.send({ url: "https://provider.example.test/v1/messages" }),
    ).rejects.toThrow("network unavailable in fixture");

    expect(transport.exchanges).toEqual([
      {
        request: {
          url: "https://provider.example.test/v1/messages",
        },
        error: new Error("network unavailable in fixture"),
      },
    ]);
  });
});
