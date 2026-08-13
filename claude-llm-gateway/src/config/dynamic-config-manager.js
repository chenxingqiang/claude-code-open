const {
    LLMInterface
} = require('llm-interface');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const OpenRouterModelSync = require('../openrouter-model-sync');

class DynamicConfigManager {
    constructor(options = {}) {
        this.configPath = path.join(__dirname, '../../config/providers.json');
        this.providersInfo = new Map();
        this.lastUpdate = null;
        // Automatic model-info sync from OpenRouter (enabled by default; opt out
        // by setting ENABLE_OPENROUTER_SYNC=false).
        this.openRouterSyncEnabled = options.openRouterSyncEnabled != null
            ? options.openRouterSyncEnabled
            : (process.env.ENABLE_OPENROUTER_SYNC || 'true').toLowerCase() !== 'false';
        this.openRouterSync = options.openRouterSync || new OpenRouterModelSync();
        // Cache of the most recent OpenRouter sync outcome for status reporting.
        this.lastSyncInfo = { source: 'static', synced_at: null, total_models: 0, ok: false };
        // Config freshness window (hours) before an automatic refresh is due.
        this.configTtlHours = options.configTtlHours
            || parseInt(process.env.MODEL_SYNC_TTL_HOURS, 10)
            || 24;
    } 

    /**
     * Best-effort fetch of the live OpenRouter model catalog. Never throws:
     * on failure it records the error and returns null so callers can fall back
     * to static provider defaults.
     * @returns {Promise<object|null>} catalog from OpenRouterModelSync, or null.
     */
    async fetchOpenRouterCatalog() {
        if (!this.openRouterSyncEnabled) {
            return null;
        }
        try {
            const catalog = await this.openRouterSync.buildProviderCatalog();
            this.lastSyncInfo = {
                source: 'openrouter',
                synced_at: catalog.fetched_at,
                total_models: catalog.total_models,
                ok: true
            };
            console.log(`🌐 OpenRouter sync: ${catalog.total_models} models across ${Object.keys(catalog.providers).length} providers`);
            return catalog;
        } catch (error) {
            this.lastSyncInfo = {
                source: 'static',
                synced_at: new Date().toISOString(),
                total_models: 0,
                ok: false,
                error: error.message
            };
            console.warn(`⚠️ OpenRouter sync failed, falling back to static model info: ${error.message}`);
            return null;
        }
    }

    /**
     * Return information about the most recent model-info sync.
     * @returns {{source: string, synced_at: string|null, total_models: number, ok: boolean, error?: string}}
     */
    getLastSyncInfo() {
        return this.lastSyncInfo;
    }

    /** 
     * 从llm-interface包动态获取所有支持的provider information 
     */
    async discoverProviders() {
        try {
            console.log('🔍 Discovering providers from llm-interface package...');
            // Pull the live OpenRouter model catalog once (best-effort). When it
            // succeeds it becomes the source of truth for model lists, pricing and
            // capabilities; otherwise we transparently fall back to static defaults.
            const catalog = await this.fetchOpenRouterCatalog();

            // 获取llm-interface支持的所有provider 
            const providers = this.getAvailableProviders();
            const providerConfig = {};
            
            for (const providerName of providers) {
                try {
                    // Try to get detailed information for each provider 
                    const providerInfo = await this.getProviderInfo(providerName);
                    providerConfig[providerName] = {
                        enabled: this.isProviderConfigured(providerName), 
                        priority: this.calculatePriority(providerName), 
                        models: providerInfo.models || [], 
                        capabilities: providerInfo.capabilities || {}, 
                        rate_limit: providerInfo.rate_limit || 60, 
                        cost_per_1k_tokens: providerInfo.cost_per_1k_tokens || 0.001, 
                        requires_api_key: providerInfo.requires_api_key !== false, 
                        local: providerInfo.local || false, 
                        streaming_support: providerInfo.streaming_support !== false, 
                        model_source: 'static',
                        last_updated: new Date().toISOString()
                    };
                    
                    // 确保model array不为空，如果为空则使用静态默认值 
                    if (!providerInfo.models || providerInfo.models.length === 0) {
                        const staticDefaults = this.getStaticProviderDetails(providerName);
                        providerConfig[providerName].models = staticDefaults.default_models || ['default-model'];
                    } 

                    // Overlay live OpenRouter data when available for this provider.
                    this.applyCatalogToProvider(providerConfig[providerName], providerName, catalog);
                    
                    console.log(`✅ Discovery provider: ${providerName} (${providerConfig[providerName].models?.length || 0} models, source=${providerConfig[providerName].model_source})`);
                } catch (error) {
                    console.warn(`⚠️ Skipping provider ${providerName}: ${error.message}`);
                }
            } 
            
            await this.saveConfig(providerConfig);
            this.lastUpdate = Date.now();
            console.log(`🎉 Successfully configured ${Object.keys(providerConfig).length} providers`);
            return providerConfig;
        } catch (error) {
            console.error('❌ Dynamic provider configuration failed:', error);
            throw error;
        }
    } 

