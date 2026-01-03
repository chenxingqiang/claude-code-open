// Global state
let providers = {};
let stats = {};
let modelStats = {};
let logs = [];
let currentLanguage = localStorage.getItem('language') || 'zh';

// Internationalization (i18n) texts
const i18n = {
    zh: {
        // Navigation tabs
        providers: 'Provider 管理',
        configuration: '配置',
        apiEndpoints: 'API 端点',
        intelligentSelection: '智能选择',
        realTimeLogs: '实时日志',
        
        // Provider Management
        providerConfiguration: 'Provider 配置',
        testAll: '测试全部',
        addProvider: '添加 Provider',
        configure: '配置',
        test: '测试',
        healthy: '健康',
        unhealthy: '不健康',
        noApiKey: '无API密钥',
        unreachable: '不可达',
        rateLimited: '频率限制',
        
        // Configuration
        environmentVariables: '环境变量',
        gatewaySettings: '网关设置',
        saveSettings: '保存设置',
        
        // Model Stats
        modelPerformanceStats: '模型性能统计',
        modelCapabilityMatrix: '模型能力矩阵',
        noPerformanceData: '暂无性能数据，需要一些API调用后才会显示性能统计信息',
        noModelCapabilityData: '暂无模型能力数据',
        strengths: '优势',
        weaknesses: '弱势',
        speed: '速度',
        cost: '成本',
        quality: '质量',
        successRate: '成功率',
        responseTime: '响应时间',
        
        // API Info
        gatewayServiceUrls: '网关服务 URLs',
        claudeApiEndpoints: 'Claude API 端点',
        serviceUrl: '服务 URL',
        healthCheck: '健康检查',
        providersStatus: 'Providers 状态',
        configurationEndpoint: '配置端点',
        
        // Logs
        clearLogs: '清除日志',
        
        // Notifications
        testing: '正在测试',
        testingAllProviders: '正在测试所有提供者...',
        testSuccess: '测试成功',
        testFailed: '测试失败',
        allProvidersTestComplete: '所有提供者测试完成',
        batchTestFailed: '批量测试失败',
        configureProvider: '请在配置标签页中配置',
        apiKey: '的API密钥',
        
        // Common
        save: '保存',
        cancel: '取消',
        close: '关闭',
        loading: '加载中...',
        error: '错误',
        success: '成功',
        warning: '警告',
        info: '信息',
        refreshStatus: '刷新状态',
        requestCount: '请求数',
        responseTime: '响应时间',
        costPer1KTokens: '成本/1K tokens',
        models: '模型',
        noModels: '无模型',
        moreModels: '个',
        
        // Capability translations
        coding: '编程',
        analysis: '分析',
        creative: '创作',
        translation: '翻译',
        conversation: '对话',
        reasoning: '推理',
        multimodal: '多模态',
        long_context: '长文本',
        chinese: '中文',
        multilingual: '多语言',
        retrieval: '检索',
        humor: '幽默',
        
        // Speed translations
        very_fast: '非常快',
        fast: '快',
        medium: '中等',
        slow: '慢',
        
        // Cost translations
        very_low: '非常低',
        low: '低',
        high: '高',
        very_high: '非常高',
        
        // Quality translations
        very_high: '非常高',
        high: '高',
        
        // Priority translations
        priorityHigh: '高',
        priorityMedium: '中',
        priorityLow: '低',
        
        // Action messages
        enabled: '已启用',
        disabled: '已禁用',
        toggleProviderFailed: '切换提供者状态失败',
        fillAllFields: '请填写所有必填字段',
        addProviderFailed: '添加提供者失败',
        addedSuccessfully: '添加成功',
        envVarsSaved: '环境变量已保存',
        saveEnvVarsFailed: '保存环境变量失败',
        gatewaySettingsSaved: '网关设置已保存',
        saveGatewaySettingsFailed: '保存网关设置失败',
        enterApiKeyFirst: '请先输入API密钥',
        validationSuccess: '验证成功',
        validationFailed: '验证失败',
        refreshing: '正在刷新...',
        refreshComplete: '刷新完成',
        apiRequestFailed: 'API请求失败',
        lastUpdated: '最后更新'
    },
    en: {
        // Navigation tabs
        providers: 'Provider Management',
        configuration: 'Configuration',
        apiEndpoints: 'API Endpoints',
        intelligentSelection: 'Intelligent Selection',
        realTimeLogs: 'Real-time Logs',
        
        // Provider Management
        providerConfiguration: 'Provider Configuration',
        testAll: 'Test All',
        addProvider: 'Add Provider',
        configure: 'Configure',
        test: 'Test',
        healthy: 'Healthy',
        unhealthy: 'Unhealthy',
        noApiKey: 'No API Key',
        unreachable: 'Unreachable',
        rateLimited: 'Rate Limited',
        
        // Configuration
        environmentVariables: 'Environment Variables',
        gatewaySettings: 'Gateway Settings',
        saveSettings: 'Save Settings',
        
        // Model Stats
        modelPerformanceStats: 'Model Performance Statistics',
        modelCapabilityMatrix: 'Model Capability Matrix',
        noPerformanceData: 'No performance data available. Statistics will be displayed after some API calls.',
        noModelCapabilityData: 'No model capability data available',
        strengths: 'Strengths',
        weaknesses: 'Weaknesses',
        speed: 'Speed',
        cost: 'Cost',
        quality: 'Quality',
        successRate: 'Success Rate',
        responseTime: 'Response Time',
        
        // API Info
        gatewayServiceUrls: 'Gateway Service URLs',
        claudeApiEndpoints: 'Claude API Endpoints',
        serviceUrl: 'Service URL',
        healthCheck: 'Health Check',
        providersStatus: 'Providers Status',
        configurationEndpoint: 'Configuration',
        
        // Logs
        clearLogs: 'Clear Logs',
        
        // Notifications
        testing: 'Testing',
        testingAllProviders: 'Testing all providers...',
        testSuccess: 'Test successful',
        testFailed: 'Test failed',
        allProvidersTestComplete: 'All providers test complete',
        batchTestFailed: 'Batch test failed',
        configureProvider: 'Please configure',
        apiKey: 'API key in the configuration tab',
        
        // Common
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
        warning: 'Warning',
        info: 'Info',
        refreshStatus: 'Refresh Status',
        requestCount: 'Requests',
        responseTime: 'Response Time',
        costPer1KTokens: 'Cost/1K tokens',
        models: 'Models',
        noModels: 'No Models',
        moreModels: ' more',
        
        // Capability translations
        coding: 'Coding',
        analysis: 'Analysis',
        creative: 'Creative',
        translation: 'Translation',
        conversation: 'Conversation',
        reasoning: 'Reasoning',
        multimodal: 'Multimodal',
        long_context: 'Long Context',
        chinese: 'Chinese',
        multilingual: 'Multilingual',
        retrieval: 'Retrieval',
        humor: 'Humor',
        
        // Speed translations
        very_fast: 'Very Fast',
        fast: 'Fast',
        medium: 'Medium',
        slow: 'Slow',
        
        // Cost translations
        very_low: 'Very Low',
        low: 'Low',
        high: 'High',
        very_high: 'Very High',
        
        // Quality translations
        very_high: 'Very High',
        high: 'High',
        
        // Priority translations
        priorityHigh: 'High',
        priorityMedium: 'Medium',
        priorityLow: 'Low',
        
        // Action messages
        enabled: 'enabled',
        disabled: 'disabled',
        toggleProviderFailed: 'Failed to toggle provider',
        fillAllFields: 'Please fill all required fields',
        addProviderFailed: 'Failed to add provider',
        addedSuccessfully: 'added successfully',
        envVarsSaved: 'Environment variables saved',
        saveEnvVarsFailed: 'Failed to save environment variables',
        gatewaySettingsSaved: 'Gateway settings saved',
        saveGatewaySettingsFailed: 'Failed to save gateway settings',
        enterApiKeyFirst: 'Please enter API key first',
        validationSuccess: 'Validation successful',
        validationFailed: 'Validation failed',
        refreshing: 'Refreshing...',
        refreshComplete: 'Refresh complete',
        apiRequestFailed: 'API request failed',
        lastUpdated: 'Last updated'
    }
};

// Get translated text
function t(key) {
    const keys = key.split('.');
    let value = i18n[currentLanguage];
    for (const k of keys) {
        value = value && value[k];
    }
    return value || key;
}

// Language switching function
function switchLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('language', lang);
    updateLanguageButtons();
    updateLanguageDisplay();
    loadDashboard(); // Reload to apply translations
}

// Update language display
function updateLanguageDisplay() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = t(key);
    });
    
    // Force re-render of current tab content
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab) {
        const tabName = activeTab.id.replace('-tab', '');
        if (tabName === 'models') {
            renderModelStats();
        } else if (tabName === 'config') {
            renderEnvironmentVariables();
        } else if (tabName === 'api-info') {
            loadApiInfo();
        }
    }
    
    renderProviders(); // Re-render providers with new language
}

// Update language buttons state
function updateLanguageButtons() {
    // Reset all buttons
    document.querySelectorAll('#lang-zh, #lang-en').forEach(btn => {
        btn.classList.remove('bg-white', 'text-blue-600', 'shadow-sm');
        btn.classList.add('text-gray-500', 'hover:text-gray-700');
    });
    
    // Highlight current language
    const activeBtn = document.getElementById(`lang-${currentLanguage}`);
    if (activeBtn) {
        activeBtn.classList.remove('text-gray-500', 'hover:text-gray-700');
        activeBtn.classList.add('bg-white', 'text-blue-600', 'shadow-sm');
    }
}

// Environment variables configuration
const envVariableConfigs = {
    'DEEPSEEK_API_KEY': { label: 'DeepSeek API Key', provider: 'deepseek', type: 'password' },
    'OPENAI_API_KEY': { label: 'OpenAI API Key', provider: 'openai', type: 'password' },
    'ANTHROPIC_API_KEY': { label: 'Anthropic API Key', provider: 'anthropic', type: 'password' },
    'GOOGLE_API_KEY': { label: 'Google API Key', provider: 'google', type: 'password' },
    'GEMINI_API_KEY': { label: 'Gemini API Key', provider: 'google', type: 'password' },
    'GROQ_API_KEY': { label: 'Groq API Key', provider: 'groq', type: 'password' },
    'MISTRAL_API_KEY': { label: 'Mistral API Key', provider: 'mistral', type: 'password' },
    'HUGGINGFACE_TOKEN': { label: 'Hugging Face Token', provider: 'huggingface', type: 'password' },
    'COHERE_API_KEY': { label: 'Cohere API Key', provider: 'cohere', type: 'password' },
    'QIANWEN_API_KEY': { label: 'Qianwen API Key', provider: 'qianwen', type: 'password' },
    'ZHIPU_API_KEY': { label: 'Zhipu API Key', provider: 'zhipu', type: 'password' },
    'OPENROUTER_API_KEY': { label: 'OpenRouter API Key', provider: 'openrouter', type: 'password' },
    'VOLCENGINE_API_KEY': { label: 'VolcEngine API Key', provider: 'volcengine', type: 'password' },
    'BAIDU_LLM_KEY': { label: 'Baidu LLM Key', provider: 'baidu', type: 'password' },
    'GROK_API_KEY': { label: 'Grok API Key', provider: 'grok', type: 'password' },
    'FINNHUB_API_KEY': { label: 'Finnhub API Key', provider: 'finnhub', type: 'password' },
    'ALPHAGENOME_API_KEY': { label: 'AlphaGenome API Key', provider: 'alphagenome', type: 'password' },
    'SERPAPI_KEY': { label: 'SerpAPI Key', provider: 'serpapi', type: 'password' },
    'PEXELS_API_KEY': { label: 'Pexels API Key', provider: 'pexels', type: 'password' },
    'PAPER_WITH_CODE_TOCKEN': { label: 'Papers With Code Token', provider: 'paperswithcode', type: 'password' },
    'MOONSHOT_API_KEY': { label: 'Moonshot API Key', provider: 'moonshot', type: 'password' },
    'MOONSHOT_BASE_URL': { label: 'Moonshot Base URL', provider: 'moonshot', type: 'url' },
    'OPENAI_BASE_URL': { label: 'OpenAI Base URL', provider: 'openai', type: 'url' },
    'ANTHROPIC_BASE_URL': { label: 'Anthropic Base URL', provider: 'anthropic', type: 'url' }
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    // Add global error handler
    window.addEventListener('error', function(e) {
        console.error('Global JavaScript error:', e.error);
    });
    
    // Test if functions are available globally
    console.log('testAllProviders function available:', typeof testAllProviders);
    console.log('configureProvider function available:', typeof configureProvider);
    console.log('showTab function available:', typeof showTab);
    
    // Initialize language
    updateLanguageDisplay();
    updateLanguageButtons();
    
    loadDashboard();
    setInterval(loadDashboard, 30000); // Refresh every 30 seconds
});

// API functions
async function apiRequest(endpoint, options = {}) {
    try {
        // Use gateway port 8765 for API requests
        const gatewayUrl = 'http://localhost:8765';
        const fullUrl = endpoint.startsWith('http') ? endpoint : `${gatewayUrl}${endpoint}`;
        
        const response = await fetch(fullUrl, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Request failed:', error);
        showNotification(t('apiRequestFailed') + ': ' + error.message, 'error');
        throw error;
    }
}

async function loadProviders() {
    try {
        const data = await apiRequest('/providers');
        providers = data.providers;
        stats = data.summary;
        return data;
    } catch (error) {
        console.error('Failed to load providers:', error);
    }
}

async function loadModelStats() {
    try {
        const data = await apiRequest('/model-stats');
        modelStats = data;
        return data;
    } catch (error) {
        console.error('Failed to load model stats:', error);
    }
}

async function loadGatewayStats() {
    try {
        const data = await apiRequest('/stats');
        return data;
    } catch (error) {
        console.error('Failed to load gateway stats:', error);
    }
}

// Dashboard functions
async function loadDashboard() {
    try {
        const [providerData, modelData, gatewayData] = await Promise.all([
            loadProviders(),
            loadModelStats(),
            loadGatewayStats()
        ]);

        updateStatsOverview(providerData, gatewayData);
        renderProviders();
        renderModelStats();
        updateLastUpdateTime();
    } catch (error) {
        console.error('Failed to load dashboard:', error);
    }
}

function updateStatsOverview(providerData, gatewayData) {
    if (providerData) {
        document.getElementById('healthy-count').textContent = providerData.summary.healthy;
        document.getElementById('total-count').textContent = providerData.summary.total;
        
        // Count total models
        let totalModels = 0;
        Object.values(providerData.providers).forEach(provider => {
            if (provider.models) {
                totalModels += provider.models.length;
            }
        });
        document.getElementById('models-count').textContent = totalModels;
    }
    
    if (gatewayData) {
        document.getElementById('requests-count').textContent = gatewayData.total_requests || 0;
    }
}

function renderProviders() {
    const grid = document.getElementById('providers-grid');
    if (!grid || !providers) return;

    grid.innerHTML = '';

    Object.entries(providers).forEach(([name, provider]) => {
        const card = createProviderCard(name, provider);
        grid.appendChild(card);
    });
}

function createProviderCard(name, provider) {
    const div = document.createElement('div');
    div.className = 'provider-card bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow';

    const statusClass = provider.healthy ? 'healthy' : 'unhealthy';
    const statusText = provider.healthy ? t('healthy') : t('unhealthy');
    const statusIcon = provider.healthy ? 'fas fa-check-circle text-green-500' : 'fas fa-exclamation-circle text-red-500';

    const priorityBadge = getPriorityBadge(provider.priority);
    const modelsList = provider.models ? provider.models.slice(0, 3).join(', ') : t('noModels');
    const moreModels = provider.models && provider.models.length > 3 ? ` +${provider.models.length - 3}${t('moreModels')}` : '';

    div.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <div class="flex items-center">
                <div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mr-3">
                    <i class="fas fa-server text-gray-600"></i>
                </div>
                <div>
                    <h3 class="text-lg font-medium text-gray-900">${name}</h3>
                    <div class="flex items-center text-sm text-gray-500">
                        <span class="status-dot ${statusClass}"></span>
                        ${statusText}
                    </div>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                ${priorityBadge}
                <label class="toggle-switch">
                    <input type="checkbox" ${provider.enabled ? 'checked' : ''} 
                           onchange="toggleProvider('${name}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div class="space-y-2 text-sm text-gray-600">
            <div class="flex justify-between">
                <span>${t('requestCount')}:</span>
                <span class="font-medium">${provider.request_count || 0}</span>
            </div>
            <div class="flex justify-between">
                <span>${t('responseTime')}:</span>
                <span class="font-medium">${provider.response_time || 'N/A'}</span>
            </div>
            <div class="flex justify-between">
                <span>${t('costPer1KTokens')}:</span>
                <span class="font-medium">$${(provider.cost_per_1k_tokens || 0).toFixed(4)}</span>
            </div>
            <div class="mt-3">
                <span class="text-xs font-medium text-gray-500">${t('models')}:</span>
                <p class="text-xs text-gray-600 mt-1">${modelsList}${moreModels}</p>
            </div>
        </div>

        <div class="mt-4 flex space-x-2">
            <button onclick="testProvider('${name}')" 
                    class="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded text-sm font-medium">
                <i class="fas fa-flask mr-1"></i>${t('test')}
            </button>
            <button onclick="configureProvider('${name}')" 
                    class="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 px-3 py-2 rounded text-sm font-medium">
                <i class="fas fa-cog mr-1"></i>${t('configure')}
            </button>
        </div>

        ${provider.error ? `
            <div class="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                ${provider.error}
            </div>
        ` : ''}
    `;

    return div;
}

function getPriorityBadge(priority) {
    let badgeClass, textKey;
    if (priority <= 3) {
        badgeClass = 'bg-green-100 text-green-800';
        textKey = 'priorityHigh';
    } else if (priority <= 6) {
        badgeClass = 'bg-yellow-100 text-yellow-800';
        textKey = 'priorityMedium';
    } else {
        badgeClass = 'bg-gray-100 text-gray-800';
        textKey = 'priorityLow';
    }
    
    return `<span class="px-2 py-1 ${badgeClass} text-xs rounded-full">${t(textKey)}</span>`;
}

function renderModelStats() {
    const container = document.getElementById('model-stats');
    if (!container) return;

    container.innerHTML = '';

    // Performance stats
    const perfDiv = document.createElement('div');
    const perfEntries = Object.entries(modelStats.performance || {});
    
    if (perfEntries.length > 0) {
        perfDiv.innerHTML = `
            <h3 class="text-lg font-medium text-gray-900 mb-4">📊 ${t('modelPerformanceStats')}</h3>
            <div class="space-y-3">
                ${perfEntries.map(([model, perf]) => `
                    <div class="flex justify-between items-center p-3 bg-gray-50 rounded">
                        <span class="font-medium">${model}</span>
                        <div class="text-sm text-gray-600">
                            ${t('successRate')}: ${perf.successRate} | ${t('responseTime')}: ${perf.avgResponseTime}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        perfDiv.innerHTML = `
            <h3 class="text-lg font-medium text-gray-900 mb-4">📊 ${t('modelPerformanceStats')}</h3>
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div class="flex items-center">
                    <i class="fas fa-info-circle text-blue-500 mr-2"></i>
                    <span class="text-blue-700">${t('noPerformanceData')}</span>
                </div>
            </div>
        `;
    }

    // Capabilities
    const capDiv = document.createElement('div');
    if (modelStats.capabilities && Object.keys(modelStats.capabilities).length > 0) {
        capDiv.innerHTML = `
            <h3 class="text-lg font-medium text-gray-900 mb-4">🧠 ${t('modelCapabilityMatrix')}</h3>
            <div class="space-y-3">
                ${Object.entries(modelStats.capabilities).map(([model, caps]) => `
                    <div class="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                        <div class="flex justify-between items-center mb-3">
                            <div class="font-medium text-gray-900">${model}</div>
                            <div class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium">
                                ${caps.baseScore}/100
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span class="text-gray-500">✅ ${t('strengths')}:</span>
                                <div class="ml-2 text-green-600 mt-1">
                                    ${caps.strengths.map(s => `<span class="inline-block bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs mr-1 mb-1">${t(s) || s}</span>`).join('')}
                                </div>
                            </div>
                            <div>
                                <span class="text-gray-500">❌ ${t('weaknesses')}:</span>
                                <div class="ml-2 text-red-600 mt-1">
                                    ${caps.weaknesses.map(w => `<span class="inline-block bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs mr-1 mb-1">${t(w) || w}</span>`).join('')}
                                </div>
                            </div>
                            <div>
                                <span class="text-gray-500">⚡ ${t('speed')}:</span>
                                <span class="ml-2">${t(caps.speed) || caps.speed}</span>
                            </div>
                            <div>
                                <span class="text-gray-500">💰 ${t('cost')}:</span>
                                <span class="ml-2">${t(caps.cost) || caps.cost}</span>
                            </div>
                            <div>
                                <span class="text-gray-500">🎯 ${t('quality')}:</span>
                                <span class="ml-2">${t(caps.quality) || caps.quality}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
        </div>
    `;
    } else {
        capDiv.innerHTML = `
            <h3 class="text-lg font-medium text-gray-900 mb-4">🧠 ${t('modelCapabilityMatrix')}</h3>
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div class="flex items-center">
                    <i class="fas fa-info-circle text-gray-500 mr-2"></i>
                    <span class="text-gray-600">${t('noModelCapabilityData')}</span>
                </div>
            </div>
        `;
    }

    container.appendChild(perfDiv);
    container.appendChild(capDiv);
}

function renderEnvironmentVariables() {
    const container = document.getElementById('env-variables');
    if (!container) return;

    container.innerHTML = Object.entries(envVariableConfigs).map(([key, config]) => `
        <div class="space-y-2" data-env-key="${key}">
            <label class="block text-sm font-medium text-gray-700">${config.label}</label>
            <div class="flex space-x-2">
                <input type="${config.type}" 
                       id="env-${key}" 
                       placeholder="输入${config.label}..."
                       class="api-key-input flex-1 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                <button onclick="testEnvVariable('${key}')" 
                        class="bg-green-50 hover:bg-green-100 text-green-700 px-3 py-2 rounded text-sm" 
                        title="测试此API密钥">
                    <i class="fas fa-flask"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Tab functions
function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // Remove active state from all tabs
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active', 'border-blue-500', 'text-blue-600');
        button.classList.add('border-transparent', 'text-gray-500');
    });

    // Show selected tab content
    document.getElementById(`${tabName}-content`).classList.remove('hidden');

    // Add active state to selected tab
    const activeTab = document.getElementById(`${tabName}-tab`);
    activeTab.classList.add('active', 'border-blue-500', 'text-blue-600');
    activeTab.classList.remove('border-transparent', 'text-gray-500');

    // Load tab-specific content
    if (tabName === 'config') {
        renderEnvironmentVariables();
    } else if (tabName === 'api-info') {
        loadApiInfo();
    } else if (tabName === 'models') {
        renderModelStats();
    } else if (tabName === 'logs') {
        startLogStreaming();
    }
}

// API Info functions
function loadApiInfo() {
    // Use gateway port 8765 for API endpoints
    const gatewayUrl = 'http://localhost:8765';
    const webUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port}`;
    
    // Update all URL elements to show gateway URLs
    document.getElementById('service-url').textContent = gatewayUrl;
    document.getElementById('health-url').textContent = `${gatewayUrl}/health`;
    document.getElementById('providers-url').textContent = `${gatewayUrl}/providers`;
    document.getElementById('config-url').textContent = `${gatewayUrl}/providers/refresh`;
    document.getElementById('messages-url').textContent = `${gatewayUrl}/v1/messages`;
    document.getElementById('chat-url').textContent = `${gatewayUrl}/v1/chat/completions`;
    document.getElementById('token-stats-url').textContent = `${gatewayUrl}/tokens/stats`;
    document.getElementById('token-limits-url').textContent = `${gatewayUrl}/tokens/limits`;
    document.getElementById('token-estimate-url').textContent = `${gatewayUrl}/tokens/estimate`;
    document.getElementById('token-analysis-url').textContent = `${gatewayUrl}/tokens/analyze`;
    
    // Update code examples to use gateway URL
    const codeBlocks = document.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
        block.textContent = block.textContent.replace(/http:\/\/localhost:\d+/g, gatewayUrl);
    });
}

// Provider management functions
async function toggleProvider(name, enabled) {
    try {
        const response = await apiRequest(`/providers/${name}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
        
        showNotification(`${name} ${enabled ? t('enabled') : t('disabled')}`, 'success');
        loadDashboard();
    } catch (error) {
        showNotification(t('toggleProviderFailed'), 'error');
    }
}

async function testProvider(name) {
    showNotification(`${t('testing')} ${name}...`, 'info');
    
    try {
        const response = await apiRequest(`/providers/${name}/test`, {
            method: 'POST'
        });
        
        if (response.success) {
            showNotification(`${name} ${t('testSuccess')}`, 'success');
        } else {
            showNotification(`${name} ${t('testFailed')}: ${response.error}`, 'error');
        }
        
        loadDashboard();
    } catch (error) {
        showNotification(`${name} ${t('testFailed')}`, 'error');
    }
}

async function testAllProviders() {
    console.log('testAllProviders called');
    showNotification(t('testingAllProviders'), 'info');
    
    try {
        console.log('Making API request to /providers/test-all');
        const response = await apiRequest('/providers/test-all', {
            method: 'POST'
        });
        console.log('API response:', response);
        
        showNotification(t('allProvidersTestComplete'), 'success');
        loadDashboard();
    } catch (error) {
        console.error('testAllProviders error:', error);
        showNotification(`${t('batchTestFailed')}: ${error.message}`, 'error');
    }
}

function configureProvider(name) {
    console.log('configureProvider called for:', name);
    
    // Switch to config tab
    showTab('config');
    
    // Show notification about where to configure
    showNotification(`${t('configureProvider')} ${name} ${t('apiKey')}`, 'info');
    
    // Scroll to the relevant environment variable if it exists
    const envKeyMap = {
        'openai': 'OPENAI_API_KEY',
        'anthropic': 'ANTHROPIC_API_KEY', 
        'google': 'GOOGLE_API_KEY',
        'groq': 'GROQ_API_KEY',
        'mistral': 'MISTRAL_API_KEY',
        'deepseek': 'DEEPSEEK_API_KEY',
        'huggingface': 'HUGGINGFACE_TOKEN',
        'cohere': 'COHERE_API_KEY'
    };
    
    const envKey = envKeyMap[name];
    if (envKey) {
        setTimeout(() => {
            const element = document.querySelector(`[data-env-key="${envKey}"]`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.style.backgroundColor = '#fef3c7';
                setTimeout(() => {
                    element.style.backgroundColor = '';
                }, 3000);
            }
        }, 500);
    }
}

// Modal functions
function showAddProviderModal() {
    document.getElementById('add-provider-modal').classList.remove('hidden');
}

function closeAddProviderModal() {
    document.getElementById('add-provider-modal').classList.add('hidden');
    // Clear form
    document.getElementById('new-provider-name').value = '';
    document.getElementById('new-provider-key').value = '';
    document.getElementById('new-provider-priority').value = '10';
}

async function addProvider() {
    const name = document.getElementById('new-provider-name').value;
    const key = document.getElementById('new-provider-key').value;
    const priority = document.getElementById('new-provider-priority').value;

    if (!name || !key) {
        showNotification(t('fillAllFields'), 'error');
        return;
    }

    try {
        await apiRequest('/providers/add', {
            method: 'POST',
            body: JSON.stringify({
                name,
                apiKey: key,
                priority: parseInt(priority)
            })
        });
        
        showNotification(`${name} ${t('addedSuccessfully')}`, 'success');
        closeAddProviderModal();
        loadDashboard();
    } catch (error) {
        showNotification(t('addProviderFailed'), 'error');
    }
}

// Configuration functions
async function saveEnvironmentVariables() {
    const envVars = {};
    
    Object.keys(envVariableConfigs).forEach(key => {
        const input = document.getElementById(`env-${key}`);
        if (input && input.value.trim()) {
            envVars[key] = input.value.trim();
        }
    });

    try {
        await apiRequest('/config/environment', {
            method: 'POST',
            body: JSON.stringify(envVars)
        });
        
        showNotification(t('envVarsSaved'), 'success');
        loadDashboard();
    } catch (error) {
        showNotification(t('saveEnvVarsFailed'), 'error');
    }
}

async function saveGatewaySettings() {
    const settings = {
        port: document.getElementById('gateway-port').value,
        timeout: document.getElementById('request-timeout').value,
        concurrency: document.getElementById('concurrency-limit').value,
        cors: document.getElementById('enable-cors').checked
    };

    try {
        await apiRequest('/config/gateway', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        
        showNotification(t('gatewaySettingsSaved'), 'success');
    } catch (error) {
        showNotification(t('saveGatewaySettingsFailed'), 'error');
    }
}

async function testEnvVariable(key) {
    const input = document.getElementById(`env-${key}`);
    const value = input.value.trim();
    
    if (!value) {
        showNotification(t('enterApiKeyFirst'), 'error');
        return;
    }

    try {
        const response = await apiRequest('/config/test-env', {
            method: 'POST',
            body: JSON.stringify({ key, value })
        });
        
        if (response.success) {
            showNotification(`${key} ${t('validationSuccess')}`, 'success');
        } else {
            showNotification(`${key} ${t('validationFailed')}`, 'error');
        }
    } catch (error) {
        showNotification(t('validationFailed'), 'error');
    }
}

// Refresh functions
async function refreshAll() {
    showNotification(t('refreshing'), 'info');
    await loadDashboard();
    showNotification(t('refreshComplete'), 'success');
}

// Log functions
function startLogStreaming() {
    // Simulate log streaming (in a real implementation, this would use WebSockets)
    if (window.logInterval) {
        clearInterval(window.logInterval);
    }
    
    window.logInterval = setInterval(updateLogs, 2000);
}

function updateLogs() {
    const logContainer = document.getElementById('log-content');
    const autoScroll = document.getElementById('auto-scroll').checked;
    
    // Simulate new logs
    const newLog = `[${new Date().toISOString()}] [INFO] Gateway status: ${Object.keys(providers || {}).length} providers active`;
    logs.push(newLog);
    
    // Keep only last 100 logs
    if (logs.length > 100) {
        logs = logs.slice(-100);
    }
    
    logContainer.innerHTML = logs.join('\n');
    
    if (autoScroll) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

function clearLogs() {
    logs = [];
    document.getElementById('log-content').innerHTML = '';
}

// Utility functions
function updateLastUpdateTime() {
    document.getElementById('last-update').textContent = 
        `${t('lastUpdated')}: ${new Date().toLocaleTimeString()}`;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    const bgColor = {
        'success': 'bg-green-500',
        'error': 'bg-red-500',
        'info': 'bg-blue-500',
        'warning': 'bg-yellow-500'
    }[type] || 'bg-blue-500';
    
    notification.className = `fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-full`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.classList.add('translate-x-full');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}
