/**
 * Unit tests for OpenRouterModelSync.
 * These use an injected fetch implementation so no real network calls are made.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const OpenRouterModelSync = require('../../src/openrouter-model-sync');

function tempCachePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orcache-')), 'openrouter-cache.json');
}

const sampleModels = [
  {
    id: 'openai/gpt-4',
    canonical_slug: 'openai/gpt-4',
    name: 'GPT-4',
    created: 1692901234,
    context_length: 8192,
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
      tokenizer: 'GPT'
    },
    pricing: { prompt: '0.00003', completion: '0.00006' },
    supported_parameters: ['temperature', 'top_p', 'max_tokens']
  },
  {
    id: 'openai/gpt-4o',
    canonical_slug: 'openai/gpt-4o',
    name: 'GPT-4o',
    created: 1700000000,
    context_length: 128000,
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    },
    pricing: { prompt: '0.0000025', completion: '0.00001' },
    supported_parameters: ['temperature']
  },
  {
    id: 'mistralai/mistral-large',
    canonical_slug: 'mistralai/mistral-large',
    name: 'Mistral Large',
    created: 1710000000,
    context_length: 32768,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000002', completion: '0.000006' }
  }
];

function makeFetch(payload, { ok = true, status = 200 } = {}) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload
  });
}

describe('OpenRouterModelSync', () => {
  describe('mapAuthorToProvider', () => {
    const sync = new OpenRouterModelSync();

    test('maps known authors to gateway provider slugs', () => {
      expect(sync.mapAuthorToProvider('openai/gpt-4')).toBe('openai');
      expect(sync.mapAuthorToProvider('mistralai/mistral-large')).toBe('mistral');
      expect(sync.mapAuthorToProvider('meta-llama/llama-3.1-70b')).toBe('meta');
      expect(sync.mapAuthorToProvider('x-ai/grok-2')).toBe('xai');
    });

    test('maps unknown authors by identity (lowercased)', () => {
      expect(sync.mapAuthorToProvider('Foobar/some-model')).toBe('foobar');
      expect(sync.mapAuthorToProvider('deepseek')).toBe('deepseek');
    });

    test('handles invalid input gracefully', () => {
      expect(sync.mapAuthorToProvider(null)).toBe('unknown');
      expect(sync.mapAuthorToProvider(123)).toBe('unknown');
    });
  });

  describe('computeCostPer1kTokens', () => {
    const sync = new OpenRouterModelSync();

    test('converts per-token prompt price to per-1k tokens', () => {
      expect(sync.computeCostPer1kTokens({ prompt: '0.00003' })).toBe(0.03);
      expect(sync.computeCostPer1kTokens({ prompt: '0.0000025' })).toBeCloseTo(0.0025, 6);
    });

    test('returns 0 for missing or invalid pricing', () => {
      expect(sync.computeCostPer1kTokens(null)).toBe(0);
      expect(sync.computeCostPer1kTokens({})).toBe(0);
      expect(sync.computeCostPer1kTokens({ prompt: 'n/a' })).toBe(0);
    });
  });

  describe('deriveCapabilities', () => {
    const sync = new OpenRouterModelSync();

    test('flags vision when image is an input modality', () => {
      const caps = sync.deriveCapabilities({ input_modalities: ['text', 'image'], output_modalities: ['text'] });
      expect(caps.vision).toBe(true);
      expect(caps.chat).toBe(true);
    });

    test('defaults vision/audio/video to false for text-only', () => {
      const caps = sync.deriveCapabilities({ input_modalities: ['text'], output_modalities: ['text'] });
      expect(caps.vision).toBe(false);
      expect(caps.audio).toBe(false);
      expect(caps.video).toBe(false);
    });

    test('handles missing architecture', () => {
      const caps = sync.deriveCapabilities(undefined);
      expect(caps.chat).toBe(true);
      expect(caps.vision).toBe(false);
    });
  });

  describe('normalizeModel', () => {
    const sync = new OpenRouterModelSync();

    test('normalizes a valid model', () => {
      const model = sync.normalizeModel(sampleModels[0]);
      expect(model).toMatchObject({
        id: 'openai/gpt-4',
        provider: 'openai',
        short_slug: 'gpt-4',
        context_length: 8192,
        cost_per_1k_tokens: 0.03
      });
      expect(model.capabilities.vision).toBe(false);
      expect(model.pricing.completion).toBe('0.00006');
    });

    test('strips variant suffix from short slug', () => {
      const model = sync.normalizeModel({ id: 'openai/gpt-4:free', pricing: {}, architecture: {} });
      expect(model.short_slug).toBe('gpt-4');
    });

    test('returns null for invalid models', () => {
      expect(sync.normalizeModel(null)).toBeNull();
      expect(sync.normalizeModel({})).toBeNull();
      expect(sync.normalizeModel({ id: 42 })).toBeNull();
    });
  });

  describe('groupByProvider', () => {
    const sync = new OpenRouterModelSync();

    test('groups models by provider and aggregates capabilities/cost', () => {
      const normalized = sampleModels.map(m => sync.normalizeModel(m));
      const grouped = sync.groupByProvider(normalized);

      expect(Object.keys(grouped).sort()).toEqual(['mistral', 'openai']);
      expect(grouped.openai.models).toEqual(['openai/gpt-4', 'openai/gpt-4o']);
      // openai group has a vision model (gpt-4o) -> vision capability true
      expect(grouped.openai.capabilities.vision).toBe(true);
      // average of 0.03 and 0.0025
      expect(grouped.openai.cost_per_1k_tokens).toBeCloseTo(0.01625, 5);
      expect(grouped.mistral.models).toEqual(['mistralai/mistral-large']);
      expect(grouped.mistral.capabilities.vision).toBe(false);
    });

    test('does not duplicate model ids', () => {
      const normalized = [sync.normalizeModel(sampleModels[0]), sync.normalizeModel(sampleModels[0])];
      const grouped = sync.groupByProvider(normalized);
      expect(grouped.openai.models).toEqual(['openai/gpt-4']);
    });
  });

  describe('fetchAllModels', () => {
    test('returns data array on success', async () => {
      const fetchImpl = makeFetch({ data: sampleModels });
      const sync = new OpenRouterModelSync({ fetchImpl });
      const data = await sync.fetchAllModels();
      expect(data).toHaveLength(3);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('throws on non-ok response', async () => {
      const fetchImpl = makeFetch({}, { ok: false, status: 500 });
      const sync = new OpenRouterModelSync({ fetchImpl });
      await expect(sync.fetchAllModels()).rejects.toThrow(/status 500/);
    });

    test('throws when payload has no data array', async () => {
      const fetchImpl = makeFetch({ notData: true });
      const sync = new OpenRouterModelSync({ fetchImpl });
      await expect(sync.fetchAllModels()).rejects.toThrow(/missing "data"/);
    });

    test('respects a custom apiBaseUrl', async () => {
      const fetchImpl = makeFetch({ data: [] });
      const sync = new OpenRouterModelSync({ fetchImpl, apiBaseUrl: 'https://example.test/v9' });
      await sync.fetchAllModels();
      expect(fetchImpl).toHaveBeenCalledWith('https://example.test/v9/models', expect.any(Object));
    });
  });

  describe('buildProviderCatalog', () => {
    test('produces a normalized, grouped catalog and writes cache', async () => {
      const fetchImpl = makeFetch({ data: sampleModels });
      const cachePath = tempCachePath();
      const sync = new OpenRouterModelSync({ fetchImpl, cachePath });
      const catalog = await sync.buildProviderCatalog();

      expect(catalog.source).toBe('openrouter');
      expect(catalog.total_models).toBe(3);
      expect(catalog.from_cache).toBe(false);
      expect(Object.keys(catalog.providers).sort()).toEqual(['mistral', 'openai']);
      expect(catalog.models).toHaveLength(3);
      // Cache file was written
      expect(fs.existsSync(cachePath)).toBe(true);
    });

    test('propagates fetch errors when no cache is available', async () => {
      const fetchImpl = makeFetch({}, { ok: false, status: 404 });
      const sync = new OpenRouterModelSync({ fetchImpl, cachePath: tempCachePath(), backoffMs: 0 });
      await expect(sync.buildProviderCatalog()).rejects.toThrow();
    });
  });

  describe('disk cache and failure backoff', () => {
    test('falls back to cached catalog when fetch fails', async () => {
      const cachePath = tempCachePath();
      // First: successful fetch populates the cache.
      const okSync = new OpenRouterModelSync({ fetchImpl: makeFetch({ data: sampleModels }), cachePath });
      await okSync.buildProviderCatalog();

      // Second: a new instance whose fetch fails should serve the cached data.
      const failSync = new OpenRouterModelSync({
        fetchImpl: makeFetch({}, { ok: false, status: 500 }),
        cachePath,
        backoffMs: 0
      });
      const catalog = await failSync.buildProviderCatalog();
      expect(catalog.from_cache).toBe(true);
      expect(catalog.stale).toBe(true);
      expect(catalog.total_models).toBe(3);
    });

    test('honors the backoff window and avoids re-fetching after a failure', async () => {
      const cachePath = tempCachePath();
      // Seed the cache with a good fetch.
      await new OpenRouterModelSync({ fetchImpl: makeFetch({ data: sampleModels }), cachePath }).buildProviderCatalog();

      let now = 1000;
      const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
      const sync = new OpenRouterModelSync({ fetchImpl, cachePath, backoffMs: 60000, now: () => now });

      // First call fails -> records failure, serves cache.
      const first = await sync.buildProviderCatalog();
      expect(first.from_cache).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Within backoff window: should NOT call fetch again, serves cache.
      now += 1000;
      const second = await sync.buildProviderCatalog();
      expect(second.from_cache).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // After backoff window: retries the network.
      now += 60000;
      await sync.buildProviderCatalog().catch(() => {});
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
