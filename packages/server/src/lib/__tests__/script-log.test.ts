import { describe, it, expect, vi, beforeEach } from 'vitest';

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
vi.mock('../logger.js', () => ({ default: log }));

const { MAX_SERVER_LOG_CHARS, serverScriptLog, setScriptLogging } = await import('../script-log.js');

const AT = { channelId: 'ch', messageId: 7, metaDataId: 1, script: 'Destination filter' };
const FIELDS = { component: 'channel-script', ...AT };
const FROM = '[Destination filter, channel ch, message 7]';
const line = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', text: string): Parameters<ReturnType<typeof serverScriptLog>['line']>[0] => ({ level, time: 't', text });

beforeEach(() => { vi.clearAllMocks(); });

describe('what scripts log, in the server log', () => {
  it('is nothing unless it is on', () => {
    setScriptLogging(false);
    const sink = serverScriptLog(AT);
    sink.line(line('ERROR', 'MRN 1'));
    sink.leftOut(3);
    for (const write of Object.values(log)) expect(write).not.toHaveBeenCalled();
  });

  it('is each line at its level, with where it is from, and how many are left out', () => {
    setScriptLogging(true);
    const sink = serverScriptLog(AT);
    sink.line(line('DEBUG', 'a'));
    sink.line(line('INFO', 'b'));
    sink.line(line('WARN', 'c'));
    sink.line(line('ERROR', 'd'));
    sink.leftOut(3);
    expect(log.debug.mock.calls).toEqual([[FIELDS, `${FROM} a`]]);
    expect(log.info.mock.calls).toEqual([[FIELDS, `${FROM} b`]]);
    expect(log.error.mock.calls).toEqual([[FIELDS, `${FROM} d`]]);
    expect(log.warn.mock.calls).toEqual([[FIELDS, `${FROM} c`], [FIELDS, `${FROM} 3 more lines of this script run are left out`]]);
  });

  it('names no message for a script that runs for none', () => {
    setScriptLogging(true);
    serverScriptLog({ channelId: 'ch', script: 'Deploy' }).line(line('INFO', 'up'));
    expect(log.info.mock.calls).toEqual([[{ component: 'channel-script', channelId: 'ch', script: 'Deploy' }, '[Deploy, channel ch] up']]);
  });

  it('is one line each, and the first characters of a long one', () => {
    setScriptLogging(true);
    const sink = serverScriptLog(AT);
    sink.line(line('INFO', 'MSH|^~\\&\rPID\r\nOBX'));
    sink.line(line('INFO', 'x'.repeat(MAX_SERVER_LOG_CHARS)));
    sink.line(line('INFO', 'x'.repeat(MAX_SERVER_LOG_CHARS + 5)));
    expect(log.info.mock.calls.map(([, text]) => String(text).slice(FROM.length + 1))).toEqual([
      'MSH|^~\\&\\rPID\\r\\nOBX', 'x'.repeat(MAX_SERVER_LOG_CHARS), `${'x'.repeat(MAX_SERVER_LOG_CHARS)}... (5 more characters)`,
    ]);
  });

  it('stops for a script that is running when it is turned off', () => {
    setScriptLogging(true);
    const sink = serverScriptLog(AT);
    sink.line(line('INFO', 'before'));
    setScriptLogging(false);
    sink.line(line('INFO', 'after'));
    expect(log.info.mock.calls).toEqual([[FIELDS, `${FROM} before`]]);
  });
});
