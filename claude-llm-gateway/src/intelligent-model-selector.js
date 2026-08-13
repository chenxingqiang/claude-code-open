/**
 * Intelligent Model Selector
 * Automatically selects the best model based on task type, performance metrics, and user requirements
 */

class IntelligentModelSelector {
    constructor() {
        this.modelPerformance = new Map();
        this.taskPatterns = this.initializeTaskPatterns();
        this.modelCapabilities = this.initializeModelCapabilities();
        this.modelAliases = this.initializeModelAliases();
        this.modelPricing = this.initializeModelPricing();
        this.priorityMode = 'balanced'; // 'speed', 'quality', 'cost', 'balanced'
        this.loadPerformanceData();
    }

    /**
     * Merge live pricing from an OpenRouter catalog into modelPricing so cost
     * estimation stays current without manual edits. Purely additive: existing
     * hardcoded entries are only overwritten for keys present in the catalog.
     * @param {Array<object>} normalizedModels Models from OpenRouterModelSync.buildProviderCatalog().models
     * @returns {number} number of pricing entries added or updated.
     */
    applyOpenRouterPricing(normalizedModels) {
        if (!Array.isArray(normalizedModels)) {
            return 0;
        }
        let updated = 0;
        for (const model of normalizedModels) {
            if (!model || !model.pricing) {
                continue;
            }
            const prompt = parseFloat(model.pricing.prompt);
            const completion = parseFloat(model.pricing.completion);
            if (!Number.isFinite(prompt) && !Number.isFinite(completion)) {
                continue;
            }
            // OpenRouter prices are per token; modelPricing uses USD per 1M tokens.
            const entry = {
                input: Number.isFinite(prompt) ? Math.round(prompt * 1e6 * 1e4) / 1e4 : 0,
                output: Number.isFinite(completion) ? Math.round(completion * 1e6 * 1e4) / 1e4 : 0
            };
            // Key by full id, canonical slug and short slug so lookups by any of
            // these forms resolve to live pricing.
            const keys = new Set([model.id, model.canonical_slug, model.short_slug].filter(Boolean));
            for (const key of keys) {
                this.modelPricing[key] = entry;
                updated += 1;
            }
        }
        return updated;
    }

    /**
     * Initialize task detection patterns
     * Enhanced with: math, agentic, vision, audio, reasoning task types
     */
    initializeTaskPatterns() {
        return {
            coding: {
                keywords: [
                    'write code', 'programming', 'function', 'algorithm', 'code', 'script', 'debug', 
                    'API', 'interface', 'class', 'method', 'variable', 'bug', 'error',
                    'python', 'javascript', 'java', 'golang', 'rust', 'cpp', 'c++',
                    'html', 'css', 'sql', 'bash', 'shell', 'regex', 'typescript',
                    'react', 'vue', 'angular', 'node', 'django', 'flask', 'spring',
                    'git', 'docker', 'kubernetes', 'aws', 'azure', 'gcp'
                ],
                patterns: [
                    /write.*?code|implement.*?function/i,
                    /develop.*?system|build.*?application/i,
                    /fix.*?bug|solve.*?problem/i,
                    /optimize.*?code|refactor.*?code/i,
                    /design.*?algorithm|implement.*?algorithm/i,
                    /create.*?api|build.*?endpoint/i,
                    /unit.*?test|integration.*?test/i
                ],
                weight: 0.8
            },
            math: {
                keywords: [
                    'math', 'mathematics', 'calculate', 'equation', 'formula', 'theorem',
                    'algebra', 'calculus', 'geometry', 'trigonometry', 'statistics',
                    'probability', 'integral', 'derivative', 'matrix', 'vector',
                    'solve', 'proof', 'compute', 'numerical', 'mathematical'
                ],
                patterns: [
                    /solve.*?equation|calculate.*?value/i,
                    /prove.*?theorem|mathematical.*?proof/i,
                    /integral.*?of|derivative.*?of/i,
                    /probability.*?of|statistics.*?analysis/i,
                    /\d+\s*[\+\-\*\/\^]\s*\d+/i
                ],
                weight: 0.85
            },
            reasoning: {
                keywords: [
                    'reason', 'reasoning', 'logic', 'logical', 'deduce', 'infer',
                    'conclude', 'think', 'step by step', 'chain of thought',
                    'analyze', 'evaluate', 'assess', 'determine', 'figure out'
                ],
                patterns: [
                    /step.*?by.*?step|think.*?through/i,
                    /logical.*?analysis|reason.*?about/i,
                    /what.*?would.*?happen|if.*?then/i,
                    /why.*?does|how.*?come/i
                ],
                weight: 0.75
            },
            agentic: {
                keywords: [
                    'agent', 'autonomous', 'automate', 'workflow', 'pipeline',
                    'execute', 'run', 'perform', 'task', 'action', 'tool',
                    'browse', 'search', 'fetch', 'retrieve', 'multi-step',
                    'orchestrate', 'coordinate', 'plan', 'schedule'
                ],
                patterns: [
                    /automate.*?task|autonomous.*?agent/i,
                    /execute.*?workflow|run.*?pipeline/i,
                    /multi.*?step|chain.*?of.*?actions/i,
                    /use.*?tools|call.*?api/i,
                    /browse.*?web|search.*?for/i
                ],
                weight: 0.8
            },
            vision: {
                keywords: [
                    'image', 'picture', 'photo', 'visual', 'see', 'look',
                    'screenshot', 'diagram', 'chart', 'graph', 'figure',
                    'describe', 'identify', 'recognize', 'detect', 'ocr',
                    'vision', 'multimodal', 'png', 'jpg', 'jpeg', 'gif'
                ],
                patterns: [
                    /describe.*?image|analyze.*?picture/i,
                    /what.*?in.*?image|look.*?at.*?this/i,
                    /identify.*?object|recognize.*?face/i,
                    /read.*?text.*?from|extract.*?from.*?image/i
                ],
                weight: 0.9
            },
            audio: {
                keywords: [
                    'audio', 'voice', 'sound', 'speech', 'listen', 'hear',
                    'transcribe', 'transcript', 'recording', 'podcast',
                    'music', 'song', 'speak', 'pronunciation', 'accent'
                ],
                patterns: [
                    /transcribe.*?audio|speech.*?to.*?text/i,
                    /listen.*?to|audio.*?file/i,
                    /voice.*?recognition|sound.*?analysis/i
                ],
                weight: 0.9
            },
            analysis: {
                keywords: [
                    'analysis', 'statistics', 'data', 'report', 'chart', 'trend', 'comparison',
                    'analyze', 'explanation', 'description', 'research', 'investigation', 'evaluation',
                    'insight', 'pattern', 'correlation', 'regression', 'forecast'
                ],
                patterns: [
                    /analyze.*?data|data.*?analysis/i,
                    /statistics.*?information|information.*?statistics/i,
                    /explain.*?phenomenon|phenomenon.*?explanation/i,
                    /compare.*?differences|contrast.*?results/i,
                    /find.*?pattern|identify.*?trend/i
                ],
                weight: 0.7
            },
            creative: {
                keywords: [
                    'creation', 'writing', 'story', 'article', 'poetry', 'novel', 'script',
                    'creative', 'imagination', 'creativity', 'design', 'art', 'inspiration',
                    'fiction', 'narrative', 'character', 'plot', 'dialogue'
                ],
                patterns: [
                    /write.*?story|create.*?article/i,
                    /design.*?solution|creative.*?idea/i,
                    /write.*?poetry|create.*?poem/i,
                    /imagine.*?scenario|fictional.*?world/i
                ],
                weight: 0.6
            },
            translation: {
                keywords: [
                    'translation', 'translate', 'English', 'Chinese', 'Japanese', 'Korean', 
                    'French', 'German', 'Spanish', 'Portuguese', 'Russian', 'Arabic',
                    'language', 'conversion', 'localize', 'i18n', 'l10n'
                ],
                patterns: [
                    /translate.*?to|translate.*?into/i,
                    /language.*?conversion|convert.*?language/i,
                    /in.*?english|in.*?chinese|in.*?japanese/i
                ],
                weight: 0.9
            },
            conversation: {
                keywords: [
                    'chat', 'conversation', 'communication', 'discussion', 'suggestion', 'opinion',
                    'hello', 'help', 'talk', 'discuss', 'advice', 'question', 'ask'
                ],
                patterns: [
                    /hello|hi|hey/i,
                    /help.*?me|I.*?need/i,
                    /give.*?suggestion|provide.*?advice/i,
                    /can.*?you|could.*?you/i
                ],
                weight: 0.5
            }
        };
    }

