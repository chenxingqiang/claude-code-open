const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DynamicConfigManager = require('./config/dynamic-config-manager');
const ClaudeCompatibility = require('./claude-compatibility');
const ProviderRouter = require('./provider-router');
const IntelligentModelSelector = require('./intelligent-model-selector');
const OpenRouterClient = require('./openrouter-client');

class ClaudeLLMGateway {
  constructor() {
    this.app = express();
    this.configManager = new DynamicConfigManager();
    this.claudeCompat = new ClaudeCompatibility();
    this.providerRouter = new ProviderRouter();
    this.modelSelector = new IntelligentModelSelector();
    // Dynamic call layer: all completions go through OpenRouter's unified
    // endpoint using the synced model id (single OPENROUTER_API_KEY). The old
    // per-vendor llm-interface injection has been removed.
    this.openRouterClient = new OpenRouterClient();
    this.providers = new Map();
    this.requestLog = new Map();
  }

  /**
   * Initialize gateway
   */
  async initialize() {
    console.log('🚀 Initializing Claude LLM Gateway...');
    
    try {
      // 1. Setup dynamic providers
      await this.setupDynamicProviders();
      
      // 2. Setup middleware
      this.setupMiddleware();
      
      // 3. Setup routes
      this.setupRoutes();
      
      // 4. Error handling
      this.setupErrorHandling();
      
      console.log('✅ Gateway initialization completed');
      
    } catch (error) {
      console.error('❌ Gateway initialization failed:', error);
      throw error;
    }
  }

  /**
   * Setup dynamic providers
   */
  async setupDynamicProviders() {
    try {
      console.log('🔍 Setting up dynamic providers...');
      
      // Check if configuration needs updating
      const shouldUpdate = await this.configManager.shouldUpdateConfig();
      
      if (shouldUpdate) {
        console.log('📝 Updating provider configuration...');
        await this.configManager.discoverProviders();
      }
      
      // Load configuration
      const config = await this.configManager.loadConfig();
      if (!config) {
        throw new Error('Unable to load provider configuration');
      }
      
      // Provider health reflects the single OpenRouter dependency.
      if (typeof this.providerRouter.setCallBackend === 'function') {
        this.providerRouter.setCallBackend('openrouter', this.openRouterClient);
      }
      
      // Initialize provider router
      await this.providerRouter.initialize(config.providers);
      
      // Store provider configuration
      if (config.providers && typeof config.providers === 'object') {
        this.providers = new Map(Object.entries(config.providers));
      } else {
        console.warn('⚠️  No providers in config, initializing empty providers map');
        this.providers = new Map();
      }
      
      console.log(`✅ Successfully configured ${this.providers.size} providers`);

      // Keep the intelligent selector's pricing in sync with live model data.
      this.syncModelSelectorPricing(config);
      
      // Show configuration summary
      this.displayProviderSummary(config.providers);
      
    } catch (error) {
      console.error('❌ Dynamic provider configuration failed:', error);
      throw error;
    }
  }

  /**
   * Feed live OpenRouter model pricing (stored as per-provider model_details in
   * the loaded config) into the intelligent model selector so cost estimation
   * reflects current prices. Safe no-op when no OpenRouter data is present.
   * @param {object} config Loaded providers config file.
   */
  syncModelSelectorPricing(config) {
    try {
      if (!config || !config.providers) {
        return;
      }
      const allDetails = [];
      for (const provider of Object.values(config.providers)) {
        if (provider && Array.isArray(provider.model_details)) {
          allDetails.push(...provider.model_details);
        }
      }
      if (allDetails.length > 0 && typeof this.modelSelector.applyOpenRouterPricing === 'function') {
        const updated = this.modelSelector.applyOpenRouterPricing(allDetails);
        console.log(`💲 Synced pricing for ${updated} model keys from live catalog`);
      }
      if (allDetails.length > 0 && typeof this.modelSelector.applyOpenRouterCapabilities === 'function') {
        const caps = this.modelSelector.applyOpenRouterCapabilities(allDetails);
        console.log(`🧩 Synced capabilities for ${caps} model keys from live catalog`);
      }
    } catch (error) {
      console.warn(`⚠️  Failed to sync model selector pricing: ${error.message}`);
    }
  }

