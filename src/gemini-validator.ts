import { $ } from "bun";
import type { Sentence, ValidationResult } from "./types";
import { Spinner } from "./utils";
import { createValidationPrompt } from "./prompts";

export interface GeminiValidationResult {
  sentence: Sentence;
  score: number;          // 1-10 quality score
  issues: string[];       // List of problems found
  suggestion?: string;    // Corrected version if needed
  shouldFix: boolean;     // Whether this needs fixing
  accentIssues?: string[];// Specific accent/stress mark issues
  accentedSuggestion?: string; // Version with corrected accent marks
}

export interface ValidationBatch {
  sentences: Sentence[];
  results: GeminiValidationResult[];
  totalIssues: number;
  avgScore: number;
}

export class GeminiValidator {
  private spinner: Spinner;
  private model = "gemini-2.5-flash";
  private batchSize = 50;  // Sentences per validation request
  private qualityThreshold = 7;  // Auto-fix below this score

  constructor() {
    this.spinner = new Spinner();
  }

  async validateDataset(
    sentences: Sentence[], 
    options: { deep?: boolean; fix?: boolean } = {}
  ): Promise<ValidationBatch[]> {
    if (!options.deep) {
      throw new Error("Use BelarusianValidator for basic validation");
    }

    console.log(`\n🔍 Deep validation of ${sentences.length} sentences with Gemini AI...`);
    console.log(`📊 Processing in batches of ${this.batchSize} sentences`);
    console.log(`⚙️  Quality threshold: ${this.qualityThreshold}/10 (auto-fix below this)\n`);

    const batches: ValidationBatch[] = [];
    const totalBatches = Math.ceil(sentences.length / this.batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * this.batchSize;
      const batchEnd = Math.min(batchStart + this.batchSize, sentences.length);
      const batchSentences = sentences.slice(batchStart, batchEnd);

      console.log(`📦 Batch ${i + 1}/${totalBatches} (${batchSentences.length} sentences)`);
      
      const batch = await this.validateBatch(batchSentences, options);
      batches.push(batch);

      // Show batch results
      const goodCount = batch.results.filter(r => r.score >= this.qualityThreshold).length;
      const issueCount = batch.results.filter(r => r.shouldFix).length;
      
      console.log(`   ✅ ${goodCount} good sentences, ⚠️  ${issueCount} need fixes (avg score: ${batch.avgScore.toFixed(1)}/10)`);
    }

    return batches;
  }

  private async validateBatch(
    sentences: Sentence[], 
    options: { fix?: boolean } = {}
  ): Promise<ValidationBatch> {
    this.spinner.start("Sending to Gemini for analysis...");
    
    try {
      // Create validation prompt
      const prompt = this.createValidationPrompt(sentences);
      
      // Call Gemini
      const response = await $`gemini -m ${this.model} -p ${prompt}`.text();
      
      this.spinner.stop("✅ Analysis complete");
      
      // Parse results
      const results = this.parseValidationResults(sentences, response);
      
      // Calculate batch stats
      const totalIssues = results.filter(r => r.shouldFix).length;
      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
      
      return {
        sentences,
        results,
        totalIssues,
        avgScore
      };
      
    } catch (error) {
      this.spinner.stop("❌ Validation failed");
      console.error("Error validating batch:", error);
      
      // Return fallback results
      return {
        sentences,
        results: sentences.map(s => ({
          sentence: s,
          score: 5,
          issues: ["Validation failed"],
          shouldFix: false
        })),
        totalIssues: 0,
        avgScore: 5
      };
    }
  }

  private createValidationPrompt(sentences: Sentence[]): string {
    return createValidationPrompt(sentences);
  }

