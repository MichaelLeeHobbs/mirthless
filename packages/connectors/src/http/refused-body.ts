/** The message goes to the sender and to the log, so it holds nothing of the body. */
export class RefusedBodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 501 | 503,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

export function tooLarge(): RefusedBodyError {
  return new RefusedBodyError(413, 'Payload Too Large');
}
