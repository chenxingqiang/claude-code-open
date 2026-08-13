#!/usr/bin/env node

/**
 * Multi-LLM Gateway CLI
 * Command-line interface for the Claude LLM Gateway
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

const ClaudeLLMGateway = require('../src/server');
const DynamicConfigManager = require('../src/config/dynamic-config-manager');
const packageJson = require('../package.json');

// Helper function to display providers summary
async function displayProvidersSummary(host, port) {
  try {
    const fetch = require('node-fetch');
    const response = await fetch(`http://${host}:${port}/providers`);
    if (!response.ok) {
      console.log(chalk.yellow('⚠️ Could not fetch providers status'));
      return;
    }
    
    const data = await response.json();
    const providers = data.providers;
    
    // Categorize providers
    const healthy = [];
    const needApiKey = [];
    const unreachable = [];
    const otherIssues = [];
    const notTested = [];
    
    Object.entries(providers).forEach(([name, info]) => {
      if (info.healthy) {
        healthy.push({ name, responseTime: info.response_time });
      } else if (info.status_type === 'no_api_key') {
        needApiKey.push({ name, error: info.error });
      } else if (info.status_type === 'unreachable') {
        unreachable.push({ name, error: info.error });
      } else if (info.status_type === 'unhealthy') {
        otherIssues.push({ name, error: info.error });
      } else {
        notTested.push({ name });
      }
    });
    
    console.log(chalk.blue('\n📊 === Providers Status Summary ==='));
    console.log(chalk.gray(`Total: ${Object.keys(providers).length} providers\n`));
    
    if (healthy.length > 0) {
      console.log(chalk.green(`✅ Healthy Providers (${healthy.length}):`));
      healthy.forEach(p => {
        console.log(`  ${chalk.green('●')} ${p.name}: ${p.responseTime}ms`);
      });
      console.log('');
    }
    
    if (needApiKey.length > 0) {
      console.log(chalk.yellow(`🔑 Need API Key (${needApiKey.length}):`));
      needApiKey.forEach(p => {
        console.log(`  ${chalk.yellow('●')} ${p.name}: ${p.error}`);
      });
      console.log('');
    }
    
    if (unreachable.length > 0) {
      console.log(chalk.red(`🔌 Unreachable (${unreachable.length}):`));
      unreachable.forEach(p => {
        console.log(`  ${chalk.red('●')} ${p.name}: ${p.error}`);
      });
      console.log('');
    }
    
    if (otherIssues.length > 0) {
      console.log(chalk.red(`❌ Other Issues (${otherIssues.length}):`));
      otherIssues.forEach(p => {
        console.log(`  ${chalk.red('●')} ${p.name}: ${p.error}`);
      });
      console.log('');
    }
    
    if (notTested.length > 0) {
      console.log(chalk.gray(`⚪ Not Tested (${notTested.length}):`));
      // Show first 5, then summary
      notTested.slice(0, 5).forEach(p => {
        console.log(`  ${chalk.gray('●')} ${p.name}: Not configured`);
      });
      if (notTested.length > 5) {
        console.log(`  ${chalk.gray('...')} and ${notTested.length - 5} more providers`);
      }
      console.log('');
    }
    
    console.log(chalk.blue('🌐 Service URLs:'));
    console.log(`  Claude API: http://${host}:${port}/v1/messages`);
    console.log(`  Health Check: http://${host}:${port}/health`);
    console.log(`  Provider Status: http://${host}:${port}/providers`);
    console.log('');
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Could not display providers summary: ${error.message}`));
  }
}

// Daemon process management
async function startDaemon(options) {
  const logDir = path.join(__dirname, '..', 'logs');
  const pidFile = path.join(logDir, 'gateway.pid');
  const logFile = path.join(logDir, 'gateway.log');

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Check if daemon is already running
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    try {
      // Check if process is still running
      process.kill(pid, 0);
      console.log(chalk.yellow(`⚠️ Gateway daemon is already running (PID: ${pid})`));
      return;
    } catch (e) {
      // Process is not running, remove stale PID file
      fs.unlinkSync(pidFile);
    }
  }

  console.log(chalk.blue('🔄 Starting daemon mode...'));

  // Check if we're already in daemon mode
  if (process.env.DAEMON_MODE === 'true') {
    return await startDaemonProcess(options);
  }

  // Use spawn instead of fork for better control
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [__filename, 'start', '--port', options.port, '--host', options.host || 'localhost'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      DAEMON_MODE: 'true',
      LOG_LEVEL: options.debug ? 'debug' : process.env.LOG_LEVEL,
      CONFIG_PATH: options.config || process.env.CONFIG_PATH
    }
  });

  // Save PID
  fs.writeFileSync(pidFile, child.pid.toString());

  // Detach the child process
  child.unref();

  console.log(chalk.green(`✅ Gateway daemon started successfully (PID: ${child.pid})`));
  console.log(chalk.blue(`📡 Service URL: http://${options.host || 'localhost'}:${options.port}`));
  console.log(chalk.blue(`🔗 Claude API: http://${options.host || 'localhost'}:${options.port}/v1/messages`));
  console.log(chalk.blue(`💬 Chat API: http://${options.host || 'localhost'}:${options.port}/v1/chat/completions`));
  console.log(chalk.blue(`📊 Health Check: http://${options.host || 'localhost'}:${options.port}/health`));
  console.log(chalk.blue(`📄 Logs: ${logFile}`));
  console.log(chalk.blue(`🆔 PID file: ${pidFile}`));
  console.log(chalk.yellow(`\n💡 Use 'claude-llm-gateway stop' to stop the daemon`));
  console.log(chalk.gray(`\n⏱️ Starting up... please wait 10-20 seconds for full initialization`));
  
  // Show providers summary after daemon starts
  setTimeout(async () => {
    console.log(chalk.blue('\n🔄 Fetching providers status...'));
    await displayProvidersSummary(options.host || 'localhost', options.port);
  }, 15000);

  process.exit(0);
}

async function startDaemonProcess(options) {
  try {
    if (options.debug) {
      process.env.LOG_LEVEL = 'debug';
    }

    if (options.config) {
      process.env.CONFIG_PATH = options.config;
    }

    const gateway = new ClaudeLLMGateway();
    await gateway.start(parseInt(options.port), options.host);

    // Notify parent process BEFORE redirecting output
    if (process.send) {
      process.send({
        type: 'started',
        pid: process.pid,
        port: options.port,
        host: options.host || 'localhost'
      });
    }

    // Now redirect stdout/stderr to log file
    const logDir = path.join(__dirname, '..', 'logs');
    const logFile = path.join(logDir, 'gateway.log');

    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    process.stdout.write = process.stderr.write = logStream.write.bind(logStream);

    console.log(`\n=== Gateway Daemon Started at ${new Date().toISOString()} ===`);
    console.log(`✅ Gateway daemon running on ${options.host}:${options.port}`);

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('🛑 Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Daemon startup failed:', error.message);
    if (process.send) {
      process.send({ type: 'error', error: error.message });
    }
    process.exit(1);
  }
}

const program = new Command();

program
  .name('multi-llm-gateway')
  .description('CLI for Claude LLM Gateway')
  .version(packageJson.version);

// Start command
program
  .command('start')
  .description('Start the Claude LLM Gateway')
  .option('-p, --port <port>', 'Port number to run the gateway on', '3000')
  .option('-h, --host <host>', 'Host to bind the gateway to', 'localhost')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-d, --daemon', 'Run as daemon process')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    try {
      // Handle daemon mode
      if (options.daemon) {
        return await startDaemon(options);
      }

      console.log(chalk.blue('🚀 Starting Claude LLM Gateway...'));

      if (options.debug) {
        process.env.LOG_LEVEL = 'debug';
      }

      if (options.config) {
        process.env.CONFIG_PATH = options.config;
      }

            const gateway = new ClaudeLLMGateway();
      await gateway.start(parseInt(options.port), options.host);
      
      console.log(chalk.green(`✅ Gateway started successfully on ${options.host}:${options.port}`));
      
      // Wait a moment for health checks to complete
      setTimeout(async () => {
        await displayProvidersSummary(options.host, options.port);
      }, 5000);
      
      // Keep process alive in foreground mode
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n🛑 Shutting down gracefully...'));
        process.exit(0);
      });

    } catch (error) {
      console.error(chalk.red('❌ Failed to start gateway:'), error.message);
      process.exit(1);
    }
  });

// Stop command
program
  .command('stop')
  .description('Stop the daemon gateway')
  .action(async () => {
    try {
      const logDir = path.join(__dirname, '..', 'logs');
      const pidFile = path.join(logDir, 'gateway.pid');

      if (!fs.existsSync(pidFile)) {
        console.log(chalk.yellow('⚠️ No daemon process found'));
        return;
      }

      const pid = fs.readFileSync(pidFile, 'utf8').trim();

      try {
        // Check if process is running
        process.kill(pid, 0);

        console.log(chalk.blue(`🛑 Stopping daemon process (PID: ${pid})...`));

        // Send SIGTERM for graceful shutdown
        process.kill(pid, 'SIGTERM');

        // Wait a bit and check if process stopped
        setTimeout(() => {
          try {
            process.kill(pid, 0);
            console.log(chalk.yellow('⚠️ Process still running, sending SIGKILL...'));
            process.kill(pid, 'SIGKILL');
          } catch (e) {
            // Process stopped
          }

          // Remove PID file
          if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
          }

          console.log(chalk.green('✅ Daemon stopped successfully'));
        }, 5000);

      } catch (e) {
        // Process not running
        console.log(chalk.yellow('⚠️ Daemon process not running'));
        fs.unlinkSync(pidFile);
      }

    } catch (error) {
      console.error(chalk.red('❌ Failed to stop daemon:'), error.message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Manage gateway configuration')
  .option('-u, --update', 'Update provider configuration')
  .option('-s, --show', 'Show current configuration')
  .option('-r, --reset', 'Reset configuration to defaults')
  .action(async (options) => {
    try {
      const configManager = new DynamicConfigManager();

      if (options.update) {
        console.log(chalk.blue('🔄 Updating provider configuration...'));
        await configManager.discoverProviders();
        const info = configManager.getLastSyncInfo();
        if (info && info.ok) {
          console.log(chalk.green(`✅ Configuration updated from OpenRouter (${info.total_models} models)`));
        } else {
          console.log(chalk.green('✅ Configuration updated (static fallback)'));
          if (info && info.error) {
            console.log(chalk.gray(`   OpenRouter sync skipped/failed: ${info.error}`));
          }
        }
      }

      if (options.show) {
        console.log(chalk.blue('📋 Current Configuration:'));
        const config = await configManager.loadConfig();
        if (config) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(chalk.yellow('⚠️ No configuration found'));
        }
      }

      if (options.reset) {
        console.log(chalk.yellow('🔄 Resetting configuration...'));
        // The catalog is an auto-generated cache; removing it forces a fresh
        // discovery (OpenRouter sync or static fallback) on the next run.
        if (fs.existsSync(configManager.configPath)) {
          fs.unlinkSync(configManager.configPath);
          console.log(chalk.gray(`   Removed ${configManager.configPath}`));
        }
        await configManager.discoverProviders();
        console.log(chalk.green('✅ Configuration reset and regenerated'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Configuration operation failed:'), error.message);
      process.exit(1);
    }
  });

// Models command — inspect and refresh the auto-synced model catalog
program
  .command('models [action]')
  .description('Manage the auto-synced model catalog: status | sync | list')
  .option('-p, --provider <provider>', 'Filter to a single provider (for list)')
  .option('-l, --limit <n>', 'Max models to show per provider (for list)', '10')
  .action(async (action, options) => {
    const act = (action || 'status').toLowerCase();
    try {
      const configManager = new DynamicConfigManager();

      if (act === 'sync') {
        console.log(chalk.blue('🌐 Syncing model information...'));
        await configManager.discoverProviders();
        const info = configManager.getLastSyncInfo();
        if (info && info.ok) {
          console.log(chalk.green(`✅ Synced ${info.total_models} models from OpenRouter`));
          console.log(chalk.gray(`   Synced at: ${info.synced_at}`));
        } else {
          console.log(chalk.yellow('⚠️ OpenRouter sync unavailable, used static fallback'));
          if (info && info.error) {
            console.log(chalk.gray(`   Reason: ${info.error}`));
          }
        }
        return;
      }

      if (act === 'status') {
        const config = await configManager.loadConfig();
        if (!config) {
          console.log(chalk.yellow('⚠️ No catalog yet. Run "claude-llm-gateway models sync".'));
          return;
        }
        const providers = config.providers || {};
        const bySource = { openrouter: 0, static: 0 };
        let totalModels = 0;
        for (const p of Object.values(providers)) {
          const src = p.model_source === 'openrouter' ? 'openrouter' : 'static';
          bySource[src] += 1;
          totalModels += (p.models || []).length;
        }
        console.log(chalk.blue('\n📊 === Model Catalog Status ==='));
        console.log(`  Source:            ${chalk.cyan(config.model_source || 'static')}`);
        console.log(`  OpenRouter synced: ${config.openrouter_synced_at || 'never'}`);
        console.log(`  OpenRouter models: ${config.openrouter_total_models || 0}`);
        console.log(`  Providers:         ${Object.keys(providers).length} (openrouter=${bySource.openrouter}, static=${bySource.static})`);
        console.log(`  Total models:      ${totalModels}`);
        console.log(`  Generated at:      ${config.generated_at || 'unknown'}`);
        console.log('');
        return;
      }

      if (act === 'list') {
        const config = await configManager.loadConfig();
        if (!config || !config.providers) {
          console.log(chalk.yellow('⚠️ No catalog yet. Run "claude-llm-gateway models sync".'));
          return;
        }
        const limit = parseInt(options.limit, 10) || 10;
        const entries = Object.entries(config.providers)
          .filter(([name]) => !options.provider || name === options.provider);
        if (entries.length === 0) {
          console.log(chalk.yellow(`⚠️ No provider matched "${options.provider}"`));
          return;
        }
        console.log(chalk.blue('\n📚 === Model Catalog ==='));
        for (const [name, entry] of entries) {
          const models = entry.models || [];
          const tag = entry.model_source === 'openrouter' ? chalk.green('[openrouter]') : chalk.gray('[static]');
          console.log(`\n${chalk.bold(name)} ${tag} — ${models.length} models`);
          models.slice(0, limit).forEach(m => console.log(`  ${chalk.cyan('•')} ${m}`));
          if (models.length > limit) {
            console.log(chalk.gray(`  ... and ${models.length - limit} more`));
          }
        }
        console.log('');
        return;
      }

      console.log(chalk.red(`❌ Unknown action "${act}". Use: status | sync | list`));
      process.exit(1);
    } catch (error) {
      console.error(chalk.red('❌ Models operation failed:'), error.message);
      process.exit(1);
    }
  });

// Test command
program
  .command('test')
  .description('Test gateway functionality')
  .option('-p, --provider <provider>', 'Test specific provider')
  .option('-m, --model <model>', 'Test specific model')
  .option('-u, --url <url>', 'Gateway URL to test', 'http://localhost:3000')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🧪 Testing gateway functionality...'));

      const testMessage = {
        model: options.model || 'claude-3-sonnet',
        messages: [
          { role: 'user', content: 'Hello! This is a test message.' }
        ],
        max_tokens: 50
      };

      const fetch = require('node-fetch');
      const response = await fetch(`${options.url}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testMessage)
      });

      if (response.ok) {
        const result = await response.json();
        console.log(chalk.green('✅ Test successful!'));
        console.log('Response:', JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.red('❌ Test failed:'), response.status, response.statusText);
      }

    } catch (error) {
      console.error(chalk.red('❌ Test failed:'), error.message);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Check gateway status and show providers summary')
  .option('-u, --url <url>', 'Gateway URL to check', 'http://localhost:8765')
  .action(async (options) => {
    try {
      const fetch = require('node-fetch');
      
      console.log(chalk.blue('📊 Checking gateway status...'));
      
      // Health check
      const healthResponse = await fetch(`${options.url}/health`);
      if (healthResponse.ok) {
        const health = await healthResponse.json();
        console.log(chalk.green('✅ Gateway is healthy'));
        console.log(`Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`);
        console.log(`Providers: ${health.providers.healthy}/${health.providers.total} healthy`);
      } else {
        console.log(chalk.red('❌ Gateway is not responding'));
        process.exit(1);
      }
      
      // Use the shared function to display providers summary
      const url = new URL(options.url);
      await displayProvidersSummary(url.hostname, url.port);
      
    } catch (error) {
      console.error(chalk.red('❌ Status check failed:'), error.message);
      process.exit(1);
    }
  });

// Install command
program
  .command('install')
  .description('Install and configure the gateway')
  .option('-d, --directory <dir>', 'Installation directory', './multi-llm-gateway')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📦 Installing Multi-LLM Gateway...'));

      const installDir = path.resolve(options.directory);

      // Create directory structure
      const dirs = ['config', 'logs', 'scripts'];
      for (const dir of dirs) {
        const dirPath = path.join(installDir, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      }

      // Copy environment example
      const envExample = path.join(__dirname, '../env.example');
      const envTarget = path.join(installDir, '.env.example');
      if (fs.existsSync(envExample)) {
        fs.copyFileSync(envExample, envTarget);
      }

      console.log(chalk.green(`✅ Gateway installed in ${installDir}`));
      console.log(chalk.yellow('Next steps:'));
      console.log(`1. cd ${installDir}`);
      console.log('2. cp .env.example .env');
      console.log('3. Edit .env with your API keys');
      console.log('4. multi-llm-gateway start');

    } catch (error) {
      console.error(chalk.red('❌ Installation failed:'), error.message);
      process.exit(1);
    }
  });

// Version command (already handled by commander, but we can customize it)
program
  .command('version')
  .description('Show version information')
  .action(() => {
    console.log(chalk.blue('Claude LLM Gateway'));
    console.log(`Version: ${packageJson.version}`);
    console.log(`Node: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
