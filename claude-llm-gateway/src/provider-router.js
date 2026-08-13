const { LLMInterface } = require('llm-interface');

class ProviderRouter {
  constructor() {
    this.providerConfig = new Map();
    this.healthStatus = new Map();
    this.requestCounts = new Map();
    this.lastHealthCheck = null;
    this.roundRobinIndex = 0;
    // Call backend that drives health semantics ('llm-interface' | 'openrouter').
    this.callBackend = 'llm-interface';
    this.openRouterClient = null;
  }

  /**
   * Configure which call backend health checks should reflect.
   * @param {string} backend 'openrouter' | 'llm-interface'
   * @param {object} [openRouterClient] client exposing isConfigured().
   */
  setCallBackend(backend, openRouterClient = null) {
    this.callBackend = (backend || 'llm-interface').toLowerCase();
    this.openRouterClient = openRouterClient;
  }

  /**
   * Initialize provider configuration
   */
  async initialize(providers) {
    if (!providers || typeof providers !== 'object') {
      console.warn('⚠️  No providers configuration found in ProviderRouter');
      this.providerConfig = new Map();
      return;
    }
    
    this.providerConfig = new Map(Object.entries(providers));
    
    // Initialize request count
    for (const providerName of this.providerConfig.keys()) {
      this.requestCounts.set(providerName, 0);
    }

    // Start health checks. Skipped under test so manually-set health status
    // (via setProviderHealth) is not clobbered by background ping attempts.
    if (process.env.NODE_ENV !== 'test') {
      await this.startHealthChecks();
    }
    
    console.log(`🚀 Provider router initialization completed, supporting ${this.providerConfig.size} providers`);
  }

  /**
   * Select best provider
   */
  async selectProvider(request, options = {}) {
    try {
      // 1. Check if specific provider is specified
      if (options.preferredProvider) {
        const provider = options.preferredProvider;
        if (this.isProviderHealthy(provider)) {
          console.log(`🎯 Using specified provider: ${provider}`);
          return provider;
        }
      }

      // 2. Select provider based on model type
      const modelBasedProvider = this.selectByModel(request.model);
      if (modelBasedProvider && this.isProviderHealthy(modelBasedProvider)) {
        console.log(`🎯 Provider selected based on model: ${modelBasedProvider} (model: ${request.model})`);
        return modelBasedProvider;
      }

      // 3. Get healthy provider list
      const healthyProviders = this.getHealthyProviders();
      if (healthyProviders.length === 0) {
        throw new Error('No healthy providers available');
      }

      // 4. Select based on load balancing strategy
      const selectedProvider = this.loadBalance(healthyProviders, options.strategy);
      
      console.log(`⚖️ Load balancer selected provider: ${selectedProvider}`);
      return selectedProvider;

    } catch (error) {
      console.error('❌ Provider selection failed:', error);
      // Return default provider as last resort
      return this.getDefaultProvider();
    }
  }

  /**
   * Select provider based on model type
   */
  selectByModel(model) {
    if (!model) return null;

    // 1. Prefer an enabled provider whose configured model pool contains the
    //    exact model id (keeps routing aligned with the live/synced catalog).
    for (const [providerName, config] of this.providerConfig.entries()) {
      if (config.enabled && Array.isArray(config.models) && config.models.includes(model)) {
        return providerName;
      }
    }

    // 2. Fall back to generic vendor heuristics by model-name substring.
    const modelLower = model.toLowerCase();

    // OpenAI model
    if (modelLower.includes('gpt')) {
      return 'openai';
    }

    // Google model
    if (modelLower.includes('gemini')) {
      return 'google';
    }

    // Anthropic model
    if (modelLower.includes('claude')) {
      return 'anthropic';
    }

    // Mistral model
    if (modelLower.includes('mistral')) {
      return 'mistral';
    }

    // Ollama local model
    if (modelLower.includes('llama') || modelLower.includes('codellama')) {
      return 'ollama';
    }

    // Cohere model
    if (modelLower.includes('command')) {
      return 'cohere';
    }

    return null;
  }

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(providerName) {
    const status = this.healthStatus.get(providerName);
    if (!status) return false;

    // Check health status and last check time
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const isRecent = (Date.now() - status.lastCheck) < maxAge;
    
    return status.healthy && isRecent;
  }

  /**
   * Load balancing algorithm
   */
  loadBalance(providers, strategy = 'priority') {
    if (providers.length === 0) {
      throw new Error('No available providers');
    }

    if (providers.length === 1) {
      return providers[0];
    }

    switch (strategy) {
      case 'round_robin':
        return this.roundRobinBalance(providers);
      
      case 'least_requests':
        return this.leastRequestsBalance(providers);
      
      case 'cost_optimized':
        return this.costOptimizedBalance(providers);
      
      case 'random':
        return providers[Math.floor(Math.random() * providers.length)];
      
      case 'priority':
      default:
        return this.priorityBalance(providers);
    }
  }

  /**
   * Round-robin load balancing
   */
  roundRobinBalance(providers) {
    const provider = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex++;
    return provider;
  }

  /**
   * Least requests load balancing
   */
  leastRequestsBalance(providers) {
    let minRequests = Infinity;
    let selectedProvider = providers[0];

    for (const provider of providers) {
      const requestCount = this.requestCounts.get(provider) || 0;
      if (requestCount < minRequests) {
        minRequests = requestCount;
        selectedProvider = provider;
      }
    }

    return selectedProvider;
  }

  /**
   * Cost-optimized load balancing
   */
  costOptimizedBalance(providers) {
    // Sort by cost, select lowest cost available provider
    const sortedByCost = providers.sort((a, b) => {
      const costA = this.providerConfig.get(a)?.cost_per_1k_tokens || 0;
      const costB = this.providerConfig.get(b)?.cost_per_1k_tokens || 0;
      return costA - costB;
    });

    return sortedByCost[0];
  }

  /**
   * Priority-based load balancing
   */
  priorityBalance(providers) {
    // providers are already sorted by priority, return the first one
    return providers[0];
  }

  /**
   * Record request
   */
  recordRequest(provider) {
    const currentCount = this.requestCounts.get(provider) || 0;
    this.requestCounts.set(provider, currentCount + 1);
  }

  /**
   * Get default provider
   */
  getDefaultProvider() {
    // Return the highest-priority provider that is both enabled and healthy.
    const enabledHealthy = Array.from(this.providerConfig.entries())
      .filter(([name, config]) => config.enabled && this.isProviderHealthy(name))
      .sort((a, b) => (a[1].priority || 10) - (b[1].priority || 10));

    if (enabledHealthy.length > 0) {
      return enabledHealthy[0][0];
    }

    // if no enabled+healthy providers, return openai as the ultimate default
    return 'openai';
  }

  /**
   * Start health checks
   */
  async startHealthChecks() {
    console.log('🔍 Starting provider health checks...');
    
    // Perform health check immediately
    await this.performHealthCheck();
    
    // Set up periodic health checks
    setInterval(async () => {
      await this.performHealthCheck();
    }, 30000); // check every 30 seconds
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const enabledProviders = Array.from(this.providerConfig.entries())
      .filter(([name, config]) => config.enabled)
      .map(([name]) => name);

    console.log(`🩺 Performing health check (${enabledProviders.length} providers)...`);

    for (const provider of enabledProviders) {
      try {
        await this.checkProviderHealth(provider);
      } catch (error) {
        console.warn(`⚠️  Provider ${provider} health check failed: ${error.message}`);
      }
    }

    this.lastHealthCheck = Date.now();
  }

