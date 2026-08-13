/**
 * Unit tests for DynamicConfigManager's OpenRouter integration.
 * Uses a fake OpenRouterModelSync (no network) and a temp config path.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const DynamicConfigManager = require('../../src/config/dynamic-config-manager');

function makeCatalog() {
  return {
    source: 'openrouter',
    fetched_at: '2026-08-13T00:00:00.000Z',
    total_models: 3,
    providers: {
      openai: {
        models: ['openai/gpt-4', 'openai/gpt-4o'],
        model_details: [{ id: 'openai/gpt-4' }, { id: 'openai/gpt-4o' }],
        cost_per_1k_tokens: 0.02,
        capabilities: { chat: true, completion: true, vision: true, audio: false, video: false, embeddings: false }
      },
      deepseek: {
        models: ['deepseek/deepseek-chat'],
        model_details: [{ id: 'deepseek/deepseek-chat' }],
        cost_per_1k_tokens: 0.0002,
        capabilities: { chat: true, completion: true, vision: false, audio: false, video: false, embeddings: false }
      }
    },
    models: []
  };
}

function tempConfigManager(overrides = {}) {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'providers.json');
  const mgr = new DynamicConfigManager(overrides);
  mgr.configPath = tmpFile;
  return { mgr, tmpFile };
}

describe('DynamicConfigManager OpenRouter integration', () => {
  test('applies OpenRouter catalog to matching providers', async () => {
    const fakeSync = { buildProviderCatalog: jest.fn().mockResolvedValue(makeCatalog()) };
    const { mgr, tmpFile } = tempConfigManager({ openRouterSync: fakeSync });

    const config = await mgr.discoverProviders();

    expect(fakeSync.buildProviderCatalog).toHaveBeenCalledTimes(1);
    // openai should be populated from OpenRouter
    expect(config.openai.model_source).toBe('openrouter');
    expect(config.openai.models).toEqual(['openai/gpt-4', 'openai/gpt-4o']);
    expect(config.openai.cost_per_1k_tokens).toBe(0.02);
    expect(config.openai.capabilities.vision).toBe(true);
    expect(config.openai.openrouter_synced_at).toBe('2026-08-13T00:00:00.000Z');
    // deepseek too
    expect(config.deepseek.model_source).toBe('openrouter');
    expect(config.deepseek.models).toEqual(['deepseek/deepseek-chat']);

    // A provider not present in the catalog keeps static defaults
    expect(config.cohere.model_source).toBe('static');
    expect(config.cohere.models.length).toBeGreaterThan(0);

    // Envelope records the source
    const written = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(written.model_source).toBe('openrouter');
    expect(written.openrouter_total_models).toBe(3);

    expect(mgr.getLastSyncInfo().ok).toBe(true);
  });

  test('falls back to static config when OpenRouter fetch fails', async () => {
    const fakeSync = { buildProviderCatalog: jest.fn().mockRejectedValue(new Error('network down')) };
    const { mgr, tmpFile } = tempConfigManager({ openRouterSync: fakeSync });

    const config = await mgr.discoverProviders();

    // No throw; providers still discovered from static defaults
    expect(config.openai.model_source).toBe('static');
    expect(config.openai.models.length).toBeGreaterThan(0);

    const written = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(written.model_source).toBe('static');

    const sync = mgr.getLastSyncInfo();
    expect(sync.ok).toBe(false);
    expect(sync.error).toMatch(/network down/);
  });

  test('does not call OpenRouter when sync is disabled', async () => {
    const fakeSync = { buildProviderCatalog: jest.fn() };
    const { mgr } = tempConfigManager({ openRouterSync: fakeSync, openRouterSyncEnabled: false });

    const config = await mgr.discoverProviders();

    expect(fakeSync.buildProviderCatalog).not.toHaveBeenCalled();
    expect(config.openai.model_source).toBe('static');
  });

  test('provider "enabled" is always a boolean, including local providers', async () => {
    // Regression test: isProviderConfigured used to return an un-awaited Promise
    // for ollama/llamacpp, which serialized to {} instead of a boolean.
    const { mgr } = tempConfigManager({ openRouterSyncEnabled: false });
    const config = await mgr.discoverProviders();

    for (const [name, entry] of Object.entries(config)) {
      expect(typeof entry.enabled).toBe('boolean');
      expect(name && entry).toBeTruthy();
    }
    // Local services are unavailable in the test env -> false (not {} / Promise).
    expect(config.ollama.enabled).toBe(false);
    expect(config.llamacpp.enabled).toBe(false);
  });

  test('isProviderConfigured resolves booleans for env-key and local providers', async () => {
    const { mgr } = tempConfigManager({ openRouterSyncEnabled: false });
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    try {
      await expect(mgr.isProviderConfigured('openai')).resolves.toBe(true);
      await expect(mgr.isProviderConfigured('ollama')).resolves.toBe(false);
      await expect(mgr.isProviderConfigured('llamacpp')).resolves.toBe(false);
      await expect(mgr.isProviderConfigured('unknown-xyz')).resolves.toBe(false);
    } finally {
      if (prev === undefined) { delete process.env.OPENAI_API_KEY; } else { process.env.OPENAI_API_KEY = prev; }
    }
  });

  test('honors a configurable TTL for shouldUpdateConfig', async () => {
    const { mgr, tmpFile } = tempConfigManager({ configTtlHours: 1 });
    // Write a config that is 2 hours old
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(tmpFile, JSON.stringify({ generated_at: twoHoursAgo, providers: {} }));
    expect(await mgr.shouldUpdateConfig()).toBe(true);

    // Fresh config should not require update
    fs.writeFileSync(tmpFile, JSON.stringify({ generated_at: new Date().toISOString(), providers: {} }));
    expect(await mgr.shouldUpdateConfig()).toBe(false);
  });
});