  /**
   * Start a periodic background refresh of provider/model info so the catalog
   * stays current without manual intervention. Interval defaults to the config
   * TTL; override with MODEL_SYNC_INTERVAL_MINUTES. The timer is unref'd so it
   * never keeps the process alive on its own.
   */
  startModelSyncScheduler() {
    const minutes = parseInt(process.env.MODEL_SYNC_INTERVAL_MINUTES, 10)
      || (this.configManager.configTtlHours * 60);
    const intervalMs = Math.max(1, minutes) * 60 * 1000;
    if (this._modelSyncTimer) {
      clearInterval(this._modelSyncTimer);
    }
    this._modelSyncTimer = setInterval(async () => {
      try {
        console.log('⏱️  Scheduled model-info refresh starting...');
        await this.configManager.discoverProviders();
        await this.setupDynamicProviders();
        console.log('✅ Scheduled model-info refresh completed');
      } catch (error) {
        console.warn(`⚠️  Scheduled model-info refresh failed: ${error.message}`);
      }
    }, intervalMs);
    if (typeof this._modelSyncTimer.unref === 'function') {
      this._modelSyncTimer.unref();
    }
    console.log(`🗓️  Model-info auto-refresh scheduled every ${minutes} minute(s)`);
  }

  /**
   * Show provider configuration summary
   */
  displayProviderSummary(providers) {
    if (!providers || typeof providers !== 'object') {
      console.warn('⚠️  No providers configuration for summary display');
      return;
    }
    
    const enabled = Object.entries(providers).filter(([name, conf]) => conf.enabled);
    const local = enabled.filter(([name, conf]) => conf.local);
    const remote = enabled.filter(([name, conf]) => !conf.local);
    
    console.log('\n📊 Provider Configuration Summary:');
    console.log(`🔗 Remote providers (${remote.length}): ${remote.map(([name]) => name).join(', ')}`);
    console.log(`🏠 Local providers (${local.length}): ${local.map(([name]) => name).join(', ')}`);
    console.log(`💰 Total ${enabled.reduce((sum, [name, conf]) => sum + (conf.models?.length || 0), 0)}  available models`);
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers like onclick
          fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    
    // CORS
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
    }));

    // Request parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Serve static files for web UI. index:false so "/" is handled by
    // handleRoot (which content-negotiates between the dashboard and JSON info).
    this.app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per minute
      message: {
        error: 'Too many requests, please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(limiter);

    // Request logging
    this.app.use((req, res, next) => {
      const requestId = uuidv4();
      req.requestId = requestId;
      req.startTime = Date.now();
      
      console.log(`📨 ${req.method} ${req.path} [${requestId}]`);
      next();
    });
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // Claude Code compatible API endpoints
    this.app.post('/v1/messages', this.handleClaudeMessages.bind(this));
    this.app.post('/v1/chat/completions', this.handleClaudeChat.bind(this));
    this.app.post('/anthropic/v1/messages', this.handleClaudeMessages.bind(this));
    
    // Management endpoints
    this.app.get('/health', this.handleHealth.bind(this));
    this.app.get('/providers', this.handleProviders.bind(this));
    this.app.get('/providers/refresh', this.handleRefreshProviders.bind(this));
    this.app.get('/models', this.handleModels.bind(this));
    this.app.get('/models/catalog', this.handleModelCatalog.bind(this));
    this.app.get('/models/sync-status', this.handleModelSyncStatus.bind(this));
    this.app.get('/config', this.handleConfig.bind(this));
    this.app.get('/stats', this.handleStats.bind(this));
    
    // Model selection statistics interface
    this.app.get('/model-stats', (req, res) => {
      res.json({
        performance: this.modelSelector.getPerformanceStats(),
        capabilities: this.modelSelector.modelCapabilities,
        message: 'Intelligent model selection statistics'
      });
    });

    // Web UI Management APIs
    this.setupWebUIRoutes();
    
    // Root path
    this.app.get('/', this.handleRoot.bind(this));
  }

  /**
   * Handle Claude message requests
   */
  async handleClaudeMessages(req, res) {
    const requestId = req.requestId;
    
    try {
      console.log(`🤖 Handle Claude message requests [${requestId}]`);
      
      // Validate request format
      const validationErrors = this.claudeCompat.validateClaudeRequest(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: {
            type: 'invalid_request_error',
            message: validationErrors.join('; ')
          }
        });
      }

      // Get available providers and their models
      const availableProviders = await this.providerRouter.getHealthyProviders();
      
      // Extract user input for intelligent model selection
      const userInput = this.extractUserInput(req.body);
      const systemPrompt = req.body.system || '';
      
      // Get all available models from healthy providers
      const availableModels = await this.getAvailableModels(availableProviders);
      
      // Use intelligent model selection
      const modelSelection = this.modelSelector.selectBestModel(
        userInput, 
        systemPrompt, 
        availableModels,
        { prioritizeSpeed: false, prioritizeCost: true, prioritizeQuality: true }
      );
      
      // Find provider that has the selected model
      const provider = await this.findProviderForModel(modelSelection.selectedModel, availableProviders);
      console.log(`🎯 Selected provider: ${provider} [${requestId}]`);
      console.log(`🧠 Selected model: ${modelSelection.selectedModel} [${requestId}]`);
      
      // Record request
      this.providerRouter.recordRequest(provider);

      // Give reasoning models enough headroom so hidden reasoning tokens don't
      // consume the whole budget and leave an empty answer.
      if (typeof this.modelSelector.recommendMaxTokens === 'function' && req.body.max_tokens != null) {
        const effMax = this.modelSelector.recommendMaxTokens(modelSelection.selectedModel, req.body.max_tokens);
        if (effMax !== req.body.max_tokens) {
          console.log(`🧵 Reasoning headroom: max_tokens ${req.body.max_tokens} -> ${effMax} for ${modelSelection.selectedModel} [${requestId}]`);
          req.body.max_tokens = effMax;
        }
      }
      
      // Transform request format with selected model and intelligent token management
      const llmRequest = this.claudeCompat.toLLMInterface(
        req.body, 
        provider, 
        modelSelection.selectedModel,
        modelSelection.taskType || 'conversation',
        modelSelection.complexity || 'medium'
      );
      
      // Dispatch via the dynamic OpenRouter call layer
      console.log(`🚀 Sending request to ${provider} [${requestId}]`);
      const startTime = Date.now();
      
      let response;
      if (req.body.stream) {
        // Handle streaming response
        response = await this.handleStreamRequest(llmRequest, provider, res, requestId);
        return; // Streaming response returns directly
      } else {
        // Handle normal response via the configured call backend
        response = await this.dispatchCompletion(provider, llmRequest);
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Request completed ${provider} (${processingTime}ms) [${requestId}]`);
      
      // Transform back to Claude format
      const claudeResponse = this.claudeCompat.toClaudeFormat(response, provider, requestId);
      
      // Record response time
      this.logRequest(requestId, provider, processingTime, true);
      
      res.json(claudeResponse);
      
    } catch (error) {
      console.error(`❌ Request processing failed [${requestId}]:`, error);
      this.handleRequestError(error, res, requestId);
    }
  }

  /**
   * Dispatch a (non-streaming) completion through the dynamic OpenRouter layer.
   * @param {string} provider Selected provider (informational).
   * @param {object} llmRequest Transformed request (model, messages, params).
   * @returns {Promise<object>} OpenAI-compatible response.
   */
  async dispatchCompletion(provider, llmRequest) {
    if (!this.openRouterClient.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }
    return this.openRouterClient.chatCompletion({
      model: llmRequest.model,
      messages: llmRequest.messages,
      max_tokens: llmRequest.max_tokens,
      temperature: llmRequest.temperature,
      top_p: llmRequest.top_p,
      stop: llmRequest.stop
    });
  }

  /**
   * Handle streaming requests
   */
  async handleStreamRequest(llmRequest, provider, res, requestId) {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send start event
      res.write(`data: {"type": "message_start", "message": {"id": "${requestId}"}}\n\n`);

      if (!this.openRouterClient.isConfigured()) {
        throw new Error('OPENROUTER_API_KEY not configured');
      }
      const exposeReasoning = process.env.EXPOSE_REASONING === 'true';
      // Stream deltas from OpenRouter and re-emit as Claude deltas. When
      // EXPOSE_REASONING is on, reasoning tokens are emitted as thinking deltas.
      for await (const part of this.openRouterClient.streamCompletion({
        model: llmRequest.model,
        messages: llmRequest.messages,
        max_tokens: llmRequest.max_tokens,
        temperature: llmRequest.temperature,
        top_p: llmRequest.top_p,
        stop: llmRequest.stop
      }, { detailed: exposeReasoning })) {
        // In detailed mode parts are { content, reasoning }; otherwise a string.
        if (typeof part === 'string') {
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } })}\n\n`);
          continue;
        }
        if (part.reasoning) {
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', text: part.reasoning } })}\n\n`);
        }
        if (part.content) {
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part.content } })}\n\n`);
        }
      }
      
      // Send end event
      res.write(`data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      
    } catch (error) {
      console.error(`❌ Streaming request failed [${requestId}]:`, error);
      res.write(`data: {"type": "error", "error": {"message": "${error.message}"}}\n\n`);
      res.end();
    }
  }

  /**
   * Handle Claude chat completion requests
   */
  async handleClaudeChat(req, res) {
    // Convert chat completion format to message format
    const claudeRequest = {
      model: req.body.model || 'claude-3-sonnet',
      messages: req.body.messages || [],
      max_tokens: req.body.max_tokens || 1000,
      temperature: req.body.temperature || 0.7,
      stream: req.body.stream || false
    };
    
    // Reuse message processing logic
    req.body = claudeRequest;
    return this.handleClaudeMessages(req, res);
  }

  /**
   * Handle health check
   */
  async handleHealth(req, res) {
    try {
      const status = this.providerRouter.getProviderStatus();
      const healthyCount = Object.values(status).filter(p => p.healthy).length;
      const totalCount = Object.keys(status).length;
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        providers: {
          total: totalCount,
          healthy: healthyCount,
          unhealthy: totalCount - healthyCount
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: require('../package.json').version
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  }

  /**
   * Handle provider status requests
   */
  async handleProviders(req, res) {
    try {
      const status = this.providerRouter.getProviderStatus();
      res.json({
        providers: status,
        summary: {
          total: Object.keys(status).length,
          enabled: Object.values(status).filter(p => p.enabled).length,
          healthy: Object.values(status).filter(p => p.healthy).length
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle configuration refresh requests
   */
  async handleRefreshProviders(req, res) {
    try {
      console.log('🔄 Manually refreshellong provider configuration...');
      await this.configManager.discoverProviders();
      await this.setupDynamicProviders();
      
      res.json({
        success: true,
        message: 'Provider configuration refreshed',
        timestamp: new Date().toISOString(),
        total_providers: this.providers.size,
        model_sync: typeof this.configManager.getLastSyncInfo === 'function'
          ? this.configManager.getLastSyncInfo()
          : null
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle model list requests
   */
  async handleModels(req, res) {
    try {
      const models = [];
      const claudeModels = this.claudeCompat.getSupportedClaudeModels();
      
      for (const claudeModel of claudeModels) {
        models.push({
          id: claudeModel,
          object: 'model',
          created: Date.now(),
          owned_by: 'claude-llm-gateway',
          providers: this.claudeCompat.getProviderModels('openai') // example
        });
      }
      
      res.json({
        object: 'list',
        data: models
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle live model catalog requests. Returns the automatically synced model
   * information (from OpenRouter) grouped by provider, plus a flat model list.
   * Optional query: ?provider=openai to filter, ?flat=true to only return models.
   */
  async handleModelCatalog(req, res) {
    try {
      const config = await this.configManager.loadConfig();
      const providersOut = {};
      const flatModels = [];
      const filter = req.query.provider;

      if (config && config.providers) {
        for (const [name, entry] of Object.entries(config.providers)) {
          if (filter && name !== filter) {
            continue;
          }
          const details = Array.isArray(entry.model_details) ? entry.model_details : [];
          providersOut[name] = {
            model_source: entry.model_source || 'static',
            model_count: (entry.models || []).length,
            cost_per_1k_tokens: entry.cost_per_1k_tokens,
            capabilities: entry.capabilities || {},
            models: entry.models || [],
            model_details: details
          };
          flatModels.push(...details);
        }
      }

      res.json({
        source: config ? (config.model_source || 'static') : 'static',
        synced_at: config ? (config.openrouter_synced_at || null) : null,
        total_models: flatModels.length,
        providers: req.query.flat === 'true' ? undefined : providersOut,
        models: flatModels
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle model sync status requests. Reports where model information came from
   * (OpenRouter vs static), when it was last synced, and how many models exist.
   */
  async handleModelSyncStatus(req, res) {
    try {
      const config = await this.configManager.loadConfig();
      const lastSync = typeof this.configManager.getLastSyncInfo === 'function'
        ? this.configManager.getLastSyncInfo()
        : null;
      res.json({
        openrouter_sync_enabled: this.configManager.openRouterSyncEnabled !== false,
        last_sync: lastSync,
        config: config ? {
          model_source: config.model_source || 'static',
          openrouter_synced_at: config.openrouter_synced_at || null,
          openrouter_total_models: config.openrouter_total_models || 0,
          generated_at: config.generated_at || null,
          total_providers: config.total_providers || 0
        } : null,
        ttl_hours: this.configManager.configTtlHours
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle configuration requests
   */
  async handleConfig(req, res) {
    try {
      const config = await this.configManager.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle statistics requests
   */
  async handleStats(req, res) {
    try {
      const stats = this.providerRouter.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle root path requests
   */
  handleRoot(req, res) {
    // Serve the HTML dashboard only to browsers (which send Accept: text/html).
    // API clients and tests (no explicit html preference) get JSON gateway info.
    const acceptHeader = req.get('Accept') || '';
    if (acceptHeader.includes('text/html')) {
      const indexPath = path.join(__dirname, '..', 'public', 'index.html');
      return res.sendFile(indexPath);
    }

    return res.json({
      name: 'Claude LLM Gateway',
      version: require('../package.json').version,
      description: 'Multi-LLM API Gateway for Claude Code (dynamic OpenRouter backend)',
      endpoints: {
        messages: '/v1/messages',
        chat: '/v1/chat/completions',
        health: '/health',
        providers: '/providers',
        models: '/models',
        models_catalog: '/models/catalog',
        models_sync_status: '/models/sync-status',
        stats: '/stats'
      },
      providers: Array.from(this.providers.keys()),
      documentation: 'https://github.com/claude-llm-gateway'
    });
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // 404 handling
    this.app.use((req, res) => {
      res.status(404).json({
        error: {
          type: 'not_found',
          message: `Endpoint ${req.path} not found`
        }
      });
    });

    // Global error handling
    this.app.use((error, req, res, next) => {
      console.error('🚨 Unhandled error:', error);
      
      res.status(500).json({
        error: {
          type: 'internal_server_error',
          message: 'Internal server error',
          request_id: req.requestId
        }
      });
    });
  }

  /**
   * Handle request errors
   */
  handleRequestError(error, res, requestId) {
    let status = 500;
    let errorType = 'internal_server_error';
    let message = error.message;

    // Set status code based on error type
    if (error.message.includes('API key')) {
      status = 401;
      errorType = 'authentication_error';
    } else if (error.message.includes('rate limit')) {
      status = 429;
      errorType = 'rate_limit_error';
    } else if (error.message.includes('invalid')) {
      status = 400;
      errorType = 'invalid_request_error';
    }

    this.logRequest(requestId, 'error', Date.now(), false, error.message);

    res.status(status).json({
      error: {
        type: errorType,
        message: message,
        request_id: requestId
      }
    });
  }

  /**
   * Log request
   */
  logRequest(requestId, provider, duration, success, error = null) {
    this.requestLog.set(requestId, {
      timestamp: new Date().toISOString(),
      provider: provider,
      duration: duration,
      success: success,
      error: error
    });

    // Keep log size reasonable
    if (this.requestLog.size > 1000) {
      const oldestKey = this.requestLog.keys().next().value;
      this.requestLog.delete(oldestKey);
    }
  }

  /**
   * Start server
   */
  async start(port = null) {
    await this.initialize();

    // Keep model information fresh automatically in the background.
    this.startModelSyncScheduler();
    
    const serverPort = port || process.env.GATEWAY_PORT || 8765;
    const serverHost = process.env.GATEWAY_HOST || 'localhost';
    
    this.app.listen(serverPort, serverHost, () => {
      console.log(`\n🌐 Claude LLM Gateway started successfully!`);
      console.log(`📡 Service URL: http://${serverHost}:${serverPort}`);
      console.log(`🔗 Claude API: http://${serverHost}:${serverPort}/v1/messages`);
      console.log(`💬 Chat API: http://${serverHost}:${serverPort}/v1/chat/completions`);
      console.log(`📊 Health Check: http://${serverHost}:${serverPort}/health`);
      console.log(`🔧 Provider Status: http://${serverHost}:${serverPort}/providers`);
      console.log(`🔄 Refresh Config: http://${serverHost}:${serverPort}/providers/refresh`);
      console.log(`📈 Statistics: http://${serverHost}:${serverPort}/stats`);
    });
  }

  /**
   * Extract user input from Claude request
   */
  extractUserInput(claudeRequest) {
    if (!claudeRequest.messages || !Array.isArray(claudeRequest.messages)) {
      return '';
    }

    // Get the last user message
    const userMessage = claudeRequest.messages
      .filter(msg => msg.role === 'user')
      .pop();

    if (!userMessage) return '';

    // Handle different content formats
    if (typeof userMessage.content === 'string') {
      return userMessage.content;
    }

    if (Array.isArray(userMessage.content)) {
      return userMessage.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join(' ');
    }

    return '';
  }

  /**
   * Get all available models from healthy providers
   */
  async getAvailableModels(healthyProviders) {
    const allModels = [];
    const providerConfigs = await this.configManager.getConfig();

    healthyProviders.forEach(providerName => {
      const config = providerConfigs.providers[providerName];
      if (config && config.models) {
        allModels.push(...config.models);
      }
    });

    return [...new Set(allModels)]; // Remove duplicates
  }

  /**
   * Find provider that supports a specific model
   */
  async findProviderForModel(modelName, healthyProviders) {
    const providerConfigs = await this.configManager.getConfig();

    for (const providerName of healthyProviders) {
      const config = providerConfigs.providers[providerName];
      if (config && config.models && config.models.includes(modelName)) {
        return providerName;
      }
    }

    // Fallback to first healthy provider
    return healthyProviders[0] || 'deepseek';
  }

  /**
   * Setup Web UI management routes
   */
  setupWebUIRoutes() {
    // Provider management
    this.app.post('/providers/:name/toggle', this.handleToggleProvider.bind(this));
    this.app.post('/providers/:name/test', this.handleTestProvider.bind(this));
    this.app.post('/providers/test-all', this.handleTestAllProviders.bind(this));
    this.app.post('/providers/add', this.handleAddProvider.bind(this));
    this.app.delete('/providers/:name', this.handleDeleteProvider.bind(this));

    // Configuration management
    this.app.post('/config/environment', this.handleSaveEnvironment.bind(this));
    this.app.post('/config/gateway', this.handleSaveGatewaySettings.bind(this));
    this.app.post('/config/test-env', this.handleTestEnvironmentVariable.bind(this));
    this.app.get('/config/environment', this.handleGetEnvironment.bind(this));

    // Provider configuration
    this.app.get('/providers/:name/config', this.handleGetProviderConfig.bind(this));
    this.app.post('/providers/:name/config', this.handleSaveProviderConfig.bind(this));

    // Token management routes
    this.app.get('/tokens/limits', this.handleGetTokenLimits.bind(this));
    this.app.post('/tokens/analyze', this.handleAnalyzeTokens.bind(this));
    this.app.get('/tokens/stats', this.handleGetTokenStats.bind(this));
    this.app.post('/tokens/estimate', this.handleEstimateTokens.bind(this));
  }

  /**
   * Handle toggle provider status
   */
  async handleToggleProvider(req, res) {
    const { name } = req.params;
    const { enabled } = req.body;

    try {
      const config = await this.configManager.getConfig();
      if (!config.providers[name]) {
        return res.status(404).json({ error: 'Provider not found' });
      }

      config.providers[name].enabled = enabled;
      await this.configManager.saveConfig(config);
      
      // Reload provider router
      await this.providerRouter.initialize(config.providers);

      res.json({ 
        success: true, 
        message: `Provider ${name} ${enabled ? 'enabled' : 'disabled'}` 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle test single provider
   */
  async handleTestProvider(req, res) {
    const { name } = req.params;

    try {
      await this.providerRouter.checkProviderHealth(name);
      const health = this.providerRouter.healthStatus.get(name);
      
      res.json({
        success: health?.healthy || false,
        responseTime: health?.responseTime,
        error: health?.error
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  /**
   * Handle test all providers
   */
  async handleTestAllProviders(req, res) {
    try {
      await this.providerRouter.performHealthCheck();
      const results = {};
      
      this.providerRouter.healthStatus.forEach((health, name) => {
        results[name] = {
          healthy: health.healthy,
          responseTime: health.responseTime,
          error: health.error
        };
      });

      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle add new provider
   */
  async handleAddProvider(req, res) {
    const { name, apiKey, priority } = req.body;

    try {
      // Set environment variable
      process.env[`${name.toUpperCase()}_API_KEY`] = apiKey;

      // Refresh configuration
      await this.configManager.discoverProviders();
      const config = await this.configManager.getConfig();
      
      if (config.providers[name]) {
        config.providers[name].priority = priority || 10;
        await this.configManager.saveConfig(config);
        await this.providerRouter.initialize(config.providers);
      }

      res.json({ 
        success: true, 
        message: `Provider ${name} added successfully` 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle delete provider
   */
  async handleDeleteProvider(req, res) {
    const { name } = req.params;

    try {
      const config = await this.configManager.getConfig();
      if (config.providers[name]) {
        delete config.providers[name];
        await this.configManager.saveConfig(config);
        await this.providerRouter.initialize(config.providers);
      }

      res.json({ 
        success: true, 
        message: `Provider ${name} deleted successfully` 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle save environment variables
   */
  async handleSaveEnvironment(req, res) {
    try {
      const envVars = req.body;
      
      // Update environment variables
      Object.entries(envVars).forEach(([key, value]) => {
        if (value && value.trim()) {
          process.env[key] = value.trim();
        }
      });

      // Save to .env file
      const envPath = path.join(__dirname, '..', '.env');
      const envContent = Object.entries(envVars)
        .filter(([key, value]) => value && value.trim())
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      fs.writeFileSync(envPath, envContent);

      // Refresh provider configuration
      await this.configManager.discoverProviders();
      const config = await this.configManager.getConfig();
      await this.providerRouter.initialize(config.providers);

      res.json({ 
        success: true, 
        message: 'Environment variables saved successfully' 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle get environment variables
   */
  handleGetEnvironment(req, res) {
    const envVars = {};
    const envKeys = [
      'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 
      'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
      'MISTRAL_API_KEY', 'HUGGINGFACE_TOKEN', 'COHERE_API_KEY'
    ];

    envKeys.forEach(key => {
      envVars[key] = process.env[key] ? '••••••••' : '';
    });

    res.json(envVars);
  }

  /**
   * Handle save gateway settings
   */
  async handleSaveGatewaySettings(req, res) {
    try {
      const settings = req.body;
      
      // Update environment variables for gateway settings
      if (settings.port) process.env.GATEWAY_PORT = settings.port;
      if (settings.timeout) process.env.REQUEST_TIMEOUT = settings.timeout;
      if (settings.concurrency) process.env.CONCURRENCY_LIMIT = settings.concurrency;
      process.env.ENABLE_CORS = settings.cors ? 'true' : 'false';

      res.json({ 
        success: true, 
        message: 'Gateway settings saved successfully' 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle test environment variable
   */
  async handleTestEnvironmentVariable(req, res) {
    const { key, value } = req.body;

    try {
      // Temporarily set the environment variable
      const originalValue = process.env[key];
      process.env[key] = value;

      // Try to test the provider that uses this key
      const providerName = this.getProviderNameFromEnvKey(key);
      if (providerName) {
        await this.providerRouter.checkProviderHealth(providerName);
        const health = this.providerRouter.healthStatus.get(providerName);
        
        // Restore original value
        if (originalValue) {
          process.env[key] = originalValue;
        } else {
          delete process.env[key];
        }

        res.json({
          success: health?.healthy || false,
          responseTime: health?.responseTime,
          error: health?.error
        });
      } else {
        res.json({
          success: true,
          message: 'Environment variable format is valid'
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  /**
   * Handle get provider config
   */
  async handleGetProviderConfig(req, res) {
    const { name } = req.params;

    try {
      const config = await this.configManager.getConfig();
      const providerConfig = config.providers[name];
      
      if (!providerConfig) {
        return res.status(404).json({ error: 'Provider not found' });
      }

      res.json(providerConfig);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle save provider config
   */
  async handleSaveProviderConfig(req, res) {
    const { name } = req.params;
    const newConfig = req.body;

    try {
      const config = await this.configManager.getConfig();
      if (!config.providers[name]) {
        return res.status(404).json({ error: 'Provider not found' });
      }

      // Update provider configuration
      config.providers[name] = { ...config.providers[name], ...newConfig };
      await this.configManager.saveConfig(config);
      
      // Reload provider router
      await this.providerRouter.initialize(config.providers);

      res.json({ 
        success: true, 
        message: `Provider ${name} configuration updated` 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get provider name from environment key
   */
  getProviderNameFromEnvKey(envKey) {
    const keyMappings = {
      'DEEPSEEK_API_KEY': 'deepseek',
      'OPENAI_API_KEY': 'openai',
      'ANTHROPIC_API_KEY': 'anthropic',
      'GOOGLE_API_KEY': 'google',
      'GEMINI_API_KEY': 'google',
      'GROQ_API_KEY': 'groq',
      'MISTRAL_API_KEY': 'mistral',
      'HUGGINGFACE_TOKEN': 'huggingface',
      'COHERE_API_KEY': 'cohere'
    };
    
    return keyMappings[envKey];
  }

  /**
   * Handle get token limits for all providers
   */
  async handleGetTokenLimits(req, res) {
    try {
      const { provider } = req.query;
      
      if (provider) {
        // Get limits for specific provider
        const limits = this.claudeCompat.getProviderTokenLimits(provider);
        res.json({
          success: true,
          provider,
          limits
        });
      } else {
        // Get limits for all providers
        const allLimits = {};
        const providers = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'cohere', 'mistral', 'ollama', 'huggingface'];
        
        providers.forEach(p => {
          allLimits[p] = this.claudeCompat.getProviderTokenLimits(p);
        });
        
        res.json({
          success: true,
          limits: allLimits
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle analyze tokens for a request
   */
  async handleAnalyzeTokens(req, res) {
    try {
      const { claudeRequest, provider, model, taskType, taskComplexity } = req.body;
      
      if (!claudeRequest || !provider || !model) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: claudeRequest, provider, model'
        });
      }
      
      const analysis = this.claudeCompat.getTokenAllocationReport(
        claudeRequest,
        provider,
        model,
        taskType || 'conversation',
        taskComplexity || 'medium'
      );
      
      res.json({
        success: true,
        analysis
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle get token usage statistics
   */
  async handleGetTokenStats(req, res) {
    try {
      const stats = this.claudeCompat.tokenManager.getTokenUsageStats();
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle estimate tokens for text input
   */
  async handleEstimateTokens(req, res) {
    try {
      const { text, provider, model } = req.body;
      
      if (!text) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: text'
        });
      }
      
      const estimatedTokens = this.claudeCompat.tokenManager.estimateInputTokens(text);
      const limits = provider && model ? 
        this.claudeCompat.getProviderTokenLimits(provider, model) : 
        null;
      
      res.json({
        success: true,
        estimatedTokens,
        textLength: text.length,
        limits,
        recommendations: {
          conservative: Math.min(estimatedTokens * 2, 1024),
          recommended: Math.min(estimatedTokens * 3, 2048),
          generous: Math.min(estimatedTokens * 4, 4096)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

// Start server
if (require.main === module) {
  const gateway = new ClaudeLLMGateway();
  gateway.start().catch(error => {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  });
}

module.exports = ClaudeLLMGateway;
