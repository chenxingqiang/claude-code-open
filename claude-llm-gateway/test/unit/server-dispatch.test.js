/**
 * Unit tests for the dynamic call-layer dispatch in ClaudeLLMGateway.
 */

const ClaudeLLMGateway = require('../../src/server');

describe('ClaudeLLMGateway.dispatchCompletion', () => {
  test('routes through OpenRouter client when backend is openrouter', async () => {
    const gateway = new ClaudeLLMGateway();
    gateway.callBackend = 'openrouter';
    const chatCompletion = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });
    gateway.openRouterClient = { isConfigured: () => true, chatCompletion };

    const resp = await gateway.dispatchCompletion('openai', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 50,
      temperature: 0.7
    });

    expect(chatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-4o',
      max_tokens: 50
    }));
    expect(resp.choices[0].message.content).toBe('ok');
  });

  test('throws a clear error when OpenRouter is not configured', async () => {
    const gateway = new ClaudeLLMGateway();
    gateway.callBackend = 'openrouter';
    gateway.openRouterClient = { isConfigured: () => false };

    await expect(gateway.dispatchCompletion('openai', { model: 'x', messages: [] }))
      .rejects.toThrow(/OPENROUTER_API_KEY not configured/);
  });
});
