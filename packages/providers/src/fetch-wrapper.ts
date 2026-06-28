import type {
  ProviderCapabilityAssumption,
  ProviderExecutionError,
  ProviderWarning,
} from "./contracts.js";

export type FetchBodyCaptureMode = "metadata_only" | "omitted" | "redacted";

export interface FetchCapturePolicy {
  readonly requestBody?: FetchBodyCaptureMode;
  readonly responseBody?: FetchBodyCaptureMode;
}

export interface FetchProviderRetryPolicy {
  readonly maxAttempts?: number;
  readonly retryStatusCodes?: readonly number[];
  readonly retryTransportErrors?: boolean;
}

export interface FetchProviderRequest {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: string;
  readonly url: string;
}

export interface FetchProviderResponse {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly status: number;
}

export type FetchCompatibleTransport = (
  request: FetchProviderRequest,
) => Promise<FetchProviderResponse>;

export interface FetchProviderWrapperOptions {
  readonly provider: string;
  readonly transport: FetchCompatibleTransport;
}

export interface FetchProviderWrapperRequest {
  readonly body?: string;
  readonly capture?: FetchCapturePolicy;
  readonly headers?: Readonly<Record<string, string>>;
  readonly id: string;
  readonly method?: string;
  readonly retry?: FetchProviderRetryPolicy;
  readonly url: string;
}

export interface CapturedFetchHeader {
  readonly name: string;
  readonly value?: string;
  readonly valueMode: "captured" | "redacted";
}

export interface CapturedFetchBody {
  readonly length?: number;
  readonly mode: FetchBodyCaptureMode;
}

export interface CapturedFetchRequest {
  readonly body: CapturedFetchBody;
  readonly headers: readonly CapturedFetchHeader[];
  readonly method: string;
  readonly url: string;
}

export interface CapturedFetchResponse {
  readonly body: CapturedFetchBody;
  readonly headers: readonly CapturedFetchHeader[];
  readonly status: number;
}

export interface FetchProviderAttempt {
  readonly attempt: number;
  readonly error?: ProviderExecutionError;
  readonly retryable: boolean;
  readonly status?: number;
}

export interface FetchWrapperRedaction {
  readonly mode: "omitted" | "redacted";
  readonly path: string;
  readonly reason: string;
}

export interface FetchWrapperEvidence {
  readonly providerAssumptions: readonly ProviderCapabilityAssumption[];
  readonly redactions: readonly FetchWrapperRedaction[];
  readonly warnings: readonly ProviderWarning[];
}

export interface FetchProviderWrapperResult {
  readonly attempts: readonly FetchProviderAttempt[];
  readonly error?: ProviderExecutionError;
  readonly evidence: FetchWrapperEvidence;
  readonly id: string;
  readonly provider: string;
  readonly request: CapturedFetchRequest;
  readonly response?: CapturedFetchResponse;
  readonly status: "failed" | "succeeded";
}

export interface FetchCompatibleProviderWrapper {
  readonly provider: string;
  request(
    input: FetchProviderWrapperRequest,
  ): Promise<FetchProviderWrapperResult>;
}

const defaultRetryStatusCodes = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);
const sensitiveHeaders = new Set([
  "anthropic-api-key",
  "api-key",
  "authorization",
  "cookie",
  "openai-api-key",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

export function createFetchCompatibleProviderWrapper(
  options: FetchProviderWrapperOptions,
): FetchCompatibleProviderWrapper {
  return {
    provider: options.provider,
    async request(
      input: FetchProviderWrapperRequest,
    ): Promise<FetchProviderWrapperResult> {
      return executeFetchRequest(options, input);
    },
  };
}

async function executeFetchRequest(
  options: FetchProviderWrapperOptions,
  input: FetchProviderWrapperRequest,
): Promise<FetchProviderWrapperResult> {
  const method = input.method ?? "POST";
  const capture = input.capture ?? {};
  const redactions: FetchWrapperRedaction[] = [];
  const rawRequest: FetchProviderRequest = {
    method,
    url: input.url,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.headers !== undefined ? { headers: input.headers } : {}),
  };
  const request = captureRequest(rawRequest, capture, redactions);
  const attempts: FetchProviderAttempt[] = [];
  const maxAttempts = Math.max(1, input.retry?.maxAttempts ?? 1);
  const retryStatusCodes = new Set(
    input.retry?.retryStatusCodes ?? defaultRetryStatusCodes,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await options.transport(rawRequest);
      const retryable = retryStatusCodes.has(response.status);
      const capturedResponse = captureResponse(response, capture, redactions);

      attempts.push({
        attempt,
        retryable,
        status: response.status,
      });

      if (isSuccessStatus(response.status)) {
        return createResult({
          attempts,
          id: input.id,
          provider: options.provider,
          redactions,
          request,
          response: capturedResponse,
          status: "succeeded",
        });
      }

      if (retryable && attempt < maxAttempts) {
        continue;
      }

      return createResult({
        attempts,
        error: {
          code: "provider_http_error",
          message: `Provider returned HTTP ${response.status}.`,
          retryable,
        },
        id: input.id,
        provider: options.provider,
        redactions,
        request,
        response: capturedResponse,
        status: "failed",
      });
    } catch (error) {
      const transportError = createTransportError(error);
      const retryable = input.retry?.retryTransportErrors === true;

      attempts.push({
        attempt,
        error: transportError,
        retryable,
      });

      if (retryable && attempt < maxAttempts) {
        continue;
      }

      return createResult({
        attempts,
        error: transportError,
        id: input.id,
        provider: options.provider,
        redactions,
        request,
        status: "failed",
      });
    }
  }

  return createResult({
    attempts,
    error: {
      code: "provider_http_error",
      message: "Provider request failed.",
      retryable: false,
    },
    id: input.id,
    provider: options.provider,
    redactions,
    request,
    status: "failed",
  });
}

