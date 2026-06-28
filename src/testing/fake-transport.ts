export type FakeTransportHeaders = Readonly<Record<string, string>>;

export interface FakeTransportRequest<TBody = unknown> {
  readonly body?: TBody;
  readonly headers?: FakeTransportHeaders;
  readonly method?: string;
  readonly url: string;
}

export interface FakeTransportResponse<TBody = unknown> {
  readonly body?: TBody;
  readonly headers?: FakeTransportHeaders;
  readonly status: number;
}

export interface FakeTransportExchange<
  TRequestBody = unknown,
  TResponseBody = unknown,
> {
  readonly error?: unknown;
  readonly request: FakeTransportRequest<TRequestBody>;
  readonly response?: FakeTransportResponse<TResponseBody>;
}

export type FakeTransportOutcome<TResponseBody = unknown> =
  | Error
  | FakeTransportResponse<TResponseBody>;

export type FakeTransportHandler<
  TRequestBody = unknown,
  TResponseBody = unknown,
> = (
  request: FakeTransportRequest<TRequestBody>,
) =>
  | FakeTransportOutcome<TResponseBody>
  | Promise<FakeTransportOutcome<TResponseBody>>;

export type FakeTransportStep<
  TRequestBody = unknown,
  TResponseBody = unknown,
> =
  | FakeTransportHandler<TRequestBody, TResponseBody>
  | FakeTransportOutcome<TResponseBody>;

export class FakeTransport<TRequestBody = unknown, TResponseBody = unknown> {
  readonly #handlers: FakeTransportHandler<TRequestBody, TResponseBody>[] = [];
  readonly exchanges: FakeTransportExchange<TRequestBody, TResponseBody>[] = [];

  constructor(
    steps: readonly FakeTransportStep<TRequestBody, TResponseBody>[] = [],
  ) {
    for (const step of steps) {
      this.enqueue(step);
    }
  }

  enqueue(step: FakeTransportStep<TRequestBody, TResponseBody>): void {
    this.#handlers.push(toHandler(step));
  }

  enqueueResponse(response: FakeTransportResponse<TResponseBody>): void {
    this.enqueue(response);
  }

  enqueueError(error: Error): void {
    this.enqueue(error);
  }

  async send(
    request: FakeTransportRequest<TRequestBody>,
  ): Promise<FakeTransportResponse<TResponseBody>> {
    const handler = this.#handlers.shift();
    const recordedRequest = copyRequest(request);

    if (handler === undefined) {
      const error = new Error(
        `No fake transport handler queued for ${request.url}.`,
      );
      this.exchanges.push({ error, request: recordedRequest });
      throw error;
    }

    try {
      const outcome = await handler(recordedRequest);

      if (outcome instanceof Error) {
        throw outcome;
      }

      const response = copyResponse(outcome);

      this.exchanges.push({
        request: recordedRequest,
        response,
      });

      return response;
    } catch (error) {
      this.exchanges.push({
        error,
        request: recordedRequest,
      });

      throw error;
    }
  }
}

function toHandler<TRequestBody, TResponseBody>(
  step: FakeTransportStep<TRequestBody, TResponseBody>,
): FakeTransportHandler<TRequestBody, TResponseBody> {
  if (typeof step === "function") {
    return step;
  }

  return () => step;
}

function copyRequest<TBody>(
  request: FakeTransportRequest<TBody>,
): FakeTransportRequest<TBody> {
  const copy: {
    body?: TBody;
    headers?: Record<string, string>;
    method?: string;
    url: string;
  } = { url: request.url };

  if (request.body !== undefined) {
    copy.body = request.body;
  }

  if (request.headers !== undefined) {
    copy.headers = { ...request.headers };
  }

  if (request.method !== undefined) {
    copy.method = request.method;
  }

  return copy;
}

function copyResponse<TBody>(
  response: FakeTransportResponse<TBody>,
): FakeTransportResponse<TBody> {
  const copy: {
    body?: TBody;
    headers?: Record<string, string>;
    status: number;
  } = { status: response.status };

  if (response.body !== undefined) {
    copy.body = response.body;
  }

  if (response.headers !== undefined) {
    copy.headers = { ...response.headers };
  }

  return copy;
}
