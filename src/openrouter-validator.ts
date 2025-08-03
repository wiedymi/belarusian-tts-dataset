import type { Sentence, ValidationResult } from "./types";
import { Spinner } from "./utils";
import { createValidationPrompt } from "./prompts";
import { OpenRouterClient, getOpenRouterConfig } from "./openrouter-client";
import { z } from "zod";

// Schema for structured validation results
const ValidationResultSchema = z.object({
  results: z.array(z.object({
    index: z.number(),
    id: z.string(),
    score: z.number().min(1).max(10),
    issues: z.string(),
    suggestion: z.string().optional(),
    accentIssues: z.string().optional(),
    accentedSuggestion: z.string().optional(),
  })),
});

export interface OpenRouterValidationResult {
  sentence: Sentence;
  score: number;          // 1-10 quality score
  issues: string[];       // List of identified issues
  suggestions: string[];  // Suggested corrections
  correctedText?: string; // Full corrected sentence if needed
  isAcceptable: boolean;  // true if score >= 7
  accentIssues?: string[];      // Issues with accent marks
  accentedSuggestion?: string;  // Suggested accent corrections
}

export class OpenRouterValidator {
  private spinner: Spinner;
  private openRouterClient: OpenRouterClient;
  private batchSize = 25; // Validate 25 sentences at a time

  constructor(model?: string) {
    this.spinner = new Spinner();
    
    // Initialize OpenRouter client
    const config = getOpenRouterConfig();
    if (model) {
      config.model = model;
    }
    this.openRouterClient = new OpenRouterClient(config);
  }

  async validateDataset(sentences: Sentence[]): Promise<ValidationResult> {
    console.log(`\n🔍 Starting OpenRouter validation of ${sentences.length} sentences...`);
    console.log(`   Model: ${this.openRouterClient['model']}`);
    console.log(`   Batch size: ${this.batchSize}`);
    
    const results: OpenRouterValidationResult[] = [];
    const batches = Math.ceil(sentences.length / this.batchSize);
    
    // Process in batches
    for (let i = 0; i < batches; i++) {
      const start = i * this.batchSize;
      const end = Math.min(start + this.batchSize, sentences.length);
      const batch = sentences.slice(start, end);
      
      this.spinner.start(`Validating batch ${i + 1}/${batches} (sentences ${start + 1}-${end})...`);
      
      try {
        const batchResults = await this.validateBatch(batch);
        results.push(...batchResults);
        
        // Show sample results
        const issues = batchResults.filter(r => !r.isAcceptable);
        if (issues.length > 0) {
          console.log(`\n   ⚠️  Found ${issues.length} issues in batch ${i + 1}:`);
          issues.slice(0, 3).forEach(r => {
            console.log(`      - [${r.sentence.id}] Score: ${r.score}/10 - ${r.issues[0]}`);
          });
        } else {
          console.log(`   ✅ All sentences in batch ${i + 1} are acceptable`);
        }
      } catch (error) {
        this.spinner.fail(`Batch ${i + 1} validation failed: ${error}`);
        // Continue with next batch
      }
      
      // Small delay between batches to avoid rate limits
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    this.spinner.succeed('Validation complete!');
    
    // Generate summary
    const acceptableCount = results.filter(r => r.isAcceptable).length;
    const averageScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    
    console.log('\n📊 Validation Summary:');
    console.log(`   Total sentences: ${sentences.length}`);
    console.log(`   Acceptable (score >= 7): ${acceptableCount} (${(acceptableCount / sentences.length * 100).toFixed(1)}%)`);
    console.log(`   Average score: ${averageScore.toFixed(1)}/10`);
    
    // Group issues by type
    const issueTypes = new Map<string, number>();
    results.forEach(r => {
      r.issues.forEach(issue => {
        const type = this.categorizeIssue(issue);
        issueTypes.set(type, (issueTypes.get(type) || 0) + 1);
      });
    });
    
    if (issueTypes.size > 0) {
      console.log('\n🔍 Issues by type:');
      Array.from(issueTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          console.log(`   - ${type}: ${count} occurrences`);
        });
    }
    
    return {
      totalSentences: sentences.length,
      validSentences: acceptableCount,
      invalidSentences: sentences.length - acceptableCount,
      errors: results.filter(r => !r.isAcceptable).map(r => r.issues).flat(),
      warnings: results.filter(r => r.score >= 7 && r.score < 9).map(r => r.issues).flat(),
      suggestedFixes: results.filter(r => r.correctedText).map(r => ({
        original: r.sentence.text,
        suggested: r.correctedText!,
        reason: r.issues.join('; ')
      })),
      detailedResults: results
    };
  }

  private async validateBatch(sentences: Sentence[]): Promise<OpenRouterValidationResult[]> {
    const prompt = createValidationPrompt(sentences);
    
    try {
      if (this.openRouterClient.supportsStructuredOutput()) {
        // Use structured output for better parsing
        const result = await this.openRouterClient.generateStructuredData(
          prompt,
          ValidationResultSchema,
          { 
            temperature: 0.3, // Low temperature for consistent validation
            maxTokens: 4000,
            system: "You are a strict Belarusian language expert validating sentences for TTS quality."
          }
        );
        
        return this.parseStructuredResults(sentences, result);
      } else {
        // Fallback to text parsing
        const response = await this.openRouterClient.generateText(
          prompt,
          { 
            temperature: 0.3,
            maxTokens: 4000,
            system: "You are a strict Belarusian language expert validating sentences for TTS quality."
          }
        );
        
        return this.parseTextResults(sentences, response);
      }
    } catch (error) {
      console.error('Validation error:', error);
      // Return default results if validation fails
      return sentences.map(s => ({
        sentence: s,
        score: 5,
        issues: ['Validation failed'],
        suggestions: [],
        isAcceptable: false
      }));
    }
  }

