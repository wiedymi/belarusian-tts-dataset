import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText, generateObject } from 'ai';
import { z } from 'zod';

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
}

export class OpenRouterClient {
  private client: ReturnType<typeof createOpenRouter>;
  private model: string;
  private headers: Record<string, string>;
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 3,
    initialDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2,
  };

  constructor(config: OpenRouterConfig) {
    this.client = createOpenRouter({
      apiKey: config.apiKey,
    });
    
    this.model = config.model || 'google/gemini-2.0-flash-exp:free';
    
    this.headers = {};
    if (config.siteUrl) {
      this.headers['HTTP-Referer'] = config.siteUrl;
    }
    if (config.siteName) {
      this.headers['X-Title'] = config.siteName;
    }
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config = { ...this.defaultRetryOptions, ...options };
    let lastError: any;
    let delay = config.initialDelay!;

    for (let attempt = 0; attempt <= config.maxRetries!; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        const isRetryable = this.isRetryableError(error);
        
        if (!isRetryable || attempt === config.maxRetries) {
          throw error;
        }

        console.warn(`⚠️  Attempt ${attempt + 1} failed: ${error.message || error}`);
        
        if (error.status || error.statusCode) {
          console.log(`   Status: ${error.status || error.statusCode}`);
        }
        if (error.responseBody) {
          console.log(`   Response: ${JSON.stringify(error.responseBody).substring(0, 200)}`);
        }
        if (error.cause) {
          console.log(`   Cause: ${error.cause}`);
        }
        
        console.log(`   Retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * config.backoffFactor!, config.maxDelay!);
      }
    }

    throw lastError;
  }

  private isRetryableError(error: any): boolean {
    if (error.name === 'AI_APICallError') return true;
    if (error.message?.includes('Invalid JSON')) return true;
    if (error.message?.includes('timeout')) return true;
    if (error.message?.includes('ECONNRESET')) return true;
    if (error.message?.includes('socket hang up')) return true;
    
    const status = error.status || error.statusCode;
    if (status === 429) return true;
    if (status === 500) return true;
    if (status === 502) return true;
    if (status === 503) return true;
    if (status === 504) return true;
    
    return false;
  }

  async generateText(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    system?: string;
    retryOptions?: RetryOptions;
  }) {
    return this.withRetry(async () => {
      const result = await generateText({
        model: this.client(this.model),
        prompt,
        system: options?.system,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        headers: this.headers,
      });

      return result.text;
    }, options?.retryOptions);
  }

  async streamText(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    system?: string;
    onChunk?: (chunk: string) => void;
    retryOptions?: RetryOptions;
  }) {
    return this.withRetry(async () => {
      const result = await streamText({
        model: this.client(this.model),
        prompt,
        system: options?.system,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        headers: this.headers,
      });

      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        if (options?.onChunk) {
          options.onChunk(chunk);
        }
      }

      return fullText;
    }, options?.retryOptions);
  }

  async generateStructuredData<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      system?: string;
      retryOptions?: RetryOptions;
    }
  ) {
    if (!this.supportsStructuredOutput(this.model)) {
      return this.generateTextWithJSONFallback(prompt, schema, options);
    }
    
    return this.withRetry(async () => {
      const result = await generateObject({
        model: this.client(this.model),
        prompt,
        schema,
        system: options?.system,
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens,
        headers: this.headers,
      });

      return result.object;
    }, options?.retryOptions);
  }

  private async generateTextWithJSONFallback<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      system?: string;
      retryOptions?: RetryOptions;
    }
  ): Promise<T> {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: Return your response as valid JSON only, with no additional text or markdown formatting. Make sure to complete the JSON structure.`;
    
    const response = await this.generateText(jsonPrompt, {
      ...options,
      system: `${options?.system || ''}\n\nYou must respond with valid JSON only. Do not include any markdown formatting, explanations, or text outside the JSON structure. Ensure the JSON is complete and properly closed.`,
      maxTokens: options?.maxTokens || 8000, // Increase token limit to avoid truncation
    });
    
    try {
      let cleanedResponse = response.trim();
      
      cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      cleanedResponse = cleanedResponse.replace(/^```\s*/i, '').replace(/```\s*$/, '');
      
      if (cleanedResponse.includes('"sentences": [')) {
        const lastQuoteIndex = cleanedResponse.lastIndexOf('"');
        const secondLastQuoteIndex = cleanedResponse.lastIndexOf('"', lastQuoteIndex - 1);
        
        if (lastQuoteIndex > secondLastQuoteIndex) {
          const afterLastQuote = cleanedResponse.substring(lastQuoteIndex + 1);
          if (!afterLastQuote.includes('"') && !afterLastQuote.includes('}') && !afterLastQuote.includes(']')) {
            cleanedResponse += '"';
            
            if (cleanedResponse.includes('"type": "norma')) {
              cleanedResponse = cleanedResponse.replace('"type": "norma', '"type": "normal');
            }
            
            const lastChars = cleanedResponse.substring(cleanedResponse.length - 10);
            if (lastChars.includes('"type":')) {
              cleanedResponse += ' }';
            }
          }
        }
        
        const openBrackets = (cleanedResponse.match(/\[/g) || []).length;
        const closeBrackets = (cleanedResponse.match(/\]/g) || []).length;
        const openBraces = (cleanedResponse.match(/\{/g) || []).length;
        const closeBraces = (cleanedResponse.match(/\}/g) || []).length;
        
        if (openBrackets > closeBrackets) {
          cleanedResponse += ']'.repeat(openBrackets - closeBrackets);
        }
        if (openBraces > closeBraces) {
          cleanedResponse += '}'.repeat(openBraces - closeBraces);
        }
      }
      
      const parsed = JSON.parse(cleanedResponse);
      return schema.parse(parsed);
    } catch (error) {
      
      if (response.includes('"sentences": [')) {
        try {
          const sentencesMatch = response.match(/"sentences"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
          if (sentencesMatch) {
            const sentencesContent = sentencesMatch[1];
            const sentences = sentencesContent
              .split(/\},\s*\{/)
              .map(s => {
                s = s.replace(/^\{/, '').replace(/\}$/, '');
                if (!s.startsWith('{')) s = '{' + s;
                if (!s.endsWith('}')) s = s + '}';
                return s;
              })
              .filter(s => s.includes('"text"'))
              .map(s => {
                try {
                  return JSON.parse(s);
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
            
            if (sentences.length > 0) {
              const reconstructed = { sentences };
              
              try {
                return schema.parse(reconstructed);
              } catch (schemaError: any) {
                if (schemaError?.issues?.[0]?.code === 'too_big' || schemaError?.issues?.[0]?.code === 'too_small') {
                  return reconstructed as T;
                }
                throw schemaError;
              }
            }
          }
        } catch (fallbackError) {
        }
      }
      
      throw new Error(`Failed to parse structured response: ${error}`);
    }
  }

  getAvailableModels(): string[] {
    return [
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-1.5-flash:free',
      'meta-llama/llama-3.2-1b-instruct:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free',
      'qwen/qwen2-7b-instruct:free',
      
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-opus',
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
      'google/gemini-pro',
      'google/gemini-pro-1.5',
      'meta-llama/llama-3.1-70b-instruct',
      'meta-llama/llama-3.1-405b-instruct',
      'openrouter/horizon-beta',
    ];
  }

  supportsStructuredOutput(model: string): boolean {
    const structuredModels = [
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
      'openai/gpt-3.5-turbo',
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-opus',
      'anthropic/claude-3-haiku',
      'google/gemini-pro',
      'google/gemini-pro-1.5',
    ];
    
    return structuredModels.some(m => model.toLowerCase().includes(m.toLowerCase()));
  }

}

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY environment variable is required.\n' +
      'Get your API key from https://openrouter.ai/keys\n' +
      'Then set it: export OPENROUTER_API_KEY="your-key-here"'
    );
  }

  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL,
    siteUrl: 'https://github.com/belarusian-tts-dataset',
    siteName: 'Belarusian TTS Dataset Generator',
  };
}