  /**
   * Check individual provider health status
   */
  async checkProviderHealth(provider) {
    // Dynamic backend: health reflects the single OpenRouter dependency rather
    // than a per-vendor ping. A provider is usable when OPENROUTER_API_KEY is set.
    if (this.callBackend === 'openrouter') {
      const configured = this.openRouterClient && this.openRouterClient.isConfigured();
      this.healthStatus.set(provider, {
        healthy: !!configured,
        lastCheck: Date.now(),
        responseTime: 0,
        error: configured ? null : 'OPENROUTER_API_KEY not configured',
        status: configured ? 'openrouter' : 'no_api_key'
      });
      return;
    }

    try {
      const startTime = Date.now();
      
      // Send simple ping request
      const testMessage = 'ping';
      const response = await LLMInterface.sendMessage(provider, testMessage, {
        max_tokens: 5,
        timeout: 10000 // 10 seconds timeout
      });

      const responseTime = Date.now() - startTime;

      // Record health status
      this.healthStatus.set(provider, {
        healthy: true,
        lastCheck: Date.now(),
        responseTime: responseTime,
        error: null
      });

      console.log(`✅ ${provider}: healthy (${responseTime}ms)`);

    } catch (error) {
      // Determine error type and provide friendly message
      let status = 'unhealthy';
      let friendlyMessage = error.message;
      
      // Check for authentication/API key errors
      if (error.message.includes('HTTP 401') || error.message.includes('HTTP 403') || 
          error.message.includes('Unauthorized') || error.message.includes('Forbidden') ||
          error.message.includes('API key not found') || error.message.includes('Invalid API key') ||
          error.message.includes('Authentication failed') || error.message.includes('Access denied')) {
        status = 'no_api_key';
        friendlyMessage = 'API key not configured or invalid';
      } 
      // Check for network/connection errors
      else if (error.message.includes('HTTP 404') || error.message.includes('Not Found') ||
               error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND') ||
               error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) {
        status = 'unreachable';
        friendlyMessage = 'Service unavailable or not configured';
      }
      // Check for rate limiting
      else if (error.message.includes('HTTP 429') || error.message.includes('Rate limit') ||
               error.message.includes('Too many requests')) {
        status = 'rate_limited';
        friendlyMessage = 'Rate limit exceeded';
      }
      
      // Record status with friendly message
      this.healthStatus.set(provider, {
        healthy: false,
        lastCheck: Date.now(),
        responseTime: null,
        error: friendlyMessage,
        status: status
      });

      // Display appropriate emoji and message
      const emoji = status === 'no_api_key' ? '🔑' : 
                    status === 'unreachable' ? '🔌' : 
                    status === 'rate_limited' ? '⏳' : '❌';
      
      console.log(`${emoji} ${provider}: ${friendlyMessage}`);
    }
  }

  /**
   * Get all provider status
   */
  getProviderStatus() {
    const status = {};
    
    for (const [providerName, config] of this.providerConfig.entries()) {
      const health = this.healthStatus.get(providerName);
      const requests = this.requestCounts.get(providerName) || 0;
      
      status[providerName] = {
        enabled: config.enabled,
        priority: config.priority,
        healthy: health?.healthy || false,
        status_type: health?.status || 'unknown',
        last_check: health?.lastCheck || null,
        response_time: health?.responseTime || null,
        error: health?.error || null,
        request_count: requests,
        models: config.models || [],
        local: config.local || false,
        cost_per_1k_tokens: config.cost_per_1k_tokens || 0
      };
    }
    
    return status;
  }

  /**
   * Manually set provider health status
   */
  setProviderHealth(provider, healthy, error = null) {
    this.healthStatus.set(provider, {
      healthy: healthy,
      lastCheck: Date.now(),
      responseTime: null,
      error: error
    });
  }

  /**
   * Reset provider statistics
   */
  resetStats() {
    this.requestCounts.clear();
    this.roundRobinIndex = 0;
    console.log('📊 Provider statistics reset');
  }

  /**
   * Get load balancing statistics
   */
  getStats() {
    const totalRequests = Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
    const healthyCount = Array.from(this.healthStatus.values()).filter(status => status.healthy).length;
    const totalProviders = this.providerConfig.size;

    return {
      total_requests: totalRequests,
      healthy_providers: healthyCount,
      total_providers: totalProviders,
      last_health_check: this.lastHealthCheck,
      request_distribution: Object.fromEntries(this.requestCounts),
      round_robin_index: this.roundRobinIndex
    };
  }

  /**
   * Get list of healthy providers
   */
  getHealthyProviders() {
    const healthyProviders = [];
    
    this.providerConfig.forEach((config, provider) => {
      const health = this.healthStatus.get(provider);
      if (config.enabled && health && health.healthy) {
        healthyProviders.push(provider);
      }
    });
    
    // Sort by priority (lower numbers = hellogher priority)
    healthyProviders.sort((a, b) => {
      const priorityA = this.providerConfig.get(a)?.priority || 999;
      const priorityB = this.providerConfig.get(b)?.priority || 999;
      return priorityA - priorityB;
    });
    
    return healthyProviders;
  }
}

module.exports = ProviderRouter;
