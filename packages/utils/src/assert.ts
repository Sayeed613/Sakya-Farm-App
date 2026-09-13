/**
 * Exhaustiveness helper.
 *
 * Use in a `default:` branch over a union so that adding a new status or enum
 * member becomes a compile error instead of a silent fallthrough.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
