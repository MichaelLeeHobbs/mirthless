import type { ConnectorLogger } from '../logger.js';

export interface CapturedLog {
  readonly obj: Readonly<Record<string, unknown>>;
  readonly msg: string;
}

export interface MockLogger {
  readonly logger: ConnectorLogger;
  readonly errors: CapturedLog[];
  readonly warnings: CapturedLog[];
}

export function makeMockLogger(): MockLogger {
  const errors: CapturedLog[] = [];
  const warnings: CapturedLog[] = [];
  return {
    errors,
    warnings,
    logger: {
      error: (obj, msg): void => { errors.push({ obj, msg }); },
      warn: (obj, msg): void => { warnings.push({ obj, msg }); },
      info: (): void => {},
      debug: (): void => {},
    },
  };
}
