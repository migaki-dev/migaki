export interface InvariantCase<TInput> {
  readonly input: TInput;
  readonly name: string;
}

export function defineInvariantCases<TInput>(
  cases: readonly InvariantCase<TInput>[],
): readonly InvariantCase<TInput>[] {
  if (cases.length === 0) {
    throw new Error("Invariant tables must include at least one case.");
  }

  const seenNames = new Set<string>();

  for (const testCase of cases) {
    if (testCase.name.trim() === "") {
      throw new Error("Invariant case names must not be empty.");
    }

    if (seenNames.has(testCase.name)) {
      throw new Error(`Duplicate invariant case name: ${testCase.name}`);
    }

    seenNames.add(testCase.name);
  }

  return [...cases];
}
