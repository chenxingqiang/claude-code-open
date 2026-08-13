/**
 * Unit tests for OpenRouterClient (dynamic call layer). Uses injected fetch.
 */

const OpenRouterClient = require('../../src/openrouter-client');

function okJson(payload) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

describe('OpenRouterClient', () => {
  describe('isConfigured / health', () => {
    test('reflects presence of an API key', () => {
      expect(new OpenRouterClient({ apiKey: '' }).isConfigured()).toBe(false);
      expect(new OpenRouterClient({ apiKey: 'sk-test' }).isConfigured()).toBe(true);
      expect(new OpenRouterClient({ apiKey: 'sk-test' }).health()).toMatchObject({ configured: true });
    });
  });

  describe('chatCompletion', () => {
    const completion = {
      id: 'gen-1',
      model: 'openai/gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 }
    };

    test('throws when not configured', async () => {
      const client = new OpenRouterClient({ apiKey: '', fetchImpl: okJson(completion) });
      await expect(client.chatCompletion({ model: 'openai/gpt-4o', messages: [] })).rejects.toThrow(/not configured/);
    });

    test('POSTs to /chat/completions with auth header and model/messages', async () => {
      const fetchImpl = okJson(completion);
      const client = new OpenRouterClient({ apiKey: 'sk-test', fetchImpl, apiBaseUrl: 'https://openrouter.ai/api/v1' });
      const res = await client.chatCompletion({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.7
      });

      expect(res.choices[0].message.content).toBe('Hello there');
      const [url, opts] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('openai/gpt-4o');
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(body.max_tokens).toBe(100);
      expect(body.stream).toBe(false);
    });

    test('throws with detail on non-ok response', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'No auth credentials found' } })
      });
      const client = new OpenRouterClient({ apiKey: 'sk-test', fetchImpl });
      await expect(client.chatCompletion({ model: 'x', messages: [] }))
        .rejects.toThrow(/401.*No auth credentials found/);
    });
  });

  describe('extractDeltaFromLine', () => {
    test('parses content deltas', () => {
      expect(OpenRouterClient.extractDeltaFromLine('data: {"choices":[{"delta":{"content":"Hi"}}]}'))
        .toEqual({ done: false, content: 'Hi', reasoning: '' });
    });
    test('detects [DONE]', () => {
      expect(OpenRouterClient.extractDeltaFromLine('data: [DONE]')).toEqual({ done: true, content: '', reasoning: '' });
    });
    test('ignores non-data and malformed lines', () => {
      expect(OpenRouterClient.extractDeltaFromLine(': comment')).toEqual({ done: false, content: '', reasoning: '' });
      expect(OpenRouterClient.extractDeltaFromLine('data: {bad json')).toEqual({ done: false, content: '', reasoning: '' });
    });
    test('extracts reasoning deltas', () => {
      expect(OpenRouterClient.extractDeltaFromLine('data: {"choices":[{"delta":{"reasoning":"thinking"}}]}'))
        .toEqual({ done: false, content: '', reasoning: 'thinking' });
    });
  });

  describe('streamCompletion', () => {
    function bodyFactory() {
      return (async function* () {
        yield Buffer.from('data: {"choices":[{"delta":{"reasoning":"why"}}]}\n');
        yield Buffer.from('data: {"choices":[{"delta":{"content":"Hello"}}]}\n');
        yield Buffer.from('data: {"choices":[{"delta":{"content":" world"}}]}\n');
        yield Buffer.from('data: [DONE]\n');
      })();
    }

    test('default mode yields only content text', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, body: bodyFactory() });
      const client = new OpenRouterClient({ apiKey: 'sk-test', fetchImpl });
      const chunks = [];
      for await (const c of client.streamCompletion({ model: 'openai/gpt-4o', messages: [] })) {
        chunks.push(c);
      }
      expect(chunks.join('')).toBe('Hello world');
    });

    test('detailed mode yields content and reasoning parts', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, body: bodyFactory() });
      const client = new OpenRouterClient({ apiKey: 'sk-test', fetchImpl });
      const parts = [];
      for await (const p of client.streamCompletion({ model: 'openai/gpt-4o', messages: [] }, { detailed: true })) {
        parts.push(p);
      }
      const reasoning = parts.map(p => p.reasoning).join('');
      const content = parts.map(p => p.content).join('');
      expect(reasoning).toBe('why');
      expect(content).toBe('Hello world');
    });
  });
});
