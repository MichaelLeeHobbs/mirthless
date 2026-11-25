import type { ConnectorMessage } from './base.js';
import { decodeAnswer, type AnswerHeaders } from './encoding.js';
import type { ConnectorLogger } from './logger.js';

export interface HttpAnswer extends AnswerHeaders {
  readonly status: number;
  readonly bytes: Uint8Array;
}

/** The text of an answer to a message, which is delivered or refused whatever its answer reads like. */
export function answerText(answer: HttpAnswer, message: ConnectorMessage, logger: ConnectorLogger): string {
  const { status, contentType, bytes } = answer;
  const { text, problem } = decodeAnswer(bytes, answer);
  if (problem !== null) {
    const { channelId, messageId, metaDataId } = message;
    logger.warn(
      { channelId, messageId, metaDataId, status, contentType, problem },
      'The answer to a message could not be read as it was sent; bytes that could not be read are stored as U+FFFD',
    );
  }
  return text;
}
