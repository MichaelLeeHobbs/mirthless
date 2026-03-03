// ===========================================
// Message Generator Service Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { MessageGeneratorService } from '../message-generator.service.js';

describe('MessageGeneratorService.generate', () => {
  it('generates ADT^A01 messages successfully', () => {
    const result = MessageGeneratorService.generate({
      messageType: 'ADT_A01', count: 3, seed: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(3);
    }
  });

  it('generates ORM^O01 messages successfully', () => {
    const result = MessageGeneratorService.generate({
      messageType: 'ORM_O01', count: 1, seed: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(1);
    }
  });

  it('generates ORU^R01 messages successfully', () => {
    const result = MessageGeneratorService.generate({
      messageType: 'ORU_R01', count: 2, seed: 200,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(2);
    }
  });

  it('generates SIU^S12 messages successfully', () => {
    const result = MessageGeneratorService.generate({
      messageType: 'SIU_S12', count: 1, seed: 300,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(1);
    }
  });

  it('defaults count to 1 when not provided', () => {
    const result = MessageGeneratorService.generate({
      messageType: 'ADT_A01',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(1);
    }
  });
});
