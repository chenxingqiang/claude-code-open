const { v4: uuidv4 } = require('uuid');
const TokenManager = require('./token-manager');

class ClaudeCompatibility {
  constructor() {
    this.modelMappings = this.initializeModelMappings();
    this.tokenManager = new TokenManager();
  }

  /**
   * Initialize model mapping configuration
   */
  initializeModelMappings() {
    return {
      'claude-3-sonnet': {
        'openai': 'gpt-4',
        'google': 'gemini-pro',
        'ollama': 'llama2:13b',
        'cohere': 'command-r-plus',
        'mistral': 'mistral-large',
        'groq': 'llama2-70b-4096',
        'anthropic': 'claude-3-sonnet',
        'deepseek': 'deepseek-chat'
      },
      'claude-3-haiku': {
        'openai': 'gpt-3.5-turbo',
        'google': 'gemini-flash',
        'ollama': 'llama2:7b',
        'cohere': 'command',
        'mistral': 'mistral-small',
        'groq': 'mixtral-8x7b-32768',
        'anthropic': 'claude-3-haiku',
        'deepseek': 'deepseek-chat'
      },
      'claude-3-opus': {
        'openai': 'gpt-4-turbo',
        'google': 'gemini-ultra',
        'ollama': 'codellama',
        'cohere': 'command-r-plus',
        'mistral': 'mistral-large',
        'groq': 'llama2-70b-4096',
        'anthropic': 'claude-3-opus',
        'deepseek': 'deepseek-coder'
      }
    };
  }

  /**
   * Convert Claude format request to llm-interface format
   */
  toLLMInterface(claudeRequest, provider, selectedModel = null, taskType = 'conversation', taskComplexity = 'medium') {
    try {
      // Extract basic parameters  
      const model = selectedModel || this.mapClaudeModel(claudeRequest.model, provider);
      const messages = this.convertMessages(claudeRequest.messages || []);
      
      // get user input for token analysis
      const userInput = this.extractUserInput(claudeRequest);
      
      // Use intelligent token manager to allocate optimal tokens
      const requestedTokens = claudeRequest.max_tokens || 1000;
      const tokenAllocation = this.tokenManager.allocateTokens(
        requestedTokens,
        provider,
        model,
        taskType,
        taskComplexity,
        userInput,
        {
          prioritizeCost: claudeRequest.prioritize_cost || false,
          prioritizeQuality: claudeRequest.prioritize_quality !== false, // default prioritize quality
          prioritizeSpeed: claudeRequest.prioritize_speed || false
        }
      );
      
      // Record token allocation decision
      if (tokenAllocation.success) {
        console.log(`🧠 Intelligent token allocation: ${requestedTokens} → ${tokenAllocation.tokens} (${tokenAllocation.allocation.strategy})`);
        if (tokenAllocation.report && tokenAllocation.report.summary.change !== 0) {
          console.log(`📊 Token adjustment: ${tokenAllocation.report.summary.changePercent}% (${tokenAllocation.report.summary.change > 0 ? '+' : ''}${tokenAllocation.report.summary.change})`);
        }
      } else {
        console.warn(`⚠️ Token allocation failed, using default: ${tokenAllocation.tokens}`);
      }
      
      const llmRequest = {
        model: model,
        // Honor an explicitly requested max_tokens; otherwise use the intelligent
        // allocation. The allocation detail is always kept in _tokenAllocation.
        max_tokens: claudeRequest.max_tokens != null ? claudeRequest.max_tokens : tokenAllocation.tokens,
        messages: messages,
        temperature: claudeRequest.temperature || 0.7,
        stream: claudeRequest.stream || false,
        // add token allocation information to metadata
        _tokenAllocation: tokenAllocation
      };

      // Add optional parameters
      if (claudeRequest.top_p !== undefined) {
        llmRequest.top_p = claudeRequest.top_p;
      }

      if (claudeRequest.stop_sequences && claudeRequest.stop_sequences.length > 0) {
        llmRequest.stop = claudeRequest.stop_sequences;
      }

      // Process system messages
      if (claudeRequest.system) {
        llmRequest.messages.unshift({
          role: 'system',
          content: claudeRequest.system
        });
      }

      console.log(`🔄 Transforming request: Claude -> ${provider} (${model})`);
      return llmRequest;

    } catch (error) {
      console.error('❌ Request transformation failed: ', error);
      throw new Error(`Request transformation failed: ${error.message}`);
    }
  }

  /**
   * Convert llm-interface response to Claude format
   */
  toClaudeFormat(llmResponse, provider, requestId = null) {
    try {
      // Extract response content
      const content = this.extractContent(llmResponse);
      const usage = this.extractUsage(llmResponse);
      const reasoning = this.extractReasoning(llmResponse);

      // Build Claude format response
      const claudeResponse = {
        id: requestId || `msg_${uuidv4()}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: content
          }
        ],
        model: llmResponse.model || `${provider}-model`,
        stop_reason: this.mapStopReason(llmResponse),
        stop_sequence: null,
        usage: {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0
        }
      };

      // Optionally surface the model's reasoning summary (reasoning models).
      if (process.env.EXPOSE_REASONING === 'true' && reasoning) {
        claudeResponse.reasoning = reasoning;
      }

      console.log(`🔄 conversion响应: ${provider} -> Claude`);
      return claudeResponse;

    } catch (error) {
      console.error('❌ Response transformation failed: ', error);
      throw new Error(`Response transformation failed: ${error.message}`);
    }
  }

  /**
   * Map Claude model to provider-specific model
   */
  mapClaudeModel(claudeModel, provider) {
    // if no model specified, use default mapping
    if (!claudeModel) {
      claudeModel = 'claude-3-sonnet';
    }

    // Resolve provider aliases (e.g. "mock-openai" -> "openai") so mappings work
    // regardless of any prefix the caller uses.
    const providerKey = this.resolveProviderKey(provider);

    // find model mapping
    const mapping = this.modelMappings[claudeModel];
    if (mapping && mapping[providerKey]) {
      return mapping[providerKey];
    }

    // If no mapping found, using default model
    const defaultModels = {
      'openai': 'gpt-3.5-turbo',
      'google': 'gemini-pro',
      'ollama': 'llama2',
      'cohere': 'command',
      'mistral': 'mistral-small',
      'groq': 'mixtral-8x7b-32768',
      'anthropic': 'claude-3-haiku',
      'huggingface': 'microsoft/DialoGPT-medium',
      'deepseek': 'deepseek-chat'
    };

    return defaultModels[providerKey] || 'gpt-3.5-turbo';
  }

  /**
   * Resolve a provider identifier to a known mapping key. Returns the provider
   * unchanged when it is already a known key; otherwise returns the first known
   * key contained in the provider name (so "mock-openai" -> "openai").
   */
  resolveProviderKey(provider) {
    if (!provider || typeof provider !== 'string') {
      return provider;
    }
    const knownKeys = ['openai', 'google', 'ollama', 'cohere', 'mistral', 'groq', 'anthropic', 'huggingface', 'deepseek'];
    if (knownKeys.includes(provider)) {
      return provider;
    }
    const lower = provider.toLowerCase();
    return knownKeys.find(key => lower.includes(key)) || provider;
  }

  /**
   * Convert message format
   */
  convertMessages(messages) {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be in array format');
    }

    return messages.map(message => {
      if (typeof message.content === 'string') {
        return {
          role: message.role,
          content: message.content
        };
      }

      // Process structured content
      if (Array.isArray(message.content)) {
        const textContent = message.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');

        return {
          role: message.role,
          content: textContent
        };
      }

      return {
        role: message.role,
        content: message.content?.text || ''
      };
    });
  }

  /**
   * Extract content from llm-interface response
   */
  extractContent(response) {
    // handle different provider response formats
    if (response.results) {
      return response.results;
    }

    if (response.content) {
      return response.content;
    }

    if (response.message) {
      return response.message;
    }

    if (response.choices && response.choices.length > 0) {
      return response.choices[0].message?.content || response.choices[0].text || '';
    }

    if (response.text) {
      return response.text;
    }

    if (response.response) {
      return response.response;
    }

    return 'Unable to extract response content';
  }

  /**
   * Extract a reasoning summary from an OpenAI-compatible response, if present.
   * @param {object} response
   * @returns {string} reasoning text, or '' when absent.
   */
  extractReasoning(response) {
    if (response && response.choices && response.choices[0] && response.choices[0].message) {
      const msg = response.choices[0].message;
      if (typeof msg.reasoning === 'string') {
        return msg.reasoning;
      }
    }
    return '';
  }

  /**
   * Extract usage from llm-interface response
   */
  extractUsage(response) {
    const defaultUsage = { input_tokens: 0, output_tokens: 0 };

    if (response.usage) {
      return {
        input_tokens: response.usage.prompt_tokens || response.usage.input_tokens || 0,
        output_tokens: response.usage.completion_tokens || response.usage.output_tokens || 0
      };
    }

    // Estimate token count (rough estimate: 1 token ≈ 4 characters)
    if (response.results || response.content || response.message) {
      const content = this.extractContent(response);
      const estimatedTokens = Math.ceil(content.length / 4);
      return {
        input_tokens: 0,
        output_tokens: estimatedTokens
      };
    }

    return defaultUsage;
  }

  /**
   * Map stop reason
   */
  mapStopReason(response) {
    if (response.finish_reason) {
      const reasonMap = {
        'stop': 'end_turn',
        'length': 'max_tokens',
        'content_filter': 'stop_sequence',
        'function_call': 'tool_use'
      };
      return reasonMap[response.finish_reason] || 'end_turn';
    }

    if (response.stop_reason) {
      return response.stop_reason;
    }

    return 'end_turn';
  }

  /**
   * Handle streaming response conversion
   */
  convertStreamResponse(chunk, provider) {
    try {
      // basic streaming response conversion
      const claudeChunk = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: this.extractStreamContent(chunk)
        }
      };

      return `data: ${JSON.stringify(claudeChunk)}\n\n`;

    } catch (error) {
      console.error('❌ Streaming response transformation failed: ', error);
      return `data: {"type": "error", "error": "${error.message}"}\n\n`;
    }
  }

  /**
   * Extract content from streaming response chunk
   */
  extractStreamContent(chunk) {
    if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
      return chunk.choices[0].delta.content || '';
    }

    if (chunk.content) {
      return chunk.content;
    }

    if (chunk.text) {
      return chunk.text;
    }

    return '';
  }

  /**
   * Validate Claude request format
   */
  validateClaudeRequest(request) {
    const errors = [];

    // Check required fields
    if (!request.messages || !Array.isArray(request.messages)) {
      errors.push('messages field is required and must be an array');
    }

    if (request.messages && request.messages.length === 0) {
      errors.push('messages array cannot be empty');
    }

    // Check message format
    if (request.messages) {
      request.messages.forEach((message, index) => {
        if (!message.role) {
          errors.push(`message ${index} missing role field`);
        }

        if (!message.content) {
          errors.push(`message ${index} missing content field`);
        }

        if (message.role && !['user', 'assistant', 'system'].includes(message.role)) {
            errors.push(`message ${index} role field is invalid: ${message.role}`);
        }
      });
    }

    // Check optional parameter ranges
    if (request.max_tokens && (request.max_tokens < 1 || request.max_tokens > 8192)) {
      errors.push('max_tokens must be between 1-8192');
    }

    if (request.temperature && (request.temperature < 0 || request.temperature > 2)) {
      errors.push('temperature must be between 0-2');
    }

    if (request.top_p && (request.top_p < 0 || request.top_p > 1)) {
      errors.push('top_p must be between 0-1');
    }

    return errors;
  }

  /**
   * Get supported Claude model list
   */
  getSupportedClaudeModels() {
    return Object.keys(this.modelMappings);
  }

  /**
   * Get model mapping for specific provider
   */
  getProviderModels(provider) {
    const models = {};
    for (const [claudeModel, mapping] of Object.entries(this.modelMappings)) {
      if (mapping[provider]) {
        models[claudeModel] = mapping[provider];
      }
    }
    return models;
  }

  /**
   * Extract user input content for token analysis
   */
  extractUserInput(claudeRequest) {
    let userContent = '';
    
    // Extract from system messages
    if (claudeRequest.system) {
      userContent += claudeRequest.system + ' ';
    }
    
    // Extract user content from message array
    if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
      claudeRequest.messages.forEach(message => {
        if (message.role === 'user') {
          if (typeof message.content === 'string') {
            userContent += message.content + ' ';
          } else if (Array.isArray(message.content)) {
            message.content.forEach(item => {
              if (item.type === 'text' && item.text) {
                userContent += item.text + ' ';
              }
            });
          }
        }
      });
    }
    
    return userContent.trim();
  }

  /**
   * Get token allocation report for a request
   */
  getTokenAllocationReport(claudeRequest, provider, model, taskType = 'conversation', taskComplexity = 'medium') {
    const userInput = this.extractUserInput(claudeRequest);
    const requestedTokens = claudeRequest.max_tokens || 1000;
    
    return this.tokenManager.allocateTokens(
      requestedTokens,
      provider,
      model,
      taskType,
      taskComplexity,
      userInput,
      {
        prioritizeCost: claudeRequest.prioritize_cost || false,
        prioritizeQuality: claudeRequest.prioritize_quality !== false,
        prioritizeSpeed: claudeRequest.prioritize_speed || false
      }
    );
  }

  /**
   * Get provider token limits
   */
  getProviderTokenLimits(provider, model = null) {
    return this.tokenManager.getProviderLimits(provider, model);
  }

  /**
   * Validate max_tokens against provider limits
   */
  validateMaxTokens(maxTokens, provider, model) {
    const limits = this.tokenManager.getProviderLimits(provider, model);
    
    if (maxTokens < limits.min) {
      return { valid: false, error: `max_tokens must be at least ${limits.min}`, suggestion: limits.min };
    }
    
    if (maxTokens > limits.max) {
      return { valid: false, error: `max_tokens cannot exceed ${limits.max}`, suggestion: limits.max };
    }
    
    return { valid: true };
  }
}

module.exports = ClaudeCompatibility;
