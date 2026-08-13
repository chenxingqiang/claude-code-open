/**
 * OpenRouterClient
 *
 * Dynamic call layer for actually invoking models. Instead of the old approach
 * of statically injecting per-vendor API keys into llm-interface and dispatching
 * per provider, this client sends every request to OpenRouter's single
 * OpenAI-compatible endpoint using the model id as-is (e.g. "openai/gpt-4o").
 *
 * Requires a single OPENROUTER_API_KEY. All network access uses an injectable
 * fetch implementation for testability.
 */

const defaultFetch = require('node-fetch');

const DEFAULT_API_BASE_URL = 'https://openrouter.ai/api/v1';

class OpenRouterClient {
  /**
   * @param {object} [options]
   * @param {string} [options.apiBaseUrl]
   * @param {string} [options.apiKey]
   * @param {Function} [options.fetchImpl]
   * @param {number} [options.timeout]
   * @param {string} [options.referer] Value for the HTTP-Referer header (OpenRouter attribution).
   * @param {string} [options.title] Value for the X-Title header (OpenRouter attribution).
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl || process.env.OPENROUTER_API_URL || DEFAULT_API_BASE_URL;
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || '';
    this.fetchImpl = options.fetchImpl || defaultFetch;
    this.timeout = options.timeout || parseInt(process.env.OPENROUTER_TIMEOUT_MS, 10) || 60000;
    this.referer = options.referer || process.env.OPENROUTER_REFERER || 'https://github.com/chenxingqiang/claude-code-open';
    this.title = options.title || process.env.OPENROUTER_TITLE || 'Claude LLM Gateway';
    this.logger = options.logger || console;
  }

  /**
   * Whether the client has an API key and can make calls.
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Build request headers, including OpenRouter attribution headers.
   * @returns {object}
   */
  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': this.referer,
      'X-Title': this.title
    };
  }

  /**
   * Assemble the OpenAI-compatible request body from a normalized request.
   * @param {object} params
   * @returns {object}
   */
  buildBody(params, stream = false) {
    const body = {
      model: params.model,
      messages: params.messages || [],
      stream
    };
    if (params.max_tokens != null) body.max_tokens = params.max_tokens;
    if (params.temperature != null) body.temperature = params.temperature;
    if (params.top_p != null) body.top_p = params.top_p;
    if (params.stop != null) body.stop = params.stop;
    return body;
  }

  /**
   * Perform a (non-streaming) chat completion via OpenRouter.
   * @param {object} params { model, messages, max_tokens, temperature, top_p, stop }
   * @returns {Promise<object>} OpenAI-compatible response JSON.
   * @throws {Error} when not configured or the request fails.
   */
  async chatCompletion(params) {
    if (!this.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : null;
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(params, false)),
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) {
        const status = response ? response.status : 'no response';
        let detail = '';
        try {
          const errBody = await response.json();
          detail = errBody && errBody.error ? (errBody.error.message || JSON.stringify(errBody.error)) : '';
        } catch (e) { /* ignore parse errors */ }
        throw new Error(`OpenRouter chat completion failed (${status})${detail ? ': ' + detail : ''}`);
      }
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Extract a text delta from a single SSE data line (OpenAI streaming format).
   * @param {string} line e.g. 'data: {"choices":[{"delta":{"content":"hi"}}]}'
   * @returns {{done: boolean, content: string}} content is '' when there is none.
   */
  static extractDeltaFromLine(line) {
    const trimmed = (line || '').trim();
    if (!trimmed.startsWith('data:')) {
      return { done: false, content: '', reasoning: '' };
    }
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') {
      return { done: true, content: '', reasoning: '' };
    }
    try {
      const json = JSON.parse(payload);
      const delta = json.choices && json.choices[0] && json.choices[0].delta ? json.choices[0].delta : {};
      return { done: false, content: delta.content || '', reasoning: delta.reasoning || '' };
    } catch (e) {
      return { done: false, content: '', reasoning: '' };
    }
  }

  /**
   * Perform a streaming chat completion.
   * @param {object} params
   * @param {object} [options]
   * @param {boolean} [options.detailed] When true, yields { content, reasoning }
   *   objects (reasoning included); otherwise yields content text strings only.
   * @returns {AsyncGenerator<string|{content: string, reasoning: string}>}
   */
  async *streamCompletion(params, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }
    const detailed = !!options.detailed;
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(params, true))
    });
    if (!response || !response.ok) {
      const status = response ? response.status : 'no response';
      throw new Error(`OpenRouter stream failed (${status})`);
    }

    let buffer = '';
    const emit = (content, reasoning) => (detailed ? { content, reasoning } : content);
    for await (const chunk of response.body) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const { done, content, reasoning } = OpenRouterClient.extractDeltaFromLine(line);
        if (done) return;
        if (detailed) {
          if (content || reasoning) yield emit(content, reasoning);
        } else if (content) {
          yield content;
        }
      }
    }
    // Flush any trailing buffered line.
    if (buffer) {
      const { content, reasoning } = OpenRouterClient.extractDeltaFromLine(buffer);
      if (detailed) {
        if (content || reasoning) yield emit(content, reasoning);
      } else if (content) {
        yield content;
      }
    }
  }

  /**
   * Lightweight configuration/health check.
   * @returns {{configured: boolean, api_base_url: string}}
   */
  health() {
    return { configured: this.isConfigured(), api_base_url: this.apiBaseUrl };
  }
}

OpenRouterClient.DEFAULT_API_BASE_URL = DEFAULT_API_BASE_URL;

module.exports = OpenRouterClient;
