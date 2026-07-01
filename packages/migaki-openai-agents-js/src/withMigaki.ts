import { serializeStableJson } from "./hash.js";
import {
  modelCallEndFromOpenAISpan,
  modelCallStartFromOpenAISpan,
  usageSnapshot,
  type OpenAIAgentsSpan,
} from "./openaiSpan.js";
import { MigakiRecorder, snapshotError } from "./recorder.js";
import { LocalMigakiStore } from "./store.js";
import {
  MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION,
  OPENAI_AGENTS_SDK_VERSION,
  type MigakiClock,
  type MigakiStore,
} from "./types.js";

export interface WithMigakiOptions {
  readonly cache?: MigakiStore | undefined;
  readonly clock?: MigakiClock | undefined;
  readonly instrumentationVersion?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly runConfig?: Readonly<Record<string, unknown>> | undefined;
  readonly runId: string;
  readonly sdkPackageVersion?: string | undefined;
  readonly store?: MigakiStore | undefined;
}

export class MigakiAgentsRunner {
  readonly #clock: MigakiClock | undefined;
  readonly #instrumentationVersion: string;
  readonly #metadata: Readonly<Record<string, unknown>>;
  readonly #runConfig: Readonly<Record<string, unknown>>;
  readonly #runId: string;
  readonly #sdkPackageVersion: string;
  readonly #store: MigakiStore;

  constructor(options: WithMigakiOptions) {
    this.#clock = options.clock;
    this.#instrumentationVersion =
      options.instrumentationVersion ??
      MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION;
    this.#metadata = options.metadata ?? {};
    this.#runConfig = options.runConfig ?? {};
    this.#runId = options.runId;
    this.#sdkPackageVersion =
      options.sdkPackageVersion ?? OPENAI_AGENTS_SDK_VERSION;
    this.#store = options.store ?? options.cache ?? new LocalMigakiStore();
  }

