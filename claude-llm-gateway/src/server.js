const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { LLMInterface } = require('llm-interface');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DynamicConfigManager = require('./config/dynamic-config-manager');
const ClaudeCompatibility = require('./claude-compatibility');
const ProviderRouter = require('./provider-router');
const IntelligentModelSelector = require('./intelligent-model-selector');

class ClaudeLLMGateway {
  constructor() {
    this.app = express();
    this.configManager = new DynamicConfigManager();
    this.claudeCompat = new ClaudeCompatibility();
    this.providerRouter = new ProviderRouter();
    this.modelSelector = new IntelligentModelSelector();
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
      
      // Set API keys
      const apiKeys = this.extractApiKeys(config.providers);
      LLMInterface.setApiKey(apiKeys);
      
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
      
      // Show configuration summary
      this.displayProviderSummary(config.providers);
      
    } catch (error) {
      console.error('❌ Dynamic provider configuration failed:', error);
      throw error;
    }
  }

  /**
   * Extract API keys
   */
  extractApiKeys(providers) {
    const apiKeys = {};
    
    if (!providers || typeof providers !== 'object') {
      console.warn('⚠️  No providers configuration found');
      return apiKeys;
    }
    
    for (const [name, config] of Object.entries(providers)) {
      if (config.enabled && config.requires_api_key) {
        const envVar = this.getApiKeyEnvVar(name);
        if (process.env[envVar]) {
          apiKeys[name] = process.env[envVar];
        }
      } else if (!config.requires_api_key) {
        // For providers that don't require API keys (like Ollama)
        apiKeys[name] = 'local';
      }
    }
    
    return apiKeys;
  }

  /**
   * Get API key environment variable name
   */
  getApiKeyEnvVar(providerName) {
    const envVars = {
      'openai': 'OPENAI_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'google': 'GOOGLE_API_KEY',
      'cohere': 'COHERE_API_KEY',
      'huggingface': 'HUGGINGFACE_API_KEY',
      'mistral': 'MISTRAL_API_KEY',
      'groq': 'GROQ_API_KEY',
      'perplexity': 'PERPLEXITY_API_KEY',
      'ai21': 'AI21_API_KEY',
      'nvidia': 'NVIDIA_API_KEY',
      'fireworks': 'FIREWORKS_API_KEY',
      'together': 'TOGETHER_API_KEY',
      'replicate': 'REPLICATE_API_KEY'
    };
    
    return envVars[providerName] || `${providerName.toUpperCase()}_API_KEY`;
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
    
    // Serve static files for web UI
    this.app.use(express.static(path.join(__dirname, '..', 'public')));

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
      
      // Transform request format with selected model and intelligent token management
      const llmRequest = this.claudeCompat.toLLMInterface(
        req.body, 
        provider, 
        modelSelection.selectedModel,
        modelSelection.taskType || 'conversation',
        modelSelection.complexity || 'medium'
      );
      
      // Call llm-interface
      console.log(`🚀 Sending request to ${provider} [${requestId}]`);
      const startTime = Date.now();
      
      let response;
      if (req.body.stream) {
        // Handle streaming response
        response = await this.handleStreamRequest(llmRequest, provider, res, requestId);
        return; // Streaming response returns directly
      } else {
        // Handle normal response
        response = await LLMInterface.sendMessage(provider, llmRequest);
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
   * Handle streaming requests
   */
  async handleStreamRequest(llmRequest, provider, res, requestId) {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send start event
      res.write(`data: {"type": "message_start", "message": {"id": "${requestId}"}}\n\n`);
      
      // Use llm-interface streaming functionality
      const stream = await LLMInterface.sendMessage(provider, {
        ...llmRequest,
        stream: true
      });
      
      // Handle streaming response
      for await (const chunk of stream) {
        const claudeChunk = this.claudeCompat.convertStreamResponse(chunk, provider);
        res.write(claudeChunk);
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
        total_providers: this.providers.size
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
    // Check Accept header to determine response type
    const acceptHeader = req.get('Accept') || '';
    
    // If client explicitly requests JSON or is an API client
    if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
      return res.json({
        name: 'Claude LLM Gateway',
        version: require('../package.json').version,
        description: 'Multi-LLM API Gateway for Claude Code using llm-interface',
        endpoints: {
          messages: '/v1/messages',
          chat: '/v1/chat/completions',
          health: '/health',
          providers: '/providers',
          models: '/models',
          stats: '/stats'
        },
        providers: Array.from(this.providers.keys()),
        documentation: 'https://github.com/claude-llm-gateway'
      });
    }
    
    // For browser requests, serve the HTML dashboard
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    res.sendFile(indexPath);
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