function captureRequest(
  request: FetchProviderRequest,
  capture: FetchCapturePolicy,
  redactions: FetchWrapperRedaction[],
): CapturedFetchRequest {
  const headers = captureHeaders(
    request.headers,
    "$.request.headers",
    redactions,
  );
  const body = captureBody({
    body: request.body,
    mode: capture.requestBody ?? "omitted",
    path: "$.request.body",
    redactions,
  });

  return {
    body,
    headers,
    method: request.method,
    url: request.url,
  };
}

function captureResponse(
  response: FetchProviderResponse,
  capture: FetchCapturePolicy,
  redactions: FetchWrapperRedaction[],
): CapturedFetchResponse {
  return {
    body: captureBody({
      body: response.body,
      mode: capture.responseBody ?? "omitted",
      path: "$.response.body",
      redactions,
    }),
    headers: captureHeaders(response.headers, "$.response.headers", redactions),
    status: response.status,
  };
}

function captureHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  path: string,
  redactions: FetchWrapperRedaction[],
): readonly CapturedFetchHeader[] {
  if (headers === undefined) {
    return [];
  }

  return Object.entries(headers)
    .map(([name, value]) => {
      const normalizedName = name.toLowerCase();

      if (sensitiveHeaders.has(normalizedName)) {
        redactions.push({
          mode: "redacted",
          path: `${path}.${normalizedName}`,
          reason: "Sensitive provider header value was redacted.",
        });

        return {
          name: normalizedName,
          valueMode: "redacted",
        } satisfies CapturedFetchHeader;
      }

      return {
        name: normalizedName,
        value,
        valueMode: "captured",
      } satisfies CapturedFetchHeader;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function captureBody(input: {
  readonly body: string | undefined;
  readonly mode: FetchBodyCaptureMode;
  readonly path: string;
  readonly redactions: FetchWrapperRedaction[];
}): CapturedFetchBody {
  if (input.body === undefined) {
    return {
      mode: "omitted",
    };
  }

  if (input.mode === "metadata_only") {
    input.redactions.push({
      mode: "omitted",
      path: input.path,
      reason: "Body content was omitted while retaining metadata.",
    });

    return {
      length: input.body.length,
      mode: "metadata_only",
    };
  }

  if (input.mode === "redacted") {
    input.redactions.push({
      mode: "redacted",
      path: input.path,
      reason: "Body content was redacted by capture policy.",
    });

    return {
      length: input.body.length,
      mode: "redacted",
    };
  }

  input.redactions.push({
    mode: "omitted",
    path: input.path,
    reason: "Body content was omitted by capture policy.",
  });

  return {
    mode: "omitted",
  };
}

function createResult(input: {
  readonly attempts: readonly FetchProviderAttempt[];
  readonly error?: ProviderExecutionError;
  readonly id: string;
  readonly provider: string;
  readonly redactions: readonly FetchWrapperRedaction[];
  readonly request: CapturedFetchRequest;
  readonly response?: CapturedFetchResponse;
  readonly status: FetchProviderWrapperResult["status"];
}): FetchProviderWrapperResult {
  return {
    attempts: input.attempts,
    evidence: {
      providerAssumptions: [
        {
          capability: "tool_calling",
          description:
            "Injected fetch-compatible transport owns network execution.",
        },
      ],
      redactions: input.redactions,
      warnings: [],
    },
    id: input.id,
    provider: input.provider,
    request: input.request,
    status: input.status,
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.response !== undefined ? { response: input.response } : {}),
  };
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function createTransportError(error: unknown): ProviderExecutionError {
  return {
    code: "transport_error",
    message: error instanceof Error ? error.message : "Transport failed.",
    retryable: false,
  };
}
