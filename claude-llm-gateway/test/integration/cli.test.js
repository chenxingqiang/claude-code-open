/**
 * Integration tests for the CLI model-catalog commands.
 * Runs the real CLI via child_process with OpenRouter sync disabled so the
 * behavior is deterministic and offline (static fallback path).
 */

const { execFileSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'bin', 'cli.js');
const ENV = { ...process.env, ENABLE_OPENROUTER_SYNC: 'false' };

function runCli(args) {
  return execFileSync('node', [CLI, ...args], {
    env: ENV,
    encoding: 'utf8',
    timeout: 60000
  });
}

describe('CLI model catalog commands', () => {
  // Ensure a catalog exists (static) before status/list assertions.
  beforeAll(() => {
    runCli(['models', 'sync']);
  });

  test('help lists the models command', () => {
    const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/models/);
  });

  test('models sync reports static fallback when OpenRouter disabled', () => {
    const out = runCli(['models', 'sync']);
    expect(out).toMatch(/static fallback|used static fallback/i);
  });

  test('models status prints catalog status with provider counts', () => {
    const out = runCli(['models', 'status']);
    expect(out).toMatch(/Model Catalog Status/);
    expect(out).toMatch(/Source:/);
    expect(out).toMatch(/Providers:/);
    expect(out).toMatch(/Total models:/);
  });

  test('models list filters by provider and tags the source', () => {
    const out = runCli(['models', 'list', '-p', 'openai', '-l', '2']);
    expect(out).toMatch(/openai/);
    expect(out).toMatch(/\[static\]/);
  });

  test('unknown provider in list is reported', () => {
    const out = runCli(['models', 'list', '-p', 'does-not-exist']);
    expect(out).toMatch(/No provider matched/);
  });
});
