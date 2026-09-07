/**
 * Tests for optional reasoning passthrough in ClaudeCompatibility.toClaudeFormat.
 */

const ClaudeCompatibility = require('../../src/claude-compatibility');

const responseWithReasoning = {
  model: 'x/reasoner',
  choices: [{ message: { role: 'assistant', content: 'The answer is 4', reasoning: '2+2 = 4' } }],
  usage: { prompt_tokens: 3, completion_tokens: 4 }
};

describe('ClaudeCompatibility reasoning passthrough', () => {
  let prev;
  beforeEach(() => { prev = process.env.EXPOSE_REASONING; });
  afterEach(() => { if (prev === undefined) delete process.env.EXPOSE_REASONING; else process.env.EXPOSE_REASONING = prev; });

  test('extractReasoning reads message.reasoning', () => {
    const c = new ClaudeCompatibility();
    expect(c.extractReasoning(responseWithReasoning)).toBe('2+2 = 4');
    expect(c.extractReasoning({ choices: [{ message: { content: 'x' } }] })).toBe('');
  });

  test('attaches reasoning only when EXPOSE_REASONING=true', () => {
    const c = new ClaudeCompatibility();

    process.env.EXPOSE_REASONING = 'false';
    let out = c.toClaudeFormat(responseWithReasoning, 'x');
    expect(out.reasoning).toBeUndefined();
    expect(out.content[0].text).toBe('The answer is 4');

    process.env.EXPOSE_REASONING = 'true';
    out = c.toClaudeFormat(responseWithReasoning, 'x');
    expect(out.reasoning).toBe('2+2 = 4');
  });
});
