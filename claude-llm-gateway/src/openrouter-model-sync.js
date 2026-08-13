/**
 * OpenRouterModelSync
 *
 * Fetches the live model catalog from the OpenRouter public API
 * (GET https://openrouter.ai/api/v1/models) and normalizes it into the shapes
 * the gateway needs, so model information (ids, pricing, context length,
 * capabilities) is kept up to date automatically instead of being hand-maintained.
 *
 * The OpenRouter models endpoint is public and does not require an API key.
 * All network access is best-effort: callers are expected to fall back to
 * static configuration when a sync fails.
 */

const defaultFetch = require('node-fetch');

const DEFAULT_API_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Maps an OpenRouter author namespace (the part before "/" in a model id, e.g.
 * "openai" in "openai/gpt-4") to the gateway's internal provider slug used in
 * config/providers.json. Authors without an entry are mapped by identity.
 */
const AUTHOR_TO_PROVIDER = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  'google-vertex': 'google',
  deepseek: 'deepseek',
  mistralai: 'mistral',
  cohere: 'cohere',
  perplexity: 'perplexity',
  ai21: 'ai21',
  nvidia: 'nvidia',
  'meta-llama': 'meta',
  qwen: 'qwen',
  'x-ai': 'xai',
  microsoft: 'microsoft',
  amazon: 'amazon',
  mistral: 'mistral'
};