  async run<TResult = unknown>(
    agent: unknown,
    input: unknown,
    options?: unknown,
  ): Promise<TResult> {
    const sdk = await loadOpenAIAgentsSdk();
    installGlobalMigakiTraceProcessor(sdk);

    const recorder = new MigakiRecorder({
      instrumentationVersion: this.#instrumentationVersion,
      metadata: this.#metadata,
      runId: this.#runId,
      sdkPackageVersion: this.#sdkPackageVersion,
      store: this.#store,
      ...(this.#clock !== undefined ? { clock: this.#clock } : {}),
    });
    const runConfig = instrumentModelConfig(this.#runConfig, recorder);
    const runner = new sdk.Runner({
      ...runConfig,
      traceIncludeSensitiveData:
        readBooleanProperty(runConfig, "traceIncludeSensitiveData") ?? true,
      traceMetadata: {
        ...readRecordProperty(runConfig, "traceMetadata"),
        migakiInstrumentationVersion: this.#instrumentationVersion,
        migakiRunId: this.#runId,
      },
      tracingDisabled: false,
    });
    const detachHooks = attachRunnerHooks(runner, recorder);

    activeRecorders.set(this.#runId, recorder);
    recorder.recordRunStarted(input);

    try {
      const result = (await runner.run(agent, input, options)) as TResult;

      await recorder.finalizeRunCompleted(resultSnapshot(result));

      return result;
    } catch (error) {
      await recorder.finalizeRunFailed(error);
      throw error;
    } finally {
      detachHooks();
      forgetRecorderTraceIds(recorder);
      activeRecorders.delete(this.#runId);
    }
  }
}

export function withMigaki(options: WithMigakiOptions): MigakiAgentsRunner {
  return new MigakiAgentsRunner(options);
}

interface OpenAIAgentsSdkModule {
  readonly Runner: OpenAIRunnerConstructor;
  readonly addTraceProcessor: (processor: OpenAITracingProcessor) => void;
}

interface OpenAIRunnerConstructor {
  new (config?: Readonly<Record<string, unknown>>): OpenAIRunner;
}

interface OpenAIRunner {
  off(type: string, listener: (...args: readonly unknown[]) => void): unknown;
  on(type: string, listener: (...args: readonly unknown[]) => void): unknown;
  run(agent: unknown, input: unknown, options?: unknown): Promise<unknown>;
}

interface OpenAITracingProcessor {
  forceFlush(): Promise<void>;
  onSpanEnd(span: OpenAISpan): Promise<void>;
  onSpanStart(span: OpenAISpan): Promise<void>;
  onTraceEnd(trace: OpenAITrace): Promise<void>;
  onTraceStart(trace: OpenAITrace): Promise<void>;
  shutdown(timeout?: number): Promise<void>;
}

type OpenAISpan = OpenAIAgentsSpan;

interface OpenAITrace {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly traceId: string;
}

const openAiAgentsPackageName = "@openai/agents";
const activeRecorders = new Map<string, MigakiRecorder>();
const activeRecordersByTraceId = new Map<string, MigakiRecorder>();
let globalProcessorInstalled = false;

async function loadOpenAIAgentsSdk(): Promise<OpenAIAgentsSdkModule> {
  const loaded = (await import(openAiAgentsPackageName)) as unknown;

  if (!isRecord(loaded)) {
    throw new Error("@openai/agents did not load as an object.");
  }

  const Runner = loaded.Runner;
  const addTraceProcessor = loaded.addTraceProcessor;

  if (typeof Runner !== "function") {
    throw new Error("@openai/agents did not export Runner.");
  }

  if (typeof addTraceProcessor !== "function") {
    throw new Error("@openai/agents did not export addTraceProcessor.");
  }

  return {
    Runner: Runner as OpenAIRunnerConstructor,
    addTraceProcessor:
      addTraceProcessor as OpenAIAgentsSdkModule["addTraceProcessor"],
  };
}

function installGlobalMigakiTraceProcessor(sdk: OpenAIAgentsSdkModule): void {
  if (globalProcessorInstalled) {
    return;
  }

  sdk.addTraceProcessor(globalMigakiTraceProcessor);
  globalProcessorInstalled = true;
}

const globalMigakiTraceProcessor: OpenAITracingProcessor = {
  forceFlush() {
    return Promise.resolve();
  },
  onSpanEnd(span) {
    const recorder = recorderForSpan(span);

    if (recorder !== undefined) {
      recordSpanEnd(recorder, span);
    }

    return Promise.resolve();
  },
  onSpanStart(span) {
    const recorder = recorderForSpan(span);

    if (recorder !== undefined) {
      recordSpanStart(recorder, span);
    }

    return Promise.resolve();
  },
  onTraceEnd(trace) {
    activeRecordersByTraceId.delete(trace.traceId);

    return Promise.resolve();
  },
  onTraceStart(trace) {
    const recorder = recorderForTrace(trace);

    if (recorder !== undefined) {
      activeRecordersByTraceId.set(trace.traceId, recorder);
    }

    return Promise.resolve();
  },
  shutdown() {
    return Promise.resolve();
  },
};

function recorderForTrace(trace: OpenAITrace): MigakiRecorder | undefined {
  const runId = readStringProperty(trace.metadata, "migakiRunId");

  return runId === undefined ? undefined : activeRecorders.get(runId);
}

function recorderForSpan(span: OpenAISpan): MigakiRecorder | undefined {
  const runId = span.traceMetadata?.migakiRunId;

  if (typeof runId === "string") {
    return activeRecorders.get(runId);
  }

  return activeRecordersByTraceId.get(span.traceId);
}

function forgetRecorderTraceIds(recorder: MigakiRecorder): void {
  for (const [traceId, activeRecorder] of activeRecordersByTraceId) {
    if (activeRecorder === recorder) {
      activeRecordersByTraceId.delete(traceId);
    }
  }
}

function recordSpanStart(recorder: MigakiRecorder, span: OpenAISpan): void {
  const data = span.spanData;
  const spanType = readStringProperty(data, "type");

  if (spanType === "agent") {
    const agentName = readStringProperty(data, "name") ?? "unknown-agent";

    recorder.recordAgentSpanStarted({
      agentName,
      input: {
        handoffs: data.handoffs ?? [],
        outputType: data.output_type ?? null,
        tools: data.tools ?? [],
      },
      metadata: spanMetadata(span),
      spanId: span.spanId,
    });
    return;
  }

  const modelCall = modelCallStartFromOpenAISpan(span);
  if (modelCall !== undefined) {
    recorder.recordModelCallStarted({
      ...modelCall,
      metadata: spanMetadata(span),
    });
    return;
  }

  if (spanType === "handoff") {
    const fromAgent = readStringProperty(data, "from_agent");
    const toAgent = readStringProperty(data, "to_agent");

    recorder.recordHandoffStarted({
      input: {
        fromAgent: fromAgent ?? null,
        toAgent: toAgent ?? null,
      },
      metadata: spanMetadata(span),
      parentSpanId: span.parentId,
      spanId: span.spanId,
      ...(fromAgent !== undefined ? { fromAgent } : {}),
      ...(toAgent !== undefined ? { toAgent } : {}),
    });
  }
}

function recordSpanEnd(recorder: MigakiRecorder, span: OpenAISpan): void {
  const data = span.spanData;
  const spanType = readStringProperty(data, "type");

  if (spanType === "agent") {
    recorder.completeSpan(span.spanId, data, spanError(span));
    return;
  }

  const modelCall = modelCallEndFromOpenAISpan(span);
  if (modelCall !== undefined) {
    recorder.completeModelCallBySpan({
      ...modelCall,
      metadata: spanMetadata(span),
      ...(spanError(span) !== undefined ? { error: spanError(span) } : {}),
    });
    return;
  }

  if (spanType === "handoff") {
    const fromAgent = readStringProperty(data, "from_agent");
    const toAgent = readStringProperty(data, "to_agent");

    recorder.completeHandoffBySpan({
      output: data,
      spanId: span.spanId,
      ...(spanError(span) !== undefined ? { error: spanError(span) } : {}),
      ...(fromAgent !== undefined ? { fromAgent } : {}),
      ...(toAgent !== undefined ? { toAgent } : {}),
    });
  }
}

function attachRunnerHooks(
  runner: OpenAIRunner,
  recorder: MigakiRecorder,
): () => void {
  const onAgentStart = (...args: readonly unknown[]) => {
    const agent = args[1];
    const turnInput = args[2];
    const agentName = readStringProperty(agent, "name") ?? "unknown-agent";

    recorder.recordAgentStarted({
      agentName,
      input: turnInput ?? null,
      metadata: {
        outputSchemaName: readStringProperty(agent, "outputSchemaName") ?? null,
      },
    });
  };
  const onAgentEnd = (...args: readonly unknown[]) => {
    const agent = args[1];
    const output = args[2];
    const agentName = readStringProperty(agent, "name") ?? "unknown-agent";

    recorder.completeAgentByName(agentName, output);
  };
  const onToolStart = (...args: readonly unknown[]) => {
    const tool = args[2];
    const details = args[3];

    recorder.recordToolCallStarted({
      args: parseMaybeJson(extractToolCallArguments(details)),
      toolName: readStringProperty(tool, "name") ?? "unknown-tool",
      ...(readStringProperty(tool, "version") !== undefined
        ? { toolVersion: readStringProperty(tool, "version") }
        : {}),
    });
  };
  const onToolEnd = (...args: readonly unknown[]) => {
    const tool = args[2];
    const result = args[3];
    const details = args[4];
    const toolVersion = readStringProperty(tool, "version");

    recorder.completeToolCall({
      args: parseMaybeJson(extractToolCallArguments(details)),
      output: result,
      toolName: readStringProperty(tool, "name") ?? "unknown-tool",
      ...(toolVersion !== undefined ? { toolVersion } : {}),
    });
  };

  runner.on("agent_start", onAgentStart);
  runner.on("agent_end", onAgentEnd);
  runner.on("agent_tool_start", onToolStart);
  runner.on("agent_tool_end", onToolEnd);

  return () => {
    runner.off("agent_start", onAgentStart);
    runner.off("agent_end", onAgentEnd);
    runner.off("agent_tool_start", onToolStart);
    runner.off("agent_tool_end", onToolEnd);
  };
}

function instrumentModelConfig(
  runConfig: Readonly<Record<string, unknown>>,
  recorder: MigakiRecorder,
): Readonly<Record<string, unknown>> {
  const model = runConfig.model;
  const modelProvider = runConfig.modelProvider;

  return {
    ...runConfig,
    ...(isModelLike(model)
      ? { model: instrumentModel(model, recorder, "configured-model") }
      : {}),
    ...(isModelProviderLike(modelProvider)
      ? { modelProvider: instrumentModelProvider(modelProvider, recorder) }
      : {}),
  };
}

function instrumentModelProvider(
  modelProvider: Readonly<Record<string, unknown>>,
  recorder: MigakiRecorder,
): Readonly<Record<string, unknown>> {
  const getModel = modelProvider.getModel;

  if (typeof getModel !== "function") {
    return modelProvider;
  }

  return {
    getModel: async (...args: readonly unknown[]) => {
      const model = await Reflect.apply(getModel, modelProvider, [...args]);
      const requestedName =
        typeof args[0] === "string" ? args[0] : "provider-model";

      return isModelLike(model)
        ? instrumentModel(model, recorder, requestedName)
        : model;
    },
  };
}

function instrumentModel(
  model: Readonly<Record<string, unknown>>,
  recorder: MigakiRecorder,
  fallbackModelName: string,
): Readonly<Record<string, unknown>> {
  const getResponse = model.getResponse;
  const getStreamedResponse = model.getStreamedResponse;
  const getRetryAdvice = model.getRetryAdvice;
  let modelCallCounter = 0;

  return {
    getResponse: async (request: unknown) => {
      if (typeof getResponse !== "function") {
        throw new Error("Instrumented model is missing getResponse.");
      }

      const spanId = `migaki-model-wrapper-${++modelCallCounter}`;
      const modelName = modelNameForRequest(model, fallbackModelName);

      recorder.recordModelCallStarted({
        input: modelRequestInput(request),
        metadata: { source: "migaki-model-wrapper" },
        modelName,
        modelParams: readRecordProperty(request, "modelSettings"),
        outputSchema: readUnknownProperty(request, "outputType"),
        spanId,
      });

      try {
        const response = await Reflect.apply(getResponse, model, [request]);

        recorder.completeModelCallBySpan({
          input: modelRequestInput(request),
          metadata: { source: "migaki-model-wrapper" },
          modelName,
          modelParams: readRecordProperty(request, "modelSettings"),
          output: modelResponseOutput(response),
          outputSchema: readUnknownProperty(request, "outputType"),
          spanId,
          ...(usageSnapshot(readRecordProperty(response, "usage")) !== undefined
            ? { usage: usageSnapshot(readRecordProperty(response, "usage")) }
            : {}),
        });

        return response;
      } catch (error) {
        recorder.completeModelCallBySpan({
          error,
          input: modelRequestInput(request),
          metadata: { source: "migaki-model-wrapper" },
          modelName,
          modelParams: readRecordProperty(request, "modelSettings"),
          outputSchema: readUnknownProperty(request, "outputType"),
          spanId,
        });
        throw error;
      }
    },
    ...(typeof getRetryAdvice === "function"
      ? {
          getRetryAdvice: (...args: readonly unknown[]) =>
            Reflect.apply(getRetryAdvice, model, [...args]),
        }
      : {}),
    ...(typeof getStreamedResponse === "function"
      ? {
          getStreamedResponse: (request: unknown) =>
            Reflect.apply(getStreamedResponse, model, [request]),
        }
      : {}),
  };
}

function spanMetadata(span: OpenAISpan): Readonly<Record<string, unknown>> {
  const error = spanError(span);

  return {
    openaiParentSpanId: span.parentId ?? null,
    openaiSpanId: span.spanId,
    openaiTraceId: span.traceId,
    source: "openai-agents-js-tracing",
    ...(error !== undefined ? { error: snapshotError(error) } : {}),
  };
}

function spanError(span: OpenAISpan): unknown | undefined {
  return span.error === null ? undefined : span.error;
}

function extractToolCallArguments(details: unknown): string | undefined {
  const toolCall = readRecordProperty(details, "toolCall");

  return readStringProperty(toolCall, "arguments");
}

function parseMaybeJson(value: string | undefined): unknown {
  if (value === undefined || value.trim() === "") {
    return value ?? null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resultSnapshot(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }

  return {
    finalOutput:
      "finalOutput" in result ? result.finalOutput : (result.output ?? null),
    state: "state" in result ? "present" : "absent",
  };
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

function readBooleanProperty(
  value: unknown,
  property: string,
): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const child = value[property];

  return typeof child === "boolean" ? child : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

function isModelLike(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return isRecord(value) && typeof value.getResponse === "function";
}

function isModelProviderLike(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return isRecord(value) && typeof value.getModel === "function";
}

function modelNameForRequest(
  model: Readonly<Record<string, unknown>>,
  fallbackModelName: string,
): string {
  return (
    readStringProperty(model, "model") ??
    readStringProperty(model, "name") ??
    fallbackModelName
  );
}

function modelRequestInput(request: unknown): unknown {
  return {
    handoffs: readUnknownProperty(request, "handoffs") ?? [],
    input: readUnknownProperty(request, "input") ?? null,
    prompt: readUnknownProperty(request, "prompt") ?? null,
    systemInstructions:
      readUnknownProperty(request, "systemInstructions") ?? null,
    tools: readUnknownProperty(request, "tools") ?? [],
  };
}

function modelResponseOutput(response: unknown): unknown {
  return isRecord(response) ? (response.output ?? null) : response;
}

export function describeRunInput(input: unknown): string {
  return serializeStableJson(input);
}
