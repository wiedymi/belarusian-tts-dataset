#!/usr/bin/env bun

import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { BelarusianValidator } from "./validator";
import { GeminiValidator } from "./gemini-validator";
import type { Sentence } from "./types";

interface ValidationOptions {
  deep?: boolean;
  fix?: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const options: ValidationOptions = {
    deep: args.includes('--deep'),
    fix: args.includes('--fix')
  };

  // Validate arguments
  if (options.fix && !options.deep) {
    console.error("❌ Error: --fix requires --deep flag");
    console.log("Usage: bun run validate [--deep] [--fix]");
    process.exit(1);
  }

  await validateExistingDataset(options);
}

async function validateExistingDataset(options: ValidationOptions) {
  const outputDir = "./output";
  
  console.log(`🔍 ${options.deep ? 'Deep' : 'Basic'} validation of existing dataset...`);
  if (options.fix) {
    console.log("🔧 Auto-fix mode enabled");
  }
  console.log();
  
  try {
    // Read all session files
    const sentenceDir = join(outputDir, "sentences");
    const files = await readdir(sentenceDir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    
    if (jsonFiles.length === 0) {
      console.log("❌ No dataset files found. Run 'bun run generate' first.");
      return;
    }
    
    let allSentences: Sentence[] = [];
    const sessionData: Map<number, Sentence[]> = new Map();
    
    for (const file of jsonFiles) {
      const content = await readFile(join(sentenceDir, file), 'utf-8');
      const sentences: Sentence[] = JSON.parse(content);
      allSentences.push(...sentences);
      
      // Extract session number from filename
      const sessionMatch = file.match(/session(\\d+)\\.json/);
      if (sessionMatch) {
        const sessionNum = parseInt(sessionMatch[1]);
        sessionData.set(sessionNum, sentences);
      }
      
      console.log(`📄 Loaded ${file}: ${sentences.length} sentences`);
    }
    
    console.log(`\\n📊 Total sentences loaded: ${allSentences.length}`);
    
    if (options.deep) {
      await runDeepValidation(allSentences, sessionData, options);
    } else {
      await runBasicValidation(allSentences);
    }
    
  } catch (error) {
    console.error("❌ Error validating dataset:", error);
  }
}

async function runBasicValidation(sentences: Sentence[]) {
  const validator = new BelarusianValidator();
  
  // Run basic validation
  validator.validateDataset(sentences);
  
  // Additional analysis
  analyzeDatasetBalance(sentences);
}

async function runDeepValidation(
  allSentences: Sentence[], 
  sessionData: Map<number, Sentence[]>,
  options: ValidationOptions
) {
  const geminiValidator = new GeminiValidator();
  
  try {
    // Create backup before making changes
    if (options.fix) {
      await createBackup(sessionData);
    }
    
    // Run Gemini validation
    const batches = await geminiValidator.validateDataset(allSentences, options);
    
    // Generate and display report
    const report = geminiValidator.generateValidationReport(batches);
    console.log(`\\n${report}`);
    
    // Save detailed report
    await writeFile(
      join("./output/reports", "deep_validation_report.txt"),
      report
    );
    console.log("💾 Detailed report saved to: output/reports/deep_validation_report.txt");
    
    // Auto-fix if requested
    if (options.fix) {
      const fixResults = await geminiValidator.autoFixSentences(batches);
      
      if (fixResults.totalFixed > 0) {
        await applyFixes(fixResults.fixedSentences, sessionData);
        
        console.log(`\\n📊 Fix Summary:`);
        console.log(`   ✅ Fixed: ${fixResults.totalFixed} sentences`);
        console.log(`   ⚠️  Skipped: ${fixResults.totalSkipped} sentences`);
        console.log(`   💾 Updated session files automatically`);
        
        // Re-validate a sample to verify fixes
        console.log(`\\n🔍 Verifying fixes...`);
        await verifyFixes(fixResults.fixedSentences.slice(0, 10));
      } else {
        console.log(`\\n✅ No fixes needed - dataset quality is already excellent!`);
      }
    }
    
  } catch (error) {
    console.error("❌ Deep validation failed:", error);
    console.log("💡 Try running basic validation: bun run validate");
  }
}

async function createBackup(sessionData: Map<number, Sentence[]>) {
  console.log("💾 Creating backup before applying fixes...");
  
  const backupDir = join("./output", "backup");
  await Bun.write(join(backupDir, "backup_timestamp.txt"), new Date().toISOString());
  
  for (const [sessionNum, sentences] of sessionData) {
    const backupFile = join(backupDir, `session${sessionNum}_backup.json`);
    await writeFile(backupFile, JSON.stringify(sentences, null, 2));
  }
  
  console.log("✅ Backup created in output/backup/");
}

async function applyFixes(fixedSentences: Sentence[], sessionData: Map<number, Sentence[]>) {
  console.log("\\n💾 Applying fixes to session files...");
  
  // Group fixes by session
  const fixesBySession = new Map<number, Sentence[]>();
  for (const sentence of fixedSentences) {
    if (!fixesBySession.has(sentence.sessionNum)) {
      fixesBySession.set(sentence.sessionNum, []);
    }
    fixesBySession.get(sentence.sessionNum)!.push(sentence);
  }
  
  // Apply fixes to each session
  for (const [sessionNum, fixes] of fixesBySession) {
    const originalSentences = sessionData.get(sessionNum);
    if (!originalSentences) continue;
    
    // Create updated sentences array
    const updatedSentences = originalSentences.map(original => {
      const fix = fixes.find(f => f.id === original.id);
      return fix || original;
    });
    
    // Save updated session
    const sessionFile = join("./output/sentences", `session${sessionNum}.json`);
    await writeFile(sessionFile, JSON.stringify(updatedSentences, null, 2));
    
    // Update text file too
    const textFile = join("./output/sentences", `session${sessionNum}.txt`);
    const textContent = updatedSentences.map(s => `[${s.id}] ${s.text}`).join('\\n');
    await writeFile(textFile, textContent);
    
    console.log(`   ✅ Updated session ${sessionNum}: ${fixes.length} fixes applied`);
  }
}

async function verifyFixes(sampleSentences: Sentence[]) {
  if (sampleSentences.length === 0) return;
  
  const geminiValidator = new GeminiValidator();
  const batches = await geminiValidator.validateDataset(sampleSentences, { deep: true });
  
  const avgScore = batches.length > 0 ? batches[0].avgScore : 0;
  const issueCount = batches.reduce((sum, b) => sum + b.totalIssues, 0);
  
  console.log(`   📊 Sample verification (${sampleSentences.length} sentences):`);
  console.log(`   Average quality: ${avgScore.toFixed(1)}/10`);
  console.log(`   Remaining issues: ${issueCount}`);
  
  if (avgScore >= 8) {
    console.log(`   ✅ Fixes successful - quality improved!`);
  } else {
    console.log(`   ⚠️  Some issues may remain - consider manual review`);
  }
}

function analyzeDatasetBalance(sentences: Sentence[]) {
  console.log("\\n📈 Dataset Balance Analysis:");
  
  // Word count distribution
  const wordCountDist = new Map<number, number>();
  for (const s of sentences) {
    wordCountDist.set(s.wordCount, (wordCountDist.get(s.wordCount) || 0) + 1);
  }
  
  console.log("\\nWord count distribution:");
  const sortedCounts = Array.from(wordCountDist.entries()).sort((a, b) => a[0] - b[0]);
  for (const [count, freq] of sortedCounts) {
    const percentage = (freq / sentences.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(freq / sentences.length * 50));
    console.log(`  ${count} words: ${bar} ${freq} (${percentage}%)`);
  }
  
  // Session balance
  console.log("\\nSession balance:");
  const sessionGroups = new Map<number, Sentence[]>();
  for (const s of sentences) {
    if (!sessionGroups.has(s.sessionNum)) {
      sessionGroups.set(s.sessionNum, []);
    }
    sessionGroups.get(s.sessionNum)!.push(s);
  }
  
  for (const [session, sents] of sessionGroups) {
    const avgWords = sents.reduce((sum, s) => sum + s.wordCount, 0) / sents.length;
    const hours = (sents.length * 10) / 3600;
    console.log(`  Session ${session}: ${sents.length} sentences, avg ${avgWords.toFixed(1)} words, ${hours.toFixed(1)}h recording`);
  }
  
  // Check for duplicates
  const uniqueTexts = new Set(sentences.map(s => s.text.toLowerCase()));
  if (uniqueTexts.size < sentences.length) {
    console.log(`\\n⚠️  Found ${sentences.length - uniqueTexts.size} duplicate sentences`);
  } else {
    console.log("\\n✅ No duplicate sentences found");
  }
}

// Run validation
main().catch(console.error);