    /**
     * Merge live OpenRouter catalog data into a provider config entry in place.
     * Only overrides model-derived fields (models, cost, capabilities, details)
     * and preserves gateway-specific fields (enabled, priority, rate_limit, etc.).
     * @param {object} entry Provider config entry to mutate.
     * @param {string} providerName Gateway provider slug.
     * @param {object|null} catalog Result of fetchOpenRouterCatalog().
     */
    applyCatalogToProvider(entry, providerName, catalog) {
        if (!catalog || !catalog.providers || !catalog.providers[providerName]) {
            return;
        }
        const info = catalog.providers[providerName];
        if (Array.isArray(info.models) && info.models.length > 0) {
            entry.models = info.models;
            entry.model_details = info.model_details;
            entry.model_source = 'openrouter';
            entry.openrouter_synced_at = catalog.fetched_at;
            if (Number.isFinite(info.cost_per_1k_tokens) && info.cost_per_1k_tokens > 0) {
                entry.cost_per_1k_tokens = info.cost_per_1k_tokens;
            }
            // Merge capability flags (union with any static capabilities).
            entry.capabilities = Object.assign({}, entry.capabilities, info.capabilities);
        }
    }

    /** 
     * 获取llm-interface包中所有可用的provider 
     */
    getAvailableProviders() {
        // From the list of 36 providers supported by llm-interface package 
        return [ 
            'openai', 'anthropic', 'google', 'cohere', 'huggingface', 'ollama', 
            'mistral', 'groq', 'perplexity', 'ai21', 'nvidia', 'fireworks', 
            'together', 'anyscale', 'deepseek', 'replicate', 'gooseai', 'forefront', 
            'writer', 'neets', 'lamini', 'hyperbee', 'novita', 'shuttle', 'theb', 
            'corcel', 'aimlapi', 'ailayer', 'monster', 'deepinfra', 'friendliai', 
            'reka', 'voyage', 'watsonx', 'zhellopu', 'llamacpp' 
        ];
    } 

    /** 
     * 获取特定provider的详细信息 
     */
    async getProviderInfo(providerName) {
        try {
            // 根据provider type返回相应的配置信息 
            const providerDetails = this.getStaticProviderDetails(providerName);
            // 尝试获取支持的model list 
            let models = [];
            
            try {
                // 某些provider可能有API来获取model list 
                models = await this.getProviderModels(providerName);
            } catch (error) {
                // If unable to get dynamically, use static list 
                models = providerDetails.default_models || [];
            } 
            
            return {
                ...providerDetails, 
                models: models
            };
        } catch (error) {
            throw new Error(`无法获取provider ${providerName} information: ${error.message}`);
        }
    } 

    /** 
     * 获取provider的静态详细信息 
     */
    getStaticProviderDetails(providerName) {
        const providerDetails = {
            'openai': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.03, 
                rate_limit: 60, 
                default_models: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4o'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true, 
                    embeddings: true
                }
            }, 
            'anthropic': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.015, 
                rate_limit: 50, 
                default_models: ['claude-3-sonnet', 'claude-3-haiku', 'claude-3-opus'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'google': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.001, 
                rate_limit: 100, 
                default_models: ['gemini-pro', 'gemini-flash', 'gemini-ultra'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true, 
                    vision: true
                }
            }, 
            'ollama': {
                requires_api_key: false, 
                local: true, 
                cost_per_1k_tokens: 0.0, 
                rate_limit: 1000, 
                default_models: ['llama2', 'codellama', 'mistral', 'vicuna'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'cohere': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.02, 
                rate_limit: 40, 
                default_models: ['command-r-plus', 'command', 'command-light'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true, 
                    embeddings: true
                }
            }, 
            'huggingface': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.001, 
                rate_limit: 30, 
                default_models: ['microsoft/DialoGPT-large', 'microsoft/DialoGPT-medium'], 
                streaming_support: false, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'mistral': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.025, 
                rate_limit: 50, 
                default_models: ['mistral-large', 'mistral-medium', 'mistral-small'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'groq': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.001, 
                rate_limit: 30, 
                default_models: ['llama2-70b-4096', 'mixtral-8x7b-32768'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'perplexity': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.02, 
                rate_limit: 20, 
                default_models: ['pplx-7b-online', 'pplx-70b-online', 'pplx-7b-chat', 'pplx-70b-chat'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'ai21': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.025, 
                rate_limit: 20, 
                default_models: ['j2-ultra', 'j2-mid', 'j2-light'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'nvidia': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.015, 
                rate_limit: 30, 
                default_models: ['nv-llama2-70b', 'nv-code-llama-70b'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'fireworks': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.002, 
                rate_limit: 40, 
                default_models: ['llama-v2-7b-chat', 'llama-v2-13b-chat', 'llama-v2-70b-chat'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'together': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.002, 
                rate_limit: 40, 
                default_models: ['togethercomputer/llama-2-7b-chat', 'togethercomputer/llama-2-13b-chat', 'togethercomputer/llama-2-70b-chat'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'anyscale': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.001, 
                rate_limit: 50, 
                default_models: ['meta-llama/Llama-2-7b-chat-hf', 'meta-llama/Llama-2-13b-chat-hf', 'meta-llama/Llama-2-70b-chat-hf'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'deepseek': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.001, 
                rate_limit: 30, 
                default_models: ['deepseek-chat', 'deepseek-coder'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'replicate': {
                requires_api_key: true, 
                local: false, 
                cost_per_1k_tokens: 0.005, 
                rate_limit: 20, 
                default_models: ['llama-2-70b-chat', 'llama-2-13b-chat', 'llama-2-7b-chat'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }, 
            'llamacpp': {
                requires_api_key: false, 
                local: true, 
                cost_per_1k_tokens: 0.0, 
                rate_limit: 1000, 
                default_models: ['llama-2-7b-chat', 'llama-2-13b-chat', 'codellama-7b-instruct'], 
                streaming_support: true, 
                capabilities: {
                    chat: true, 
                    completion: true
                }
            }
        };
        
        return providerDetails[providerName] || {
            requires_api_key: true, 
            local: false, 
            cost_per_1k_tokens: 0.01, 
            rate_limit: 30, 
            default_models: ['default-model'], 
            streaming_support: true, 
            capabilities: {
                chat: true, 
                completion: true
            }
        };
    } 

    /** 
     * 尝试动态获取provider支持的model list 
     */
    async getProviderModels(providerName) {
        // 首先获取静态默认model list作为备用 
        const staticDetails = this.getStaticProviderDetails(providerName);
        const defaultModels = staticDetails.default_models || [];
        
        // 对于某些provider，我们可以尝试调用其API获取model list 
        try {
            switch (providerName) {
                case 'openai': 
                    const openaiModels = await this.getOpenAIModels();
                    return openaiModels.length > 0 ? openaiModels : defaultModels;
                case 'ollama': 
                    const ollamaModels = await this.getOllamaModels();
                    return ollamaModels.length > 0 ? ollamaModels : defaultModels;
                default: 
                    // 对于其他provider，直接返回静态默认model list 
                    return defaultModels;
            }
        } catch (error) {
            console.warn(`Failed to get dynamic models for ${providerName}, using defaults: ${error.message}`);
            return defaultModels;
        }
    } 

    async getOpenAIModels() {
        try {
            // 如果有OpenAI API key，尝试获取model list 
            if (process.env.OPENAI_API_KEY) {
                // 这里可以调用OpenAI API获取model list 
                // 为了简化，我们返回常用model 
                return ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4o'];
            }
        } catch (error) {
            console.warn('无法动态获取OpenAI model list，使用默认列表');
        } 
        return ['gpt-4', 'gpt-3.5-turbo'];
    } 

    async getOllamaModels() {
        try {
            // 尝试连接本地Ollama服务获取model list 
            const response = await fetch('http://localhost:11434/api/tags');
            if (response.ok) {
                const data = await response.json();
                return data.models?.map(model => model.name) || [];
            }
        } catch (error) {
            console.warn('Unable to connect to local Ollama service, using default model list');
        } 
        return ['llama2', 'codellama', 'mistral'];
    } 

    /** 
     * 检查provider是否已配置（有API key等） 
     */
    isProviderConfigured(providerName) {
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
            'deepseek': 'DEEPSEEK_API_KEY', 
            'replicate': 'REPLICATE_API_KEY', 
            'anyscale': 'ANYSCALE_API_KEY', 
            'ollama': 'OLLAMA_AVAILABLE', // local service check 
            'llamacpp': 'LLAMACPP_AVAILABLE'
        };
        
        const envVar = envVars[providerName];
        if (!envVar) return false;
        
        if (providerName === 'ollama') {
            // For Ollama, check if local service is available 
            return this.checkOllamaAvailability();
        } 
        
        if (providerName === 'llamacpp') {
            // For LLaMA.CPP, check if local service is available 
            return this.checkLlamaCppAvailability();
        } 
        
        return !!process.env[envVar];
    } 

    async checkOllamaAvailability() {
        try {
            const response = await fetch('http://localhost:11434/api/version', {
                method: 'GET', 
                timeout: 5000
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    } 

    async checkLlamaCppAvailability() {
        try {
            const baseUrl = process.env.LLAMACPP_BASE_URL || 'http://localhost:8080';
            const response = await fetch(`${baseUrl}/health`, {
                method: 'GET', 
                timeout: 5000
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    } 

    /** 
     * 根据provider特性计算优先级 
     */
    calculatePriority(providerName) {
        const priorities = {
            'deepseek': 1, // User specially configured, highest priority 
            'openai': 2, // Most stable, but higher cost 
            'anthropic': 3, // high quality 
            'google': 4, // good cost-effectiveness 
            'ollama': 5, // local deployment, no cost 
            'cohere': 6, // professional API 
            'mistral': 7, // open source friendly 
            'groq': 8, // high-speed inference 
            'huggingface': 9 // open source models
        };
        return priorities[providerName] || 10;
    } 

    /** 
     * Save configuration to file 
     */
    async saveConfig(config) {
        try {
            const configDir = path.dirname(this.configPath);
            await fs.mkdir(configDir, {
                recursive: true
            });
            
            const configData = {
                generated_at: new Date().toISOString(), 
                llm_interface_version: await this.getLLMInterfaceVersion(), 
                model_source: this.lastSyncInfo && this.lastSyncInfo.ok ? 'openrouter' : 'static',
                openrouter_synced_at: this.lastSyncInfo ? this.lastSyncInfo.synced_at : null,
                openrouter_total_models: this.lastSyncInfo ? this.lastSyncInfo.total_models : 0,
                total_providers: Object.keys(config).length, 
                enabled_providers: Object.values(config).filter(p => p.enabled).length, 
                providers: config
            };
            
            await fs.writeFile(this.configPath, JSON.stringify(configData, null, 2));
            console.log(`💾 Configuration saved to: ${this.configPath}`);
        } catch (error) {
            console.error('❌ Failed to save configuration:', error);
            throw error;
        }
    } 

    /** 
     * Get llm-interface package version 
     */
    async getLLMInterfaceVersion() {
        try {
            const packagePath = require.resolve('llm-interface/package.json');
            const packageData = JSON.parse(await fs.readFile(packagePath, 'utf8'));
            return packageData.version;
        } catch (error) {
            return 'unknown';
        }
    } 

    /** 
     * Load existing configuration 
     */
    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.log('📝 Configuration file does not exist, will create new configuration');
            return null;
        }
    } 

    /** 
     * Check if configuration needs updating 
     */
    async shouldUpdateConfig() {
        const existingConfig = await this.loadConfig();
        if (!existingConfig) return true;
        
        // Check if configuration is expired (e.g., over 24 hours) 
        const configAge = Date.now() - new Date(existingConfig.generated_at).getTime();
        const maxAge = this.configTtlHours * 60 * 60 * 1000;
        return configAge > maxAge;
    } 

    /** 
     * Get current configuration 
     */
    async getConfig() {
        return await this.loadConfig();
    } 
}

module.exports = DynamicConfigManager;