/**
 * Unit tests for IntelligentModelSelector.applyOpenRouterPricing.
 */

const IntelligentModelSelector = require('../../src/intelligent-model-selector');

describe('IntelligentModelSelector.applyOpenRouterPricing', () => {
  test('merges OpenRouter per-token pricing into modelPricing (per 1M tokens)', () => {
    const selector = new IntelligentModelSelector();
    const updated = selector.applyOpenRouterPricing([
      {
        id: 'openai/gpt-4',
        canonical_slug: 'openai/gpt-4',
        short_slug: 'gpt-4',
        pricing: { prompt: '0.00003', completion: '0.00006' }
      }
    ]);

    // id and canonical_slug are identical here, so the deduped key set is
    // { 'openai/gpt-4', 'gpt-4' } => 2 keys updated.
    expect(updated).toBe(2);
    expect(selector.modelPricing['openai/gpt-4']).toEqual({ input: 30, output: 60 });
    expect(selector.modelPricing['gpt-4']).toEqual({ input: 30, output: 60 });
  });

  test('ignores invalid entries and handles non-array input', () => {
    const selector = new IntelligentModelSelector();
    expect(selector.applyOpenRouterPricing(null)).toBe(0);
    expect(selector.applyOpenRouterPricing([null, {}, { pricing: { prompt: 'x', completion: 'y' } }])).toBe(0);
  });
});
