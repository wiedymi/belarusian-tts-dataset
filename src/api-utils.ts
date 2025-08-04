import { $ } from "bun";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  timeoutMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  timeoutMs: 300000, // 5 minutes - increased for gemini-2.5-pro
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly attempt: number,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function callGeminiWithRetry(
  model: string,
  prompt: string,
  config: Partial<RetryConfig> = {}
): Promise<string> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Suppress verbose logging to keep CLI clean
      // console.log(`      → Attempt ${attempt}/${retryConfig.maxRetries}`);
      
      // Convert prompt to single line by replacing newlines with spaces
      const singleLinePrompt = prompt.replace(/\n+/g, ' ').trim();
      
      // Execute with timeout if specified - pass prompt directly to -p flag
      const geminiPromise = $`gemini -m ${model} -p ${singleLinePrompt}`.text();
      
      let result: string;
      if (retryConfig.timeoutMs) {
        result = await Promise.race([
          geminiPromise,
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), retryConfig.timeoutMs)
          )
        ]);
      } else {
        result = await geminiPromise;
      }
      
      // Validate response
      if (!result || result.trim().length === 0) {
        throw new Error('Empty response from Gemini API');
      }
      
      // Simple validation that it looks like valid output
      if (!result.includes('[') || !result.includes(']')) {
        console.error('      [DEBUG] Unexpected response format:');
        console.error('      ' + result.substring(0, 200) + '...');
        throw new Error('Response does not appear to contain formatted sentences');
      }
      
      // Suppress verbose logging to keep CLI clean
      // console.log(`      [OK] API call successful on attempt ${attempt}`);
      return result;
      
    } catch (error) {
      
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`      [ERROR] Attempt ${attempt} failed: ${errorMessage}`);
      
      // Don't retry on non-retryable errors
      if (errorMessage.includes('Invalid API key') || 
          errorMessage.includes('Quota exceeded') ||
          errorMessage.includes('Model not found')) {
        throw new ApiError(
          `Non-retryable error: ${errorMessage}`,
          attempt,
          error
        );
      }
      
      // Calculate delay for next retry
      if (attempt < retryConfig.maxRetries) {
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffFactor, attempt - 1),
          retryConfig.maxDelay
        );
        
        console.log(`      ... Waiting ${(delay / 1000).toFixed(1)}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries exhausted
  throw new ApiError(
    `Failed after ${retryConfig.maxRetries} attempts`,
    retryConfig.maxRetries,
    lastError
  );
}

// Rate limiting helper
export class RateLimiter {
  private lastCallTime: number = 0;
  private callCount: number = 0;
  private windowStart: number = Date.now();
  
  constructor(
    private maxCallsPerMinute: number = 30,
    private minDelayBetweenCalls: number = 1000
  ) {}
  
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // Reset window if a minute has passed
    if (now - this.windowStart >= 60000) {
      this.callCount = 0;
      this.windowStart = now;
    }
    
    // Check rate limit
    if (this.callCount >= this.maxCallsPerMinute) {
      const waitTime = 60000 - (now - this.windowStart);
      console.log(`      [WAIT] Rate limit reached, waiting ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.callCount = 0;
      this.windowStart = Date.now();
    }
    
    // Enforce minimum delay between calls
    const timeSinceLastCall = now - this.lastCallTime;
    if (timeSinceLastCall < this.minDelayBetweenCalls) {
      const waitTime = this.minDelayBetweenCalls - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastCallTime = Date.now();
    this.callCount++;
  }
}
