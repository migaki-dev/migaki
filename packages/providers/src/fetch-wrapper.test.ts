import { describe, expect, it } from "vitest";

import {
  createFetchCompatibleProviderWrapper,
  type FetchCompatibleTransport,
  type FetchProviderRequest,
} from "./index.js";

describe("fetch-compatible provider wrapper", () => {
  it("uses an injected transport while sanitizing request and response metadata", async () => {
    const seenRequests: FetchProviderRequest[] = [];
    const transport: FetchCompatibleTransport = async (request) => {
      seenRequests.push(request);

      return {
        body: "response contains secret text",
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      };
    };
    const wrapper = createFetchCompatibleProviderWrapper({
      provider: "mock-fetch",
      transport,
    });

    const result = await wrapper.request({
      body: '{"prompt":"secret prompt"}',
      headers: {
        Authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      id: "fetch-1",
      url: "https://provider.example/v1/messages",
    });

    expect(seenRequests).toEqual([
      {
        body: '{"prompt":"secret prompt"}',
        headers: {
          Authorization: "Bearer secret-token",
          "content-type": "application/json",
        },
        method: "POST",
        url: "https://provider.example/v1/messages",
      },
    ]);
    expect(result).toMatchObject({
      attempts: [
        {
          attempt: 1,
          retryable: false,
          status: 200,
        },
      ],
      evidence: {
        providerAssumptions: [
          {
            capability: "tool_calling",
            description:
              "Injected fetch-compatible transport owns network execution.",
          },
        ],
        redactions: [
          {
            path: "$.request.headers.authorization",
          },
          {
            path: "$.request.body",
          },
          {
            path: "$.response.body",
          },
        ],
      },
      request: {
        body: {
          mode: "omitted",
        },
        headers: [
          {
            name: "authorization",
            valueMode: "redacted",
          },
          {
            name: "content-type",
            value: "application/json",
            valueMode: "captured",
          },
        ],
      },
      response: {
        body: {
          mode: "omitted",
        },
        status: 200,
      },
      status: "succeeded",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("secret prompt");
    expect(JSON.stringify(result)).not.toContain(
      "response contains secret text",
    );
  });

  it("retries configured retryable status codes through the fake transport", async () => {
    const statuses = [429, 200];
    const transport: FetchCompatibleTransport = async () => ({
      status: statuses.shift() ?? 500,
    });
    const wrapper = createFetchCompatibleProviderWrapper({
      provider: "mock-fetch",
      transport,
    });

    const result = await wrapper.request({
      id: "fetch-retry",
      retry: {
        maxAttempts: 2,
      },
      url: "https://provider.example/v1/messages",
    });

    expect(result.status).toBe("succeeded");
    expect(result.attempts).toMatchObject([
      {
        attempt: 1,
        retryable: true,
        status: 429,
      },
      {
        attempt: 2,
        retryable: false,
        status: 200,
      },
    ]);
  });

  it("returns a retryable provider error when the final response fails", async () => {
    const wrapper = createFetchCompatibleProviderWrapper({
      provider: "mock-fetch",
      transport: async () => ({
        body: "temporary overload",
        status: 503,
      }),
    });

    const result = await wrapper.request({
      id: "fetch-failure",
      retry: {
        maxAttempts: 1,
      },
      url: "https://provider.example/v1/messages",
    });

    expect(result).toMatchObject({
      error: {
        code: "provider_http_error",
        message: "Provider returned HTTP 503.",
        retryable: true,
      },
      status: "failed",
    });
    expect(result.response?.body).toEqual({
      mode: "omitted",
    });
    expect(JSON.stringify(result)).not.toContain("temporary overload");
  });

  it("records explicit redaction and metadata-only body capture decisions", async () => {
    const wrapper = createFetchCompatibleProviderWrapper({
      provider: "mock-fetch",
      transport: async () => ({
        body: '{"ok":true}',
        status: 200,
      }),
    });

    const result = await wrapper.request({
      body: '{"apiKey":"secret-key"}',
      capture: {
        requestBody: "redacted",
        responseBody: "metadata_only",
      },
      id: "fetch-redaction",
      url: "https://provider.example/v1/messages",
    });

    expect(result.request.body).toEqual({
      length: 23,
      mode: "redacted",
    });
    expect(result.response?.body).toEqual({
      length: 11,
      mode: "metadata_only",
    });
    expect(result.evidence.redactions).toMatchObject([
      {
        mode: "redacted",
        path: "$.request.body",
      },
      {
        mode: "omitted",
        path: "$.response.body",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
