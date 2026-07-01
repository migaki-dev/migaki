import type { MigakiUsageSnapshot } from "./types.js";

export interface OpenAIAgentsSpan {
  readonly error?: unknown;
  readonly parentId?: string | null;
  readonly spanData: Readonly<Record<string, unknown>>;
  readonly spanId: string;
  readonly traceId: string;
  readonly traceMetadata?: Readonly<Record<string, unknown>>;
}

export interface OpenAIModelCallSpanStart {
  readonly input: unknown;
  readonly modelName: string;
  readonly modelParams?: unknown;
  readonly parentSpanId?: string | null;
  readonly spanId: string;
}

export interface OpenAIModelCallSpanEnd extends OpenAIModelCallSpanStart {
  readonly output: unknown;
  readonly usage?: MigakiUsageSnapshot;
}

export function modelCallStartFromOpenAISpan(
  span: OpenAIAgentsSpan,
): OpenAIModelCallSpanStart | undefined {
  const data = span.spanData;
  const spanType = readStringProperty(data, "type");

  if (spanType === "generation") {
    return {
      input: data.input ?? null,
      modelName: readStringProperty(data, "model") ?? "unknown-model",
      modelParams: data.model_config ?? null,
      spanId: span.spanId,
      ...(span.parentId !== undefined ? { parentSpanId: span.parentId } : {}),
    };
  }

  if (spanType === "response") {
    return {
      input: responseSpanInput(data),
      modelName: responseSpanModelName(data),
      spanId: span.spanId,
      ...(span.parentId !== undefined ? { parentSpanId: span.parentId } : {}),
    };
  }

  return undefined;
}

export function modelCallEndFromOpenAISpan(
  span: OpenAIAgentsSpan,
): OpenAIModelCallSpanEnd | undefined {
  const data = span.spanData;
  const spanType = readStringProperty(data, "type");

  if (spanType === "generation") {
    const usage = usageSnapshot(readRecordProperty(data, "usage"));

    return {
      input: data.input ?? null,
      modelName: readStringProperty(data, "model") ?? "unknown-model",
      modelParams: data.model_config ?? null,
      output: data.output ?? null,
      spanId: span.spanId,
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  if (spanType === "response") {
    const response = readRecordProperty(data, "_response");
    const usage = usageSnapshot(readRecordProperty(response, "usage"));

    return {
      input: responseSpanInput(data),
      modelName: responseSpanModelName(data),
      output: responseSpanOutput(data),
      spanId: span.spanId,
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  return undefined;
}

export function usageSnapshot(
  usage: Readonly<Record<string, unknown>>,
): MigakiUsageSnapshot | undefined {
  const inputTokens =
    readNumberProperty(usage, "input_tokens") ??
    readNumberProperty(usage, "inputTokens");
  const outputTokens =
    readNumberProperty(usage, "output_tokens") ??
    readNumberProperty(usage, "outputTokens");
  const totalTokens =
    readNumberProperty(usage, "total_tokens") ??
    readNumberProperty(usage, "totalTokens") ??
    (inputTokens === undefined || outputTokens === undefined
      ? undefined
      : inputTokens + outputTokens);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function responseSpanInput(data: Readonly<Record<string, unknown>>): unknown {
  return readUnknownProperty(data, "_input") ?? null;
}

function responseSpanModelName(
  data: Readonly<Record<string, unknown>>,
): string {
  const response = readRecordProperty(data, "_response");

  return (
    readStringProperty(response, "model") ??
    readStringProperty(data, "model") ??
    "openai-response"
  );
}

function responseSpanOutput(data: Readonly<Record<string, unknown>>): unknown {
  const response = readRecordProperty(data, "_response");
  const output = readUnknownProperty(response, "output");

  return output ?? response;
}

function readRecordProperty(
  value: unknown,
  property: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }

  const child = value[property];

  return isRecord(child) ? child : {};
}

function readUnknownProperty(value: unknown, property: string): unknown {
  return isRecord(value) ? value[property] : undefined;
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const child = value[property];

  return typeof child === "string" ? child : undefined;
}

function readNumberProperty(
  value: Readonly<Record<string, unknown>>,
  property: string,
): number | undefined {
  const child = value[property];

  return typeof child === "number" && Number.isFinite(child)
    ? child
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
