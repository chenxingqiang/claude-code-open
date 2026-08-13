/**
 * Integration tests for the CLI model-catalog commands.
 * Runs the real CLI via child_process with OpenRouter sync disabled so the
 * behavior is deterministic and offline (static fallback path).
 */

const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'bin', 'cli.js');
// Isolate the generated catalog to a temp file so the CLI tests never write the
// real config/providers.json.
const TMP_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clicfg-')), 'providers.json');
const ENV = { ...process.env, ENABLE_OPENROUTER_SYNC: 'false', PROVIDERS_CONFIG_PATH: TMP_CONFIG };

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

describe('CLI model catalog commands (remote --url)', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/providers/refresh') {
        res.end(JSON.stringify({
          success: true,
          total_providers: 36,
          model_sync: { source: 'openrouter', synced_at: '2026-08-13T00:00:00.000Z', total_models: 410, ok: true }
        }));
      } else if (req.url === '/models/sync-status') {
        res.end(JSON.stringify({
          openrouter_sync_enabled: true,
          config: { model_source: 'openrouter', openrouter_synced_at: '2026-08-13T00:00:00.000Z', openrouter_total_models: 410, total_providers: 36 },
          ttl_hours: 24
        }));
      } else if (req.url.startsWith('/models/catalog')) {
        res.end(JSON.stringify({
          source: 'openrouter',
          providers: {
            anthropic: { model_source: 'openrouter', models: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'] }
          },
          models: []
        }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => { server.close(() => done()); });

  test('models sync --url triggers gateway refresh and reports sync info', async () => {
    const { stdout } = await execFileAsync('node', [CLI, 'models', 'sync', '--url', baseUrl], { encoding: 'utf8', timeout: 30000 });
    expect(stdout).toMatch(/Gateway synced 410 models from OpenRouter/);
  });

  test('models status --url reads remote sync status', async () => {
    const { stdout } = await execFileAsync('node', [CLI, 'models', 'status', '--url', baseUrl], { encoding: 'utf8', timeout: 30000 });
    expect(stdout).toMatch(/Model Catalog Status \(remote\)/);
    expect(stdout).toMatch(/OpenRouter models: 410/);
  });

  test('models list --url reads remote catalog', async () => {
    const { stdout } = await execFileAsync('node', [CLI, 'models', 'list', '--url', baseUrl, '-p', 'anthropic'], { encoding: 'utf8', timeout: 30000 });
    expect(stdout).toMatch(/anthropic/);
    expect(stdout).toMatch(/claude-opus-5/);
    expect(stdout).toMatch(/\[openrouter\]/);
  });
});
