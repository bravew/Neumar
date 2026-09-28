/** Fail the test when indexed access is missing, instead of widening the value. */
export function defined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}