    /**
     * Initialize model aliases for easy access
     */
    initializeModelAliases() {
        return {
            // Short aliases
            'gpt4': 'gpt-4o',
            'gpt4o': 'gpt-4o',
            'gpt4-latest': 'gpt-4o-2024-11-20',
            'gpt4-mini': 'gpt-4o-mini',
            'gpt35': 'gpt-3.5-turbo',
            'o1': 'o1',
            'o1-mini': 'o1-mini',
            'o3': 'o3-mini',
            
            'claude': 'claude-3.5-sonnet',
            'claude4': 'claude-4-sonnet',
            'claude4-opus': 'claude-4-opus',
            'claude4-sonnet': 'claude-4-sonnet',
            'claude-opus': 'claude-4-opus',
            'claude-sonnet': 'claude-4-sonnet',
            'claude-haiku': 'claude-3.5-haiku',
            'claude35': 'claude-3.5-sonnet',
            
            'gemini': 'gemini-2.0-flash',
            'gemini2': 'gemini-2.0-flash',
            'gemini-pro': 'gemini-1.5-pro',
            'gemini-flash': 'gemini-2.0-flash',
            
            'deepseek': 'deepseek-v3',
            'deepseek-v3': 'deepseek-v3',
            'deepseek-coder': 'deepseek-coder',
            
            'grok': 'grok-2',
            'grok2': 'grok-2',
            
            'llama': 'llama-3.3-70b',
            'llama3': 'llama-3.3-70b',
            'llama-large': 'llama-3.1-405b',
            
            'mistral': 'mistral-large-latest',
            'mistral-large': 'mistral-large-2411',
            'codestral': 'codestral-latest',
            
            'qwen': 'qwen2.5-72b-instruct',
            'qwen-coder': 'qwen2.5-coder-32b-instruct',
            
            // Functional aliases (best for specific tasks)
            'best-coding': 'claude-4-opus',
            'best-code': 'claude-4-opus',
            'best-math': 'o1',
            'best-reasoning': 'o1',
            'best-creative': 'claude-4-opus',
            'best-vision': 'gpt-4o',
            'best-multimodal': 'gpt-4o',
            'best-chinese': 'qwen2.5-72b-instruct',
            'best-fast': 'gemini-2.0-flash',
            'best-cheap': 'deepseek-v3',
            'best-value': 'deepseek-v3',
            'best-local': 'qwen2.5-coder',
            'best-agentic': 'claude-4-sonnet',
            'best-agent': 'claude-4-sonnet'
        };
    }

    /**
     * Initialize model pricing (per 1M tokens)
     * Prices in USD as of January 2026
     */
    initializeModelPricing() {
        return {
            // OpenAI
            'gpt-4.5-preview': { input: 75.00, output: 150.00 },
            'gpt-4o': { input: 2.50, output: 10.00 },
            'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
            'o1': { input: 15.00, output: 60.00 },
            'o1-preview': { input: 15.00, output: 60.00 },
            'o1-mini': { input: 3.00, output: 12.00 },
            'o3-mini': { input: 1.10, output: 4.40 },
            'gpt-4-turbo': { input: 10.00, output: 30.00 },
            'gpt-4': { input: 30.00, output: 60.00 },
            'gpt-4o-mini': { input: 0.15, output: 0.60 },
            'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
            
            // Anthropic
            'claude-4-opus': { input: 15.00, output: 75.00 },
            'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
            'claude-4-sonnet': { input: 3.00, output: 15.00 },
            'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
            'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
            'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
            'claude-3.5-haiku': { input: 0.80, output: 4.00 },
            'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
            'claude-3-opus': { input: 15.00, output: 75.00 },
            'claude-3-sonnet': { input: 3.00, output: 15.00 },
            'claude-3-haiku': { input: 0.25, output: 1.25 },
            
            // Google
            'gemini-2.0-flash': { input: 0.10, output: 0.40 },
            'gemini-2.0-flash-exp': { input: 0.00, output: 0.00 }, // Free during preview
            'gemini-2.0-flash-thinking-exp': { input: 0.00, output: 0.00 },
            'gemini-exp-1206': { input: 0.00, output: 0.00 },
            'gemini-1.5-pro': { input: 1.25, output: 5.00 },
            'gemini-1.5-pro-002': { input: 1.25, output: 5.00 },
            'gemini-1.5-flash': { input: 0.075, output: 0.30 },
            'gemini-1.5-flash-002': { input: 0.075, output: 0.30 },
            
            // DeepSeek (very affordable)
            'deepseek-v3': { input: 0.27, output: 1.10 },
            'deepseek-chat': { input: 0.14, output: 0.28 },
            'deepseek-coder': { input: 0.14, output: 0.28 },
            'deepseek-reasoner': { input: 0.55, output: 2.19 },
            
            // xAI
            'grok-2': { input: 2.00, output: 10.00 },
            'grok-2-1212': { input: 2.00, output: 10.00 },
            'grok-2-vision-1212': { input: 2.00, output: 10.00 },
            
            // Mistral
            'mistral-large-2411': { input: 2.00, output: 6.00 },
            'mistral-large-latest': { input: 2.00, output: 6.00 },
            'mistral-small-latest': { input: 0.20, output: 0.60 },
            'codestral-latest': { input: 0.30, output: 0.90 },
            
            // Cohere
            'command-r-plus': { input: 2.50, output: 10.00 },
            'command-r': { input: 0.15, output: 0.60 },
            
            // Groq (fast inference, competitive pricing)
            'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
            'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
            'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
            
            // Chinese models
            'qwen2.5-72b-instruct': { input: 0.35, output: 0.35 },
            'qwen2.5-coder-32b-instruct': { input: 0.15, output: 0.15 },
            'qwen-max': { input: 2.40, output: 2.40 },
            'glm-4-plus': { input: 1.40, output: 1.40 },
            'moonshot-v1-128k': { input: 0.85, output: 0.85 },
            
            // Local models (free)
            'llama3.3': { input: 0, output: 0 },
            'qwen2.5-coder': { input: 0, output: 0 },
            'deepseek-coder-v2': { input: 0, output: 0 },
            'codellama': { input: 0, output: 0 },
            'mistral': { input: 0, output: 0 }
        };
    }

    /**
     * Initialize model capabilities and preferences
     * Updated: January 2026 with latest models
     */
    initializeModelCapabilities() {
        return {
            // ========== OpenAI Models (Latest 2024-2025) ==========
            'gpt-4.5-preview': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'reasoning', 'multimodal'],
                weaknesses: [],
                speed: 'medium',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 99
            },
            'gpt-4o': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'multimodal'],
                weaknesses: [],
                speed: 'fast',
                cost: 'high',
                quality: 'very_high',
                baseScore: 98
            },
            'gpt-4o-2024-11-20': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'multimodal'],
                weaknesses: [],
                speed: 'fast',
                cost: 'high',
                quality: 'very_high',
                baseScore: 98
            },
            'o1': {
                strengths: ['reasoning', 'coding', 'analysis', 'math'],
                weaknesses: ['creative'],
                speed: 'slow',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 99
            },
            'o1-preview': {
                strengths: ['reasoning', 'coding', 'analysis', 'math'],
                weaknesses: ['creative'],
                speed: 'slow',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 98
            },
            'o1-mini': {
                strengths: ['reasoning', 'coding', 'math'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 94
            },
            'o3-mini': {
                strengths: ['reasoning', 'coding', 'math', 'analysis'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 95
            },
            'gpt-4-turbo': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'multimodal'],
                weaknesses: [],
                speed: 'fast',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 96
            },
            'gpt-4': {
                strengths: ['coding', 'analysis', 'creative', 'translation'],
                weaknesses: [],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 95
            },
            'gpt-4o-mini': {
                strengths: ['conversation', 'analysis', 'coding'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 88
            },
            'gpt-4o-audio-preview': {
                strengths: ['multimodal', 'audio', 'conversation'],
                weaknesses: ['coding'],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 90
            },
            'gpt-3.5-turbo': {
                strengths: ['conversation', 'analysis'],
                weaknesses: ['coding', 'creative'],
                speed: 'very_fast',
                cost: 'very_low',
                quality: 'high',
                baseScore: 80
            },
            
            // ========== Anthropic Models (Latest 2024-2025) ==========
            'claude-4-opus': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'reasoning', 'agentic'],
                weaknesses: [],
                speed: 'medium',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 99
            },
            'claude-opus-4-20250514': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'reasoning', 'agentic'],
                weaknesses: [],
                speed: 'medium',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 99
            },
            'claude-4-sonnet': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'agentic'],
                weaknesses: [],
                speed: 'fast',
                cost: 'high',
                quality: 'very_high',
                baseScore: 98
            },
            'claude-sonnet-4-20250514': {
                strengths: ['coding', 'analysis', 'creative', 'translation', 'agentic'],
                weaknesses: [],
                speed: 'fast',
                cost: 'high',
                quality: 'very_high',
                baseScore: 98
            },
            'claude-3.5-sonnet': {
                strengths: ['coding', 'analysis', 'creative', 'translation'],
                weaknesses: [],
                speed: 'fast',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 96
            },
            'claude-3-5-sonnet-20241022': {
                strengths: ['coding', 'analysis', 'creative', 'translation'],
                weaknesses: [],
                speed: 'fast',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 96
            },
            'claude-3.5-haiku': {
                strengths: ['conversation', 'analysis', 'coding'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 88
            },
            'claude-3-5-haiku-20241022': {
                strengths: ['conversation', 'analysis', 'coding'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 88
            },
            'claude-3-opus': {
                strengths: ['analysis', 'creative', 'translation', 'reasoning'],
                weaknesses: [],
                speed: 'slow',
                cost: 'very_high',
                quality: 'very_high',
                baseScore: 95
            },
            'claude-3-sonnet': {
                strengths: ['analysis', 'creative', 'translation'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 90
            },
            'claude-3-haiku': {
                strengths: ['conversation', 'analysis'],
                weaknesses: ['coding', 'creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 85
            },
            
            // ========== Google Models (Latest 2024-2025) ==========
            'gemini-2.0-flash': {
                strengths: ['coding', 'analysis', 'multimodal', 'conversation'],
                weaknesses: [],
                speed: 'very_fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 94
            },
            'gemini-2.0-flash-exp': {
                strengths: ['coding', 'analysis', 'multimodal', 'conversation'],
                weaknesses: [],
                speed: 'very_fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 95
            },
            'gemini-2.0-flash-thinking-exp': {
                strengths: ['reasoning', 'coding', 'math', 'analysis'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'low',
                quality: 'very_high',
                baseScore: 96
            },
            'gemini-exp-1206': {
                strengths: ['coding', 'analysis', 'reasoning', 'multimodal'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 97
            },
            'gemini-1.5-pro': {
                strengths: ['analysis', 'conversation', 'multimodal', 'long_context'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 92
            },
            'gemini-1.5-pro-002': {
                strengths: ['analysis', 'conversation', 'multimodal', 'long_context'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 93
            },
            'gemini-1.5-flash': {
                strengths: ['conversation', 'analysis', 'multimodal'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 88
            },
            'gemini-1.5-flash-002': {
                strengths: ['conversation', 'analysis', 'multimodal'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 89
            },
            'gemini-pro': {
                strengths: ['analysis', 'conversation', 'multimodal'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 82
            },
            
            // ========== DeepSeek Models (Latest 2024-2025) ==========
            'deepseek-v3': {
                strengths: ['coding', 'analysis', 'reasoning', 'math'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'very_low',
                quality: 'very_high',
                baseScore: 97
            },
            'deepseek-chat': {
                strengths: ['conversation', 'analysis', 'translation', 'coding'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'very_low',
                quality: 'very_high',
                baseScore: 96
            },
            'deepseek-coder': {
                strengths: ['coding'],
                weaknesses: ['creative', 'conversation'],
                speed: 'fast',
                cost: 'very_low',
                quality: 'very_high',
                baseScore: 95
            },
            'deepseek-reasoner': {
                strengths: ['reasoning', 'math', 'coding', 'analysis'],
                weaknesses: ['creative'],
                speed: 'slow',
                cost: 'low',
                quality: 'very_high',
                baseScore: 97
            },
            
            // ========== xAI Models (Grok) ==========
            'grok-2': {
                strengths: ['creative', 'conversation', 'analysis', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 94
            },
            'grok-2-1212': {
                strengths: ['creative', 'conversation', 'analysis', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 95
            },
            'grok-2-vision-1212': {
                strengths: ['multimodal', 'creative', 'conversation', 'analysis'],
                weaknesses: [],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 94
            },
            'grok-beta': {
                strengths: ['creative', 'conversation', 'humor'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'medium',
                quality: 'high',
                baseScore: 88
            },
            
            // ========== Meta Llama Models (Latest) ==========
            'llama-3.3-70b': {
                strengths: ['coding', 'analysis', 'reasoning'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 92
            },
            'llama-3.2-90b-vision': {
                strengths: ['multimodal', 'analysis', 'reasoning'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 91
            },
            'llama-3.2-11b-vision': {
                strengths: ['multimodal', 'conversation'],
                weaknesses: ['creative', 'coding'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 84
            },
            'llama-3.1-405b': {
                strengths: ['coding', 'analysis', 'reasoning'],
                weaknesses: ['creative'],
                speed: 'slow',
                cost: 'high',
                quality: 'very_high',
                baseScore: 93
            },
            'llama-3.1-70b': {
                strengths: ['coding', 'analysis'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'medium',
                quality: 'high',
                baseScore: 89
            },
            'llama-3.1-8b': {
                strengths: ['conversation'],
                weaknesses: ['coding', 'creative', 'analysis'],
                speed: 'very_fast',
                cost: 'very_low',
                quality: 'medium',
                baseScore: 78
            },
            
            // ========== Mistral Models (Latest) ==========
            'mistral-large-2411': {
                strengths: ['coding', 'analysis', 'multilingual', 'reasoning'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 93
            },
            'mistral-large-latest': {
                strengths: ['coding', 'analysis', 'multilingual', 'reasoning'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 92
            },
            'pixtral-large-latest': {
                strengths: ['multimodal', 'analysis', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 91
            },
            'mistral-small-latest': {
                strengths: ['conversation', 'coding'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 85
            },
            'codestral-latest': {
                strengths: ['coding'],
                weaknesses: ['creative', 'conversation'],
                speed: 'fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 91
            },
            'ministral-8b-latest': {
                strengths: ['conversation'],
                weaknesses: ['coding', 'analysis'],
                speed: 'very_fast',
                cost: 'very_low',
                quality: 'medium',
                baseScore: 78
            },
            
            // ========== Cohere Models (Latest) ==========
            'command-r-plus-08-2024': {
                strengths: ['analysis', 'reasoning', 'retrieval', 'multilingual'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 90
            },
            'command-r-plus': {
                strengths: ['analysis', 'reasoning', 'retrieval'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'high',
                baseScore: 88
            },
            'command-r-08-2024': {
                strengths: ['conversation', 'retrieval'],
                weaknesses: [],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 85
            },
            'command-r': {
                strengths: ['conversation', 'retrieval'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 83
            },
            
            // ========== Groq Models (Fast Inference) ==========
            'llama-3.3-70b-versatile': {
                strengths: ['coding', 'analysis', 'reasoning'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 92
            },
            'llama-3.1-70b-versatile': {
                strengths: ['coding', 'analysis'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'low',
                quality: 'high',
                baseScore: 89
            },
            'mixtral-8x7b-32768': {
                strengths: ['conversation', 'analysis', 'multilingual'],
                weaknesses: ['creative'],
                speed: 'very_fast',
                cost: 'very_low',
                quality: 'high',
                baseScore: 85
            },
            
            // ========== Chinese Models (Latest) ==========
            'qwen2.5-72b-instruct': {
                strengths: ['chinese', 'coding', 'analysis', 'translation'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 93
            },
            'qwen2.5-coder-32b-instruct': {
                strengths: ['coding', 'chinese'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'low',
                quality: 'very_high',
                baseScore: 92
            },
            'qwen-max': {
                strengths: ['chinese', 'analysis', 'translation', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 91
            },
            'qwen-plus': {
                strengths: ['chinese', 'conversation', 'coding'],
                weaknesses: ['creative'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 87
            },
            'glm-4-plus': {
                strengths: ['chinese', 'analysis', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 90
            },
            'glm-4-flash': {
                strengths: ['chinese', 'conversation'],
                weaknesses: ['coding'],
                speed: 'very_fast',
                cost: 'very_low',
                quality: 'high',
                baseScore: 85
            },
            'moonshot-v1-128k': {
                strengths: ['chinese', 'long_context', 'analysis'],
                weaknesses: ['coding'],
                speed: 'medium',
                cost: 'low',
                quality: 'high',
                baseScore: 86
            },
            'ernie-4.0-turbo': {
                strengths: ['chinese', 'analysis', 'translation'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'medium',
                quality: 'high',
                baseScore: 88
            },
            'abab6.5s-chat': {
                strengths: ['chinese', 'conversation'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'low',
                quality: 'high',
                baseScore: 84
            },
            
            // ========== Perplexity Models ==========
            'llama-3.1-sonar-huge-128k-online': {
                strengths: ['retrieval', 'analysis', 'conversation'],
                weaknesses: ['coding'],
                speed: 'medium',
                cost: 'high',
                quality: 'very_high',
                baseScore: 90
            },
            'llama-3.1-sonar-large-128k-online': {
                strengths: ['retrieval', 'analysis', 'conversation'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'medium',
                quality: 'high',
                baseScore: 87
            },
            
            // ========== Local Models (Ollama/LlamaCpp) ==========
            'llama3.3': {
                strengths: ['coding', 'analysis'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'free',
                quality: 'high',
                baseScore: 88
            },
            'qwen2.5-coder': {
                strengths: ['coding'],
                weaknesses: ['creative', 'conversation'],
                speed: 'medium',
                cost: 'free',
                quality: 'very_high',
                baseScore: 90
            },
            'deepseek-coder-v2': {
                strengths: ['coding'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'free',
                quality: 'very_high',
                baseScore: 91
            },
            'codellama': {
                strengths: ['coding'],
                weaknesses: ['creative', 'conversation'],
                speed: 'fast',
                cost: 'free',
                quality: 'high',
                baseScore: 85
            },
            'mistral': {
                strengths: ['conversation', 'analysis'],
                weaknesses: ['coding'],
                speed: 'fast',
                cost: 'free',
                quality: 'high',
                baseScore: 82
            },
            
            // ========== Other Notable Models ==========
            'yi-large': {
                strengths: ['chinese', 'analysis', 'coding'],
                weaknesses: [],
                speed: 'medium',
                cost: 'medium',
                quality: 'high',
                baseScore: 88
            },
            'nvidia/llama-3.1-nemotron-70b-instruct': {
                strengths: ['coding', 'analysis', 'reasoning'],
                weaknesses: ['creative'],
                speed: 'medium',
                cost: 'medium',
                quality: 'very_high',
                baseScore: 91
            }
        };
    }

    /**
     * Detect task type from user input
     */
    detectTaskType(userInput, systemPrompt = '') {
        const input = (userInput + ' ' + systemPrompt).toLowerCase();
        const taskScores = {};

        // Initialize scores
        Object.keys(this.taskPatterns).forEach(taskType => {
            taskScores[taskType] = 0;
        });

        // Keyword matching
        Object.entries(this.taskPatterns).forEach(([taskType, patterns]) => {
            patterns.keywords.forEach(keyword => {
                if (input.includes(keyword.toLowerCase())) {
                    taskScores[taskType] += patterns.weight;
                }
            });

            // Pattern matching
            patterns.patterns.forEach(pattern => {
                if (pattern.test(input)) {
                    taskScores[taskType] += patterns.weight * 1.5; // Higher weight for patterns
                }
            });
        });

        // Find the task type with highest score
        const detectedTaskType = Object.entries(taskScores)
            .reduce((max, [taskType, score]) => 
                score > max.score ? { taskType, score } : max, 
                { taskType: 'conversation', score: 0 }
            );

        return {
            taskType: detectedTaskType.taskType,
            confidence: Math.min(detectedTaskType.score, 1.0),
            allScores: taskScores
        };
    }

    /**
     * Calculate model score for a specific task
     */
    calculateModelScore(modelName, taskType, requirements = {}) {
        const modelInfo = this.modelCapabilities[modelName];
        if (!modelInfo) return 0;

        let score = modelInfo.baseScore;

        // Task-specific scoring
        if (modelInfo.strengths.includes(taskType)) {
            score += 15;
        }
        if (modelInfo.weaknesses.includes(taskType)) {
            score -= 10;
        }

        // Performance-based adjustment
        const performanceData = this.modelPerformance.get(modelName);
        if (performanceData) {
            score += (performanceData.successRate - 0.5) * 20; // -10 to +10 adjustment
            score -= performanceData.avgResponseTime / 1000; // Penalty for slow response
        }

        // Requirements-based adjustment
        if (requirements.prioritizeSpeed && modelInfo.speed === 'very_fast') {
            score += 10;
        }
        if (requirements.prioritizeCost && modelInfo.cost === 'low') {
            score += 8;
        }
        if (requirements.prioritizeQuality && modelInfo.quality === 'very_high') {
            score += 12;
        }

        return Math.max(0, score);
    }

    /**
     * Select the best model for a given request
     */
    selectBestModel(userInput, systemPrompt = '', availableModels = [], requirements = {}) {
        // Detect task type
        const taskDetection = this.detectTaskType(userInput, systemPrompt);
        
        // Score all available models
        const modelScores = availableModels.map(modelName => ({
            model: modelName,
            score: this.calculateModelScore(modelName, taskDetection.taskType, requirements),
            taskType: taskDetection.taskType,
            confidence: taskDetection.confidence
        }));

        // Sort by score (highest first)
        modelScores.sort((a, b) => b.score - a.score);

        const result = {
            selectedModel: modelScores[0]?.model || availableModels[0],
            taskType: taskDetection.taskType,
            confidence: taskDetection.confidence,
            reasoning: this.generateReasoning(modelScores[0], taskDetection),
            alternatives: modelScores.slice(1, 3), // Top 2 alternatives
            allScores: modelScores
        };

        console.log(`🧠 Intelligent model selection: ${result.selectedModel} (task type: ${result.taskType}, confidence: ${(result.confidence * 100).toFixed(1)}%)`);
        console.log(`💡 Selection reason: ${result.reasoning}`);

        return result;
    }

    /**
     * Generate human-readable reasoning for model selection
     */
    generateReasoning(selectedModelInfo, taskDetection) {
        if (!selectedModelInfo) return 'using default model';

        const modelName = selectedModelInfo.model;
        const taskType = taskDetection.taskType;
        const modelCaps = this.modelCapabilities[modelName];

        const taskNames = {
            coding: 'programming task',
            math: 'mathematical task',
            reasoning: 'reasoning task',
            agentic: 'autonomous agent task',
            vision: 'vision/image task',
            audio: 'audio/speech task',
            analysis: 'analysis task',
            creative: 'creative task',
            translation: 'translation task',
            conversation: 'conversation task'
        };

        let reasoning = `Detected ${taskNames[taskType] || taskType}`;

        if (modelCaps?.strengths.includes(taskType)) {
            reasoning += `, ${modelName} excels at this task type`;
        }

        if (modelCaps?.quality === 'very_high') {
            reasoning += ', premium quality';
        }

        if (modelCaps?.speed === 'very_fast') {
            reasoning += ', ultra-fast response';
        }

        if (modelCaps?.cost === 'low' || modelCaps?.cost === 'very_low') {
            reasoning += ', cost-effective';
        }

        if (modelCaps?.cost === 'free') {
            reasoning += ', free (local model)';
        }

        return reasoning;
    }

    /**
     * Update model performance data
     */
    updateModelPerformance(modelName, responseTime, success, userRating = null) {
        if (!this.modelPerformance.has(modelName)) {
            this.modelPerformance.set(modelName, {
                totalRequests: 0,
                successfulRequests: 0,
                totalResponseTime: 0,
                successRate: 0.5,
                avgResponseTime: 3000,
                userRatings: []
            });
        }

        const perf = this.modelPerformance.get(modelName);
        perf.totalRequests++;
        perf.totalResponseTime += responseTime;
        
        if (success) {
            perf.successfulRequests++;
        }

        if (userRating !== null) {
            perf.userRatings.push(userRating);
            // Keep only last 100 ratings
            if (perf.userRatings.length > 100) {
                perf.userRatings = perf.userRatings.slice(-100);
            }
        }

        // Update calculated metrics
        perf.successRate = perf.successfulRequests / perf.totalRequests;
        perf.avgResponseTime = perf.totalResponseTime / perf.totalRequests;

        this.modelPerformance.set(modelName, perf);
    }

    /**
     * Load performance data from storage
     */
    loadPerformanceData() {
        // In a real implementation, this would load from a database or file
        // For now, we'll start with empty performance data
        console.log('📊 Model performance tracking initialized');
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        const stats = {};
        this.modelPerformance.forEach((perf, modelName) => {
            stats[modelName] = {
                successRate: (perf.successRate * 100).toFixed(1) + '%',
                avgResponseTime: Math.round(perf.avgResponseTime) + 'ms',
                totalRequests: perf.totalRequests,
                avgUserRating: perf.userRatings.length > 0 
                    ? (perf.userRatings.reduce((a, b) => a + b, 0) / perf.userRatings.length).toFixed(1)
                    : 'N/A'
            };
        });
        return stats;
    }

    // ========== NEW FEATURES ==========

    /**
     * Resolve model alias to actual model name
     * @param {string} modelNameOrAlias - Model name or alias
     * @returns {string} Resolved model name
     */
    resolveModelAlias(modelNameOrAlias) {
        const lowerAlias = modelNameOrAlias.toLowerCase().replace(/\s+/g, '-');
        return this.modelAliases[lowerAlias] || modelNameOrAlias;
    }

    /**
     * Get all available model aliases
     * @returns {Object} Alias mapping
     */
    getModelAliases() {
        return { ...this.modelAliases };
    }

    /**
     * Add custom model alias
     * @param {string} alias - The alias name
     * @param {string} modelName - The actual model name
     */
    addModelAlias(alias, modelName) {
        this.modelAliases[alias.toLowerCase()] = modelName;
    }

    /**
     * Estimate cost for a request
     * @param {string} modelName - Model name
     * @param {number} inputTokens - Number of input tokens
     * @param {number} outputTokens - Number of output tokens (estimated)
     * @returns {Object} Cost estimation
     */
    estimateCost(modelName, inputTokens, outputTokens = null) {
        const resolvedModel = this.resolveModelAlias(modelName);
        const pricing = this.modelPricing[resolvedModel];
        
        if (!pricing) {
            return {
                model: resolvedModel,
                inputTokens,
                outputTokens: outputTokens || 0,
                inputCost: 0,
                outputCost: 0,
                totalCost: 0,
                currency: 'USD',
                note: 'Pricing not available for this model'
            };
        }

        // Estimate output tokens if not provided (typically 1.5x input for conversations)
        const estimatedOutputTokens = outputTokens || Math.ceil(inputTokens * 1.5);
        
        const inputCost = (inputTokens / 1000000) * pricing.input;
        const outputCost = (estimatedOutputTokens / 1000000) * pricing.output;
        const totalCost = inputCost + outputCost;

        return {
            model: resolvedModel,
            inputTokens,
            outputTokens: estimatedOutputTokens,
            inputCost: parseFloat(inputCost.toFixed(6)),
            outputCost: parseFloat(outputCost.toFixed(6)),
            totalCost: parseFloat(totalCost.toFixed(6)),
            currency: 'USD',
            pricePerMillionInput: pricing.input,
            pricePerMillionOutput: pricing.output
        };
    }

    /**
     * Compare costs across multiple models
     * @param {Array<string>} models - List of model names
     * @param {number} inputTokens - Number of input tokens
     * @param {number} outputTokens - Number of output tokens
     * @returns {Array} Sorted cost comparison
     */
    compareCosts(models, inputTokens, outputTokens = null) {
        const comparisons = models.map(model => this.estimateCost(model, inputTokens, outputTokens));
        return comparisons.sort((a, b) => a.totalCost - b.totalCost);
    }

    /**
     * Get the most cost-effective model for a task
     * @param {string} taskType - Task type
     * @param {number} inputTokens - Estimated input tokens
     * @param {Array<string>} availableModels - Available models
     * @returns {Object} Best value model recommendation
     */
    getBestValueModel(taskType, inputTokens, availableModels = []) {
        const modelsToCheck = availableModels.length > 0 
            ? availableModels 
            : Object.keys(this.modelPricing);

        const evaluations = modelsToCheck.map(model => {
            const resolvedModel = this.resolveModelAlias(model);
            const capabilities = this.modelCapabilities[resolvedModel];
            const cost = this.estimateCost(resolvedModel, inputTokens);
            
            if (!capabilities) return null;

            // Calculate value score (quality per dollar)
            const qualityScore = capabilities.baseScore;
            const taskBonus = capabilities.strengths.includes(taskType) ? 10 : 0;
            const taskPenalty = capabilities.weaknesses.includes(taskType) ? -5 : 0;
            const effectiveScore = qualityScore + taskBonus + taskPenalty;
            
            // Value = score / cost (higher is better)
            // For free models, use a very small cost to avoid division by zero
            const effectiveCost = cost.totalCost > 0 ? cost.totalCost : 0.000001;
            const valueScore = effectiveScore / (effectiveCost * 10000);

            return {
                model: resolvedModel,
                qualityScore: effectiveScore,
                cost: cost.totalCost,
                valueScore: parseFloat(valueScore.toFixed(2)),
                isFree: cost.totalCost === 0
            };
        }).filter(Boolean);

        evaluations.sort((a, b) => b.valueScore - a.valueScore);

        return {
            bestValue: evaluations[0],
            alternatives: evaluations.slice(1, 5),
            taskType
        };
    }

    /**
     * Set priority mode for model selection
     * @param {string} mode - 'speed', 'quality', 'cost', 'balanced'
     */
    setPriorityMode(mode) {
        const validModes = ['speed', 'quality', 'cost', 'balanced'];
        if (validModes.includes(mode)) {
            this.priorityMode = mode;
            console.log(`🎯 Priority mode set to: ${mode}`);
        } else {
            console.warn(`Invalid priority mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
        }
    }

    /**
     * Get current priority mode
     * @returns {string} Current priority mode
     */
    getPriorityMode() {
        return this.priorityMode;
    }

    /**
     * Get requirements based on current priority mode
     * @returns {Object} Requirements object for model selection
     */
    getPriorityRequirements() {
        switch (this.priorityMode) {
            case 'speed':
                return { prioritizeSpeed: true, prioritizeCost: false, prioritizeQuality: false };
            case 'quality':
                return { prioritizeSpeed: false, prioritizeCost: false, prioritizeQuality: true };
            case 'cost':
                return { prioritizeSpeed: false, prioritizeCost: true, prioritizeQuality: false };
            case 'balanced':
            default:
                return { prioritizeSpeed: false, prioritizeCost: false, prioritizeQuality: false };
        }
    }

    /**
     * Detect language from input text
     * @param {string} text - Input text
     * @returns {Object} Language detection result
     */
    detectLanguage(text) {
        // Chinese character range detection
        const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
        const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
        const koreanRegex = /[\uac00-\ud7af\u1100-\u11ff]/g;
        const arabicRegex = /[\u0600-\u06ff]/g;
        const cyrillicRegex = /[\u0400-\u04ff]/g;
        const thaiRegex = /[\u0e00-\u0e7f]/g;
        const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

        const chineseCount = (text.match(chineseRegex) || []).length;
        const japaneseCount = (text.match(japaneseRegex) || []).length;
        const koreanCount = (text.match(koreanRegex) || []).length;
        const arabicCount = (text.match(arabicRegex) || []).length;
        const cyrillicCount = (text.match(cyrillicRegex) || []).length;
        const thaiCount = (text.match(thaiRegex) || []).length;
        const vietnameseCount = (text.match(vietnameseRegex) || []).length;

        const totalChars = text.length;
        const detectedLanguages = [];

        if (chineseCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'chinese', confidence: chineseCount / totalChars });
        }
        if (japaneseCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'japanese', confidence: japaneseCount / totalChars });
        }
        if (koreanCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'korean', confidence: koreanCount / totalChars });
        }
        if (arabicCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'arabic', confidence: arabicCount / totalChars });
        }
        if (cyrillicCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'russian', confidence: cyrillicCount / totalChars });
        }
        if (thaiCount > totalChars * 0.1) {
            detectedLanguages.push({ language: 'thai', confidence: thaiCount / totalChars });
        }
        if (vietnameseCount > totalChars * 0.05) {
            detectedLanguages.push({ language: 'vietnamese', confidence: vietnameseCount / totalChars });
        }

        // Sort by confidence
        detectedLanguages.sort((a, b) => b.confidence - a.confidence);

        return {
            primaryLanguage: detectedLanguages[0]?.language || 'english',
            confidence: detectedLanguages[0]?.confidence || 1.0,
            allDetected: detectedLanguages,
            isMultilingual: detectedLanguages.length > 1
        };
    }

    /**
     * Get models optimized for a specific language
     * @param {string} language - Language code
     * @returns {Array<string>} List of optimized models
     */
    getLanguageOptimizedModels(language) {
        const languageModels = {
            chinese: [
                'qwen2.5-72b-instruct', 'qwen2.5-coder-32b-instruct', 'qwen-max', 'qwen-plus',
                'glm-4-plus', 'glm-4-flash', 'ernie-4.0-turbo', 'moonshot-v1-128k',
                'deepseek-v3', 'deepseek-chat', 'yi-large'
            ],
            japanese: [
                'gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro', 'command-r-plus'
            ],
            korean: [
                'gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro'
            ],
            arabic: [
                'gpt-4o', 'claude-3.5-sonnet', 'command-r-plus'
            ],
            russian: [
                'gpt-4o', 'claude-3.5-sonnet', 'mistral-large-latest'
            ],
            multilingual: [
                'gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro', 'command-r-plus',
                'mistral-large-latest', 'qwen2.5-72b-instruct'
            ]
        };

        return languageModels[language] || languageModels['multilingual'];
    }

    /**
     * Get model leaderboard for a specific task type
     * @param {string} taskType - Task type
     * @param {number} limit - Number of top models to return
     * @returns {Array} Ranked models for the task
     */
    getLeaderboard(taskType, limit = 10) {
        const models = Object.entries(this.modelCapabilities).map(([name, caps]) => {
            let score = caps.baseScore;
            
            // Task-specific bonuses
            if (caps.strengths.includes(taskType)) score += 15;
            if (caps.weaknesses.includes(taskType)) score -= 10;
            
            // Speed bonus for speed-sensitive tasks
            if (['conversation', 'translation'].includes(taskType)) {
                if (caps.speed === 'very_fast') score += 5;
                if (caps.speed === 'fast') score += 3;
            }

            // Get pricing info
            const pricing = this.modelPricing[name];
            const costTier = pricing 
                ? (pricing.input + pricing.output) / 2 
                : 999;

            return {
                model: name,
                score,
                strengths: caps.strengths,
                speed: caps.speed,
                quality: caps.quality,
                costTier: costTier < 1 ? 'low' : costTier < 5 ? 'medium' : costTier < 20 ? 'high' : 'premium'
            };
        });

        // Sort by score
        models.sort((a, b) => b.score - a.score);

        return {
            taskType,
            topModels: models.slice(0, limit),
            totalModels: models.length
        };
    }

    /**
     * Get comprehensive leaderboard for all task types
     * @returns {Object} Leaderboards for all task types
     */
    getAllLeaderboards() {
        const taskTypes = Object.keys(this.taskPatterns);
        const leaderboards = {};

        taskTypes.forEach(taskType => {
            leaderboards[taskType] = this.getLeaderboard(taskType, 5);
        });

        return leaderboards;
    }

    /**
     * Enhanced model selection with all new features
     * @param {string} userInput - User input
     * @param {string} systemPrompt - System prompt
     * @param {Array<string>} availableModels - Available models
     * @param {Object} options - Additional options
     * @returns {Object} Selection result
     */
    selectModel(userInput, systemPrompt = '', availableModels = [], options = {}) {
        // Detect language
        const languageInfo = this.detectLanguage(userInput);
        
        // Detect task type
        const taskDetection = this.detectTaskType(userInput, systemPrompt);
        
        // Get priority requirements
        const requirements = options.requirements || this.getPriorityRequirements();
        
        // Resolve any aliases in available models
        const resolvedModels = availableModels.map(m => this.resolveModelAlias(m));
        
        // If Chinese detected, prioritize Chinese-optimized models
        let modelPool = resolvedModels;
        if (languageInfo.primaryLanguage === 'chinese' && languageInfo.confidence > 0.3) {
            const chineseModels = this.getLanguageOptimizedModels('chinese');
            const availableChinese = chineseModels.filter(m => resolvedModels.includes(m));
            if (availableChinese.length > 0) {
                // Boost Chinese models in the pool
                modelPool = [...availableChinese, ...resolvedModels.filter(m => !availableChinese.includes(m))];
            }
        }

        // Calculate scores for all models
        const modelScores = modelPool.map(modelName => ({
            model: modelName,
            score: this.calculateModelScore(modelName, taskDetection.taskType, requirements),
            taskType: taskDetection.taskType,
            confidence: taskDetection.confidence,
            cost: this.estimateCost(modelName, options.estimatedTokens || 1000)
        }));

        // Sort by score
        modelScores.sort((a, b) => b.score - a.score);

        const result = {
            selectedModel: modelScores[0]?.model || availableModels[0],
            taskType: taskDetection.taskType,
            confidence: taskDetection.confidence,
            language: languageInfo,
            priorityMode: this.priorityMode,
            reasoning: this.generateReasoning(modelScores[0], taskDetection),
            cost: modelScores[0]?.cost,
            alternatives: modelScores.slice(1, 4).map(m => ({
                model: m.model,
                score: m.score,
                cost: m.cost.totalCost
            }))
        };

        console.log(`🧠 Model selection: ${result.selectedModel}`);
        console.log(`   Task: ${result.taskType} (${(result.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`   Language: ${result.language.primaryLanguage}`);
        console.log(`   Priority: ${result.priorityMode}`);
        if (result.cost) {
            console.log(`   Est. cost: $${result.cost.totalCost.toFixed(6)}`);
        }

        return result;
    }
}

module.exports = IntelligentModelSelector;