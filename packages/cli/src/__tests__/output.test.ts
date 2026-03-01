// ===========================================
// Output Formatters Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { formatTable, formatJson, printError, printSuccess } from '../lib/output.js';

describe('formatTable', () => {
  it('formats headers and rows with padding', () => {
    const result = formatTable(
      ['Name', 'Age'],
      [['Alice', '30'], ['Bob', '25']],
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('Name   Age');
    expect(lines[1]).toBe('-----  ---');
    expect(lines[2]).toBe('Alice  30 ');
    expect(lines[3]).toBe('Bob    25 ');
  });

  it('handles empty rows', () => {
    const result = formatTable(['Col1', 'Col2'], []);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Col1  Col2');
    expect(lines[1]).toBe('----  ----');
  });

  it('uses data width when wider than header', () => {
    const result = formatTable(
      ['ID'],
      [['long-identifier-value']],
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('ID                   ');
    expect(lines[2]).toBe('long-identifier-value');
  });

  it('handles missing cells gracefully', () => {
    const result = formatTable(
      ['A', 'B', 'C'],
      [['1', '2']],  // missing third cell
    );
    const lines = result.split('\n');
    expect(lines[2]).toContain('1');
    expect(lines[2]).toContain('2');
  });

  it('handles single column', () => {
    const result = formatTable(['Status'], [['OK'], ['FAIL']]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Status');
    expect(lines[1]).toBe('------');
    expect(lines[2]).toBe('OK    ');
    expect(lines[3]).toBe('FAIL  ');
  });
});

describe('formatJson', () => {
  it('pretty-prints objects with 2-space indent', () => {
    const result = formatJson({ name: 'test', value: 42 });
    expect(result).toBe('{\n  "name": "test",\n  "value": 42\n}');
  });

  it('formats arrays', () => {
    const result = formatJson([1, 2, 3]);
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('handles null', () => {
    expect(formatJson(null)).toBe('null');
  });

  it('handles strings', () => {
    expect(formatJson('hello')).toBe('"hello"');
  });
});

describe('printError', () => {
  it('writes error message to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    printError('something went wrong');
    expect(spy).toHaveBeenCalledWith('Error: something went wrong\n');
    spy.mockRestore();
  });
});

describe('printSuccess', () => {
  it('writes success message to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    printSuccess('all good');
    expect(spy).toHaveBeenCalledWith('all good\n');
    spy.mockRestore();
  });
});