  private parseStructuredResults(
    sentences: Sentence[], 
    result: z.infer<typeof ValidationResultSchema>
  ): OpenRouterValidationResult[] {
    return sentences.map((sentence, index) => {
      const validation = result.results.find(r => r.index === index) || 
                        result.results.find(r => r.id === sentence.id);
      
      if (!validation) {
        return {
          sentence,
          score: 5,
          issues: ['No validation result'],
          suggestions: [],
          isAcceptable: false
        };
      }
      
      const issues = validation.issues === 'none' ? [] : [validation.issues];
      const accentIssues = validation.accentIssues && validation.accentIssues !== 'correct' 
        ? [validation.accentIssues] 
        : [];
      
      return {
        sentence,
        score: validation.score,
        issues,
        suggestions: validation.suggestion && validation.suggestion !== '-' ? [validation.suggestion] : [],
        correctedText: validation.suggestion && validation.suggestion !== '-' ? validation.suggestion : undefined,
        isAcceptable: validation.score >= 7,
        accentIssues,
        accentedSuggestion: validation.accentedSuggestion,
      };
    });
  }

  private parseTextResults(sentences: Sentence[], response: string): OpenRouterValidationResult[] {
    const lines = response.split('\n').filter(line => line.trim());
    const results: OpenRouterValidationResult[] = [];
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const linePattern = new RegExp(`${i + 1}\\. Score: (\\d+)/10 \\| Issues: (.+?) \\| Suggestion: (.+?) \\| Accent: (.+?)$`);
      
      // Find matching line
      const matchingLine = lines.find(line => linePattern.test(line));
      
      if (matchingLine) {
        const match = matchingLine.match(linePattern);
        if (match) {
          const [, scoreStr, issuesStr, suggestionStr, accentStr] = match;
          const score = parseInt(scoreStr);
          const issues = issuesStr === 'none' ? [] : [issuesStr];
          const suggestions = suggestionStr === '-' ? [] : [suggestionStr];
          const accentIssues = accentStr === 'correct' ? [] : [accentStr];
          
          results.push({
            sentence,
            score,
            issues,
            suggestions,
            correctedText: suggestionStr !== '-' ? suggestionStr : undefined,
            isAcceptable: score >= 7,
            accentIssues,
            accentedSuggestion: accentIssues.length > 0 ? suggestionStr : undefined,
          });
        } else {
          // Failed to parse, add default
          results.push({
            sentence,
            score: 5,
            issues: ['Failed to parse validation'],
            suggestions: [],
            isAcceptable: false
          });
        }
      } else {
        // No matching line found
        results.push({
          sentence,
          score: 5,
          issues: ['No validation result'],
          suggestions: [],
          isAcceptable: false
        });
      }
    }
    
    return results;
  }

  private categorizeIssue(issue: string): string {
    if (issue.toLowerCase().includes('russian')) return 'Russian influence';
    if (issue.toLowerCase().includes('grammar')) return 'Grammar error';
    if (issue.toLowerCase().includes('accent') || issue.toLowerCase().includes('stress')) return 'Accent marking';
    if (issue.toLowerCase().includes('natural')) return 'Unnaturalness';
    if (issue.toLowerCase().includes('pronunciation')) return 'Pronunciation difficulty';
    if (issue.toLowerCase().includes('clarity')) return 'Clarity issue';
    if (issue.toLowerCase().includes('cultural')) return 'Cultural inappropriateness';
    return 'Other';
  }

  async fixSentences(sentences: Sentence[]): Promise<Sentence[]> {
    console.log(`\n🔧 Attempting to fix ${sentences.length} sentences...`);
    
    const fixedSentences: Sentence[] = [];
    const batches = Math.ceil(sentences.length / this.batchSize);
    
    for (let i = 0; i < batches; i++) {
      const start = i * this.batchSize;
      const end = Math.min(start + this.batchSize, sentences.length);
      const batch = sentences.slice(start, end);
      
      this.spinner.start(`Fixing batch ${i + 1}/${batches}...`);
      
      try {
        const validationResults = await this.validateBatch(batch);
        
        for (let j = 0; j < batch.length; j++) {
          const original = batch[j];
          const validation = validationResults[j];
          
          if (validation.correctedText && validation.correctedText !== original.text) {
            // Create fixed sentence
            const fixed: Sentence = {
              ...original,
              text: validation.correctedText,
              accentedText: validation.accentedSuggestion || validation.correctedText,
              // Update normalized text
              normalizedText: validation.correctedText.toLowerCase()
                .replace(/[.,!?;:'"«»\-–—]/g, '')
                .trim(),
            };
            
            fixedSentences.push(fixed);
            console.log(`\n   ✓ Fixed [${original.id}]:`);
            console.log(`     Original: ${original.text}`);
            console.log(`     Fixed: ${fixed.text}`);
          } else {
            // Keep original if no fix needed or available
            fixedSentences.push(original);
          }
        }
      } catch (error) {
        this.spinner.fail(`Batch ${i + 1} fixing failed: ${error}`);
        // Keep originals if fixing fails
        fixedSentences.push(...batch);
      }
    }
    
    this.spinner.succeed(`Fixed ${fixedSentences.filter((s, i) => s.text !== sentences[i].text).length} sentences`);
    
    return fixedSentences;
  }
}

// Export convenience function
export async function validateWithOpenRouter(
  sentences: Sentence[], 
  options?: { model?: string; fix?: boolean }
): Promise<ValidationResult> {
  const validator = new OpenRouterValidator(options?.model);
  
  if (options?.fix) {
    const fixedSentences = await validator.fixSentences(sentences);
    return validator.validateDataset(fixedSentences);
  }
  
  return validator.validateDataset(sentences);
}