class OpenRouterModelSync {
  /**
   * @param {object} [options]
   * @param {string} [options.apiBaseUrl] OpenRouter API base URL.
   * @param {number} [options.timeout] Request timeout in milliseconds.
   * @param {Function} [options.fetchImpl] Injectable fetch implementation (for tests).
   * @param {object} [options.logger] Logger with warn/error/log methods.
   */
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl || process.env.OPENROUTER_API_URL || DEFAULT_API_BASE_URL;
    this.timeout = options.timeout || parseInt(process.env.OPENROUTER_TIMEOUT_MS, 10) || 20000;
    this.fetchImpl = options.fetchImpl || defaultFetch;
    this.logger = options.logger || console;
  }

  /**
   * Derive the gateway provider slug for an OpenRouter model.
   * @param {string} authorOrId Either the author namespace or a full model id.
   * @returns {string} provider slug (lowercased).
   */
  mapAuthorToProvider(authorOrId) {
    if (!authorOrId || typeof authorOrId !== 'string') {
      return 'unknown';
    }
    const author = authorOrId.includes('/') ? authorOrId.split('/')[0] : authorOrId;
    const normalized = author.trim().toLowerCase();
    return AUTHOR_TO_PROVIDER[normalized] || normalized;
  }

  /**
   * Convert OpenRouter per-token pricing to the gateway's cost_per_1k_tokens unit.
   * Uses the prompt (input) price, which matches the gateway's existing anchor
   * values (e.g. gpt-4 = 0.03 per 1k prompt tokens).
   * @param {object} pricing OpenRouter pricing object.
   * @returns {number} cost per 1k tokens (USD), rounded to 6 decimals.
   */
  computeCostPer1kTokens(pricing) {
    if (!pricing) {
      return 0;
    }
    const prompt = parseFloat(pricing.prompt);
    if (!Number.isFinite(prompt)) {
      return 0;
    }
    return Math.round(prompt * 1000 * 1e6) / 1e6;
  }

  /**
   * Derive coarse capability flags from an OpenRouter architecture object.
   * @param {object} architecture
   * @returns {{chat: boolean, completion: boolean, vision: boolean, audio: boolean, video: boolean, embeddings: boolean}}
   */
  deriveCapabilities(architecture) {
    const inputs = (architecture && Array.isArray(architecture.input_modalities))
      ? architecture.input_modalities
      : [];
    const outputs = (architecture && Array.isArray(architecture.output_modalities))
      ? architecture.output_modalities
      : [];
    return {
      chat: true,
      completion: true,
      vision: inputs.includes('image'),
      audio: inputs.includes('audio') || outputs.includes('audio'),
      video: inputs.includes('video') || outputs.includes('video'),
      embeddings: outputs.includes('embeddings')
    };
  }

  /**
   * Normalize a raw OpenRouter model object into the gateway's flat model info.
   * @param {object} raw
   * @returns {object|null} normalized model, or null when the input is invalid.
   */
  normalizeModel(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
      return null;
    }
    const architecture = raw.architecture || {};
    const pricing = raw.pricing || {};
    const shortSlug = raw.id.includes('/') ? raw.id.split('/').slice(1).join('/') : raw.id;
    // Drop any variant suffix (e.g. ":free") from the short slug.
    const baseShortSlug = shortSlug.split(':')[0];
    return {
      id: raw.id,
      canonical_slug: raw.canonical_slug || raw.id,
      short_slug: baseShortSlug,
      name: raw.name || raw.id,
      provider: this.mapAuthorToProvider(raw.id),
      context_length: raw.context_length != null ? raw.context_length : null,
      pricing: {
        prompt: pricing.prompt != null ? String(pricing.prompt) : null,
        completion: pricing.completion != null ? String(pricing.completion) : null
      },
      cost_per_1k_tokens: this.computeCostPer1kTokens(pricing),
      input_modalities: Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [],
      output_modalities: Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [],
      capabilities: this.deriveCapabilities(architecture),
      supported_parameters: Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [],
      created: raw.created != null ? raw.created : null
    };
  }

  /**
   * Group normalized models by gateway provider slug.
   * @param {Array<object>} normalizedModels
   * @returns {Object<string, {models: string[], model_details: object[], cost_per_1k_tokens: number, capabilities: object}>}
   */
  groupByProvider(normalizedModels) {
    const grouped = {};
    for (const model of normalizedModels) {
      if (!model) {
        continue;
      }
      const provider = model.provider;
      if (!grouped[provider]) {
        grouped[provider] = {
          models: [],
          model_details: [],
          cost_per_1k_tokens: 0,
          capabilities: { chat: true, completion: true, vision: false, audio: false, video: false, embeddings: false }
        };
      }
      const bucket = grouped[provider];
      if (!bucket.models.includes(model.id)) {
        bucket.models.push(model.id);
        bucket.model_details.push(model);
      }
      // Union of capabilities across the provider's models.
      for (const cap of Object.keys(bucket.capabilities)) {
        bucket.capabilities[cap] = bucket.capabilities[cap] || !!(model.capabilities && model.capabilities[cap]);
      }
    }
    // Aggregate cost as the average prompt cost across the provider's models.
    for (const provider of Object.keys(grouped)) {
      const details = grouped[provider].model_details;
      const costs = details.map(d => d.cost_per_1k_tokens).filter(c => Number.isFinite(c) && c > 0);
      const avg = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
      grouped[provider].cost_per_1k_tokens = Math.round(avg * 1e6) / 1e6;
    }
    return grouped;
  }

  /**
   * Fetch all models from the OpenRouter API.
   * @returns {Promise<Array<object>>} raw model objects.
   * @throws {Error} on network error, non-2xx response, or malformed payload.
   */
  async fetchAllModels() {
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/models`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : null;
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) {
        const status = response ? response.status : 'no response';
        throw new Error(`OpenRouter models request failed with status ${status}`);
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) {
        throw new Error('OpenRouter models response missing "data" array');
      }
      return payload.data;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Fetch, normalize and group the OpenRouter catalog.
   * @returns {Promise<{source: string, fetched_at: string, total_models: number, providers: object, models: object[]}>}
   * @throws {Error} when the fetch fails (callers should fall back to static config).
   */
  async buildProviderCatalog() {
    const raw = await this.fetchAllModels();
    const normalized = raw.map(m => this.normalizeModel(m)).filter(Boolean);
    const providers = this.groupByProvider(normalized);
    return {
      source: 'openrouter',
      fetched_at: new Date().toISOString(),
      total_models: normalized.length,
      providers,
      models: normalized
    };
  }
}

OpenRouterModelSync.AUTHOR_TO_PROVIDER = AUTHOR_TO_PROVIDER;
OpenRouterModelSync.DEFAULT_API_BASE_URL = DEFAULT_API_BASE_URL;

module.exports = OpenRouterModelSync;
