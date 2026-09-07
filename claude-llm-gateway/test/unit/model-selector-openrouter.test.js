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

describe('IntelligentModelSelector.applyOpenRouterCapabilities', () => {
  const visionModel = {
    id: 'openai/gpt-4o', canonical_slug: 'openai/gpt-4o', short_slug: 'gpt-4o',
    capabilities: { chat: true, vision: true }, context_length: 128000, cost_per_1k_tokens: 0.0025,
    input_modalities: ['text', 'image']
  };
  const textModel = {
    id: 'deepseek/deepseek-chat', canonical_slug: 'deepseek/deepseek-chat', short_slug: 'deepseek-chat',
    capabilities: { chat: true, vision: false }, context_length: 64000, cost_per_1k_tokens: 0.0002,
    input_modalities: ['text']
  };

  test('registers capabilities keyed by id/canonical/short slug', () => {
    const selector = new IntelligentModelSelector();
    // Each model: id===canonical_slug so the deduped key set is {id, short_slug}
    // => 2 keys per model, 4 total.
    const n = selector.applyOpenRouterCapabilities([visionModel, textModel]);
    expect(n).toBe(4);
  });

  test('scores vision-capable models higher for vision tasks', () => {
    const selector = new IntelligentModelSelector();
    selector.applyOpenRouterCapabilities([visionModel, textModel]);
    const visionScore = selector.calculateModelScore('openai/gpt-4o', 'vision', {});
    const textScore = selector.calculateModelScore('deepseek/deepseek-chat', 'vision', {});
    expect(visionScore).toBeGreaterThan(textScore);
  });

  test('selectBestModel prefers a vision-capable model when requiresVision', () => {
    const selector = new IntelligentModelSelector();
    selector.applyOpenRouterCapabilities([visionModel, textModel]);
    const result = selector.selectBestModel('describe this image', '', ['deepseek/deepseek-chat', 'openai/gpt-4o'], { requiresVision: true });
    expect(result.selectedModel).toBe('openai/gpt-4o');
  });

  test('scoreFromOpenRouter returns 0 for unknown models', () => {
    const selector = new IntelligentModelSelector();
    expect(selector.scoreFromOpenRouter('nope/unknown', 'coding', {})).toBe(0);
  });
});

describe('IntelligentModelSelector reasoning awareness', () => {
  const reasoningModel = {
    id: 'x/reasoner', canonical_slug: 'x/reasoner', short_slug: 'reasoner',
    capabilities: { chat: true }, context_length: 128000, cost_per_1k_tokens: 0.001,
    supported_parameters: ['temperature', 'reasoning', 'include_reasoning']
  };
  const plainModel = {
    id: 'x/chat', canonical_slug: 'x/chat', short_slug: 'chat',
    capabilities: { chat: true }, context_length: 8000, cost_per_1k_tokens: 0.001,
    supported_parameters: ['temperature']
  };

  test('detects reasoning models from supported_parameters', () => {
    const s = new IntelligentModelSelector();
    s.applyOpenRouterCapabilities([reasoningModel, plainModel]);
    expect(s.isReasoningModel('x/reasoner')).toBe(true);
    expect(s.isReasoningModel('x/chat')).toBe(false);
  });

  test('recommendMaxTokens raises the budget for reasoning models', () => {
    const s = new IntelligentModelSelector();
    s.applyOpenRouterCapabilities([reasoningModel, plainModel]);
    expect(s.recommendMaxTokens('x/reasoner', 40)).toBe(1024); // raised to floor
    expect(s.recommendMaxTokens('x/reasoner', 4000)).toBe(4000); // already enough
    expect(s.recommendMaxTokens('x/chat', 40)).toBe(40); // non-reasoning unchanged
    expect(s.recommendMaxTokens('x/reasoner', null)).toBeNull();
  });

  test('reasoning models are preferred for reasoning tasks, deprioritized for chat', () => {
    const s = new IntelligentModelSelector();
    s.applyOpenRouterCapabilities([reasoningModel, plainModel]);
    expect(s.scoreFromOpenRouter('x/reasoner', 'reasoning', {}))
      .toBeGreaterThan(s.scoreFromOpenRouter('x/reasoner', 'conversation', {}));
  });
});
