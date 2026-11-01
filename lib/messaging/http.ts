// A provider call never hangs a sync or a job: each request gives up after this long and the message is recorded failed.
export const PROVIDER_TIMEOUT_MS = 15_000;

export function providerSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}