  private parseValidationResults(sentences: Sentence[], response: string): GeminiValidationResult[] {
    const lines = response.split('\n').filter(line => line.trim());
    const results: GeminiValidationResult[] = [];
    
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
          const suggestion = suggestionStr === '-' ? undefined : suggestionStr;
          
          // Parse accent issues
          const accentIssues = accentStr === 'correct' ? [] : [accentStr];
          const hasAccentIssue = accentIssues.length > 0;
          
          results.push({
            sentence,
            score,
            issues,
            suggestion,
            shouldFix: score < this.qualityThreshold || hasAccentIssue,
            accentIssues: accentIssues.length > 0 ? accentIssues : undefined,
            accentedSuggestion: hasAccentIssue ? suggestion : undefined
          });
          continue;
        }
      }
      
      // Fallback if parsing fails
      results.push({
        sentence,
        score: 7,
        issues: ["Could not parse validation result"],
        shouldFix: false
      });
    }
    
    return results;
  }

  async autoFixSentences(batches: ValidationBatch[]): Promise<{
    totalFixed: number;
    totalSkipped: number;
    fixedSentences: Sentence[];
  }> {
    console.log("\n🔧 Auto-fixing sentences...");
    
    let totalFixed = 0;
    let totalSkipped = 0;
    const fixedSentences: Sentence[] = [];
    
    for (const batch of batches) {
      const needsFix = batch.results.filter(r => r.shouldFix && r.suggestion);
      
      if (needsFix.length === 0) continue;
      
      console.log(`\n📦 Fixing ${needsFix.length} sentences in batch...`);
      
      for (const result of needsFix) {
        if (result.suggestion) {
          const originalText = result.sentence.text;
          const fixedText = result.suggestion;
          
          console.log(`   🔧 [${result.sentence.id}]`);
          console.log(`      Before: ${originalText}`);
          console.log(`      After:  ${fixedText}`);
          console.log(`      Issues: ${result.issues.join(", ")}`);
          if (result.accentIssues && result.accentIssues.length > 0) {
            console.log(`      Accent: ${result.accentIssues.join(", ")}`);
          }
          
          // Apply fix
          const fixedSentence: Sentence = {
            ...result.sentence,
            text: fixedText,
            wordCount: fixedText.split(/\s+/).length,
            estimatedDuration: this.estimateDuration(fixedText),
            // Update accented text if accent was corrected
            accentedText: result.accentedSuggestion || result.sentence.accentedText
          };
          
          fixedSentences.push(fixedSentence);
          totalFixed++;
        } else {
          console.log(`   ⚠️  [${result.sentence.id}] - no suggestion provided, skipping`);
          totalSkipped++;
        }
      }
    }
    
    console.log(`\n✅ Auto-fix complete:`);
    console.log(`   Fixed: ${totalFixed} sentences`);
    console.log(`   Skipped: ${totalSkipped} sentences`);
    
    return {
      totalFixed,
      totalSkipped,
      fixedSentences
    };
  }

  private estimateDuration(text: string): number {
    const words = text.split(/\s+/).length;
    return Math.max(3, Math.min(10, (words / 150) * 60));
  }

  generateValidationReport(batches: ValidationBatch[]): string {
    const allResults = batches.flatMap(b => b.results);
    const totalSentences = allResults.length;
    const needsFix = allResults.filter(r => r.shouldFix).length;
    const avgScore = allResults.reduce((sum, r) => sum + r.score, 0) / totalSentences;
    
    // Score distribution
    const scoreDistribution = {
      excellent: allResults.filter(r => r.score >= 9).length,
      good: allResults.filter(r => r.score >= 7 && r.score < 9).length,
      fair: allResults.filter(r => r.score >= 5 && r.score < 7).length,
      poor: allResults.filter(r => r.score < 5).length,
    };
    
    // Common issues
    const issueCounter = new Map<string, number>();
    const accentIssueCounter = new Map<string, number>();
    let totalAccentIssues = 0;
    
    allResults.forEach(r => {
      r.issues.forEach(issue => {
        issueCounter.set(issue, (issueCounter.get(issue) || 0) + 1);
      });
      
      if (r.accentIssues) {
        r.accentIssues.forEach(issue => {
          accentIssueCounter.set(issue, (accentIssueCounter.get(issue) || 0) + 1);
          totalAccentIssues++;
        });
      }
    });
    
    const topIssues = Array.from(issueCounter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    const topAccentIssues = Array.from(accentIssueCounter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return `Gemini Deep Validation Report
===============================

Dataset Overview:
- Total sentences: ${totalSentences}
- Average quality: ${avgScore.toFixed(1)}/10
- Sentences needing fixes: ${needsFix} (${(needsFix/totalSentences*100).toFixed(1)}%)

Quality Distribution:
- Excellent (9-10): ${scoreDistribution.excellent} (${(scoreDistribution.excellent/totalSentences*100).toFixed(1)}%)
- Good (7-8): ${scoreDistribution.good} (${(scoreDistribution.good/totalSentences*100).toFixed(1)}%)
- Fair (5-6): ${scoreDistribution.fair} (${(scoreDistribution.fair/totalSentences*100).toFixed(1)}%)
- Poor (1-4): ${scoreDistribution.poor} (${(scoreDistribution.poor/totalSentences*100).toFixed(1)}%)

Accent Mark Analysis:
- Total accent issues: ${totalAccentIssues} (${(totalAccentIssues/totalSentences*100).toFixed(1)}%)
- Sentences with correct accents: ${totalSentences - totalAccentIssues} (${((totalSentences - totalAccentIssues)/totalSentences*100).toFixed(1)}%)

Most Common Grammar/Language Issues:
${topIssues.map(([issue, count], i) => 
  `${i + 1}. ${issue}: ${count} occurrences`
).join('\n')}

${topAccentIssues.length > 0 ? `Most Common Accent Issues:
${topAccentIssues.map(([issue, count], i) => 
  `${i + 1}. ${issue}: ${count} occurrences`
).join('\n')}

` : ''}Recommendation: ${avgScore >= 8 && totalAccentIssues < totalSentences * 0.1 ? 'Dataset quality is excellent!' : 
                avgScore >= 7 && totalAccentIssues < totalSentences * 0.2 ? 'Good quality dataset with minor issues' :
                avgScore >= 6 || totalAccentIssues < totalSentences * 0.3 ? 'Fair quality - consider fixing major issues' :
                'Quality needs improvement - recommend fixes'}
`;
  }
}
