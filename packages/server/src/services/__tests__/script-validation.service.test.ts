import { describe, it, expect } from 'vitest';
import { ScriptValidationService } from '../script-validation.service.js';

describe('ScriptValidationService', () => {
  describe('validate', () => {
    it('returns valid for correct JavaScript', async () => {
      const result = await ScriptValidationService.validate(
        'const x = 1;',
        'javascript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('returns valid for correct TypeScript', async () => {
      const result = await ScriptValidationService.validate(
        'const x: number = 1;',
        'typescript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('returns invalid with errors for syntax error', async () => {
      const result = await ScriptValidationService.validate(
        'const x = {',
        'javascript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(false);
      expect(result.value?.errors?.length).toBeGreaterThan(0);
    });

    it('returns valid for empty script', async () => {
      const result = await ScriptValidationService.validate('', 'javascript');
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('returns valid for whitespace-only script', async () => {
      const result = await ScriptValidationService.validate(
        '   \n  ',
        'typescript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('returns invalid for unclosed string', async () => {
      const result = await ScriptValidationService.validate(
        "const s = 'hello",
        'javascript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(false);
    });

    it('returns valid for script with function declarations', async () => {
      const script =
        'function greet(name: string): string { return `Hello ${name}`; }';
      const result = await ScriptValidationService.validate(
        script,
        'typescript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('includes line numbers in error messages', async () => {
      const result = await ScriptValidationService.validate(
        'const x = {\n\n}}}',
        'javascript',
      );
      expect(result.ok).toBe(true);
      if (result.value && !result.value.valid && result.value.errors) {
        const hasLineRef = result.value.errors.some((e) =>
          /Line \d+/.test(e),
        );
        expect(hasLineRef).toBe(true);
      }
    });

    it('returns invalid for unexpected token', async () => {
      const result = await ScriptValidationService.validate(
        'function() {}',
        'javascript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(false);
      expect(result.value?.errors?.length).toBeGreaterThan(0);
    });

    it('returns valid for multi-line valid code', async () => {
      const script = [
        'const arr = [1, 2, 3];',
        'const doubled = arr.map((n) => n * 2);',
        'console.log(doubled);',
      ].join('\n');
      const result = await ScriptValidationService.validate(
        script,
        'javascript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });

    it('returns valid for TypeScript interface', async () => {
      const script = [
        'interface User {',
        '  readonly id: string;',
        '  readonly name: string;',
        '}',
      ].join('\n');
      const result = await ScriptValidationService.validate(
        script,
        'typescript',
      );
      expect(result.ok).toBe(true);
      expect(result.value?.valid).toBe(true);
    });
  });
});
