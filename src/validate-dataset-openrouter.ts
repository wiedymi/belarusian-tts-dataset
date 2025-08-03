#!/usr/bin/env bun

import { readFile, writeFile, readdir, exists, mkdir } from "fs/promises";
import { join, basename } from "path";
import { parseArgs } from "util";
import type { Sentence } from "./types";
import { validateWithOpenRouter } from "./openrouter-validator";

// Parse command line arguments
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: {
      type: 'string',
      short: 'm',
      default: 'google/gemini-2.0-flash-exp:free',
    },
    fix: {
      type: 'boolean',
      short: 'f',
    },
    session: {
      type: 'string',
      short: 's',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

if (values.help) {
  console.log(`
Belarusian TTS Dataset Validator with OpenRouter

Usage: bun run validate-dataset-openrouter.ts [options]

Options:
  -m, --model <model>   OpenRouter model to use (default: google/gemini-2.0-flash-exp:free)
  -f, --fix            Attempt to fix issues found during validation
  -s, --session <num>  Validate specific session only
  -h, --help          Show this help message

Environment variables:
  OPENROUTER_API_KEY   Your OpenRouter API key (required)

Example:
  export OPENROUTER_API_KEY="your-key-here"
  bun run validate-dataset-openrouter.ts --fix
  bun run validate-dataset-openrouter.ts -s 1 -m anthropic/claude-3.5-sonnet
`);
  process.exit(0);
}

async function loadSentences(sessionNum?: number): Promise<Sentence[]> {
  const sentences: Sentence[] = [];
  const sentencesDir = "./output/sentences";
  
  if (!await exists(sentencesDir)) {
    console.error("❌ No sentences directory found. Run generation first.");
    return sentences;
  }
  
  const files = await readdir(sentencesDir);
  const sessionFiles = files
    .filter(f => f.endsWith('.json'))
    .filter(f => !sessionNum || f === `session${sessionNum}.json`)
    .sort();
  
  for (const file of sessionFiles) {
    try {
      const data = JSON.parse(await readFile(join(sentencesDir, file), "utf-8"));
      const sessionSentences = data.sentences || data;
      sentences.push(...sessionSentences);
      console.log(`📖 Loaded ${file}: ${sessionSentences.length} sentences`);
    } catch (error) {
      console.error(`❌ Failed to load ${file}:`, error);
    }
  }
  
  return sentences;
}

async function saveSentences(sentences: Sentence[], backupOriginal: boolean = true) {
  const sentencesDir = "./output/sentences";
  const backupDir = "./output/backup";
  
  // Group sentences by session
  const sessionMap = new Map<number, Sentence[]>();
  sentences.forEach(s => {
    const session = s.sessionNum || 1;
    if (!sessionMap.has(session)) {
      sessionMap.set(session, []);
    }
    sessionMap.get(session)!.push(s);
  });
  
  // Create backup if requested
  if (backupOriginal) {
    await mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(backupDir, `backup_${timestamp}.txt`), `Backup created at ${timestamp}`);
    
    // Copy original files
    for (const [sessionNum, _] of sessionMap) {
      const originalFile = join(sentencesDir, `session${sessionNum}.json`);
      if (await exists(originalFile)) {
        const backupFile = join(backupDir, `session${sessionNum}_${timestamp}.json`);
        const content = await readFile(originalFile, "utf-8");
        await writeFile(backupFile, content);
      }
    }
    console.log(`📦 Backed up ${sessionMap.size} session files`);
  }
  
  // Save updated sentences
  for (const [sessionNum, sessionSentences] of sessionMap) {
    const sessionFile = join(sentencesDir, `session${sessionNum}.json`);
    const textFile = join(sentencesDir, `session${sessionNum}.txt`);
    
    // Save JSON
    await writeFile(sessionFile, JSON.stringify({
      metadata: {
        sessionNum,
        sentenceCount: sessionSentences.length,
        generatedAt: new Date().toISOString(),
        lastValidated: new Date().toISOString(),
      },
      sentences: sessionSentences
    }, null, 2));
    
    // Save text with accents
    const textLines = sessionSentences.map(s => {
      const line = `[${s.id}] ${s.text}`;
      if (s.accentedText && s.accentedText !== s.text) {
        return `${line}\n         → ${s.accentedText}`;
      }
      return line;
    });
    await writeFile(textFile, textLines.join('\n'));
  }
  
  console.log(`💾 Updated ${sessionMap.size} session files`);
}

async function main() {
  console.log("🔍 Belarusian TTS Dataset Validator (OpenRouter Edition)\n");
  
  // Load sentences
  const sessionNum = values.session ? parseInt(values.session) : undefined;
  const sentences = await loadSentences(sessionNum);
  
  if (sentences.length === 0) {
    console.error("❌ No sentences found to validate");
    return;
  }
  
  console.log(`\n📊 Loaded ${sentences.length} sentences for validation`);
  
  // Validate with OpenRouter
  const result = await validateWithOpenRouter(sentences, {
    model: values.model,
    fix: values.fix,
  });
  
  // Save validation report
  const reportsDir = "./output/reports";
  await mkdir(reportsDir, { recursive: true });
  
  const reportFile = join(reportsDir, `validation_openrouter_${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(reportFile, JSON.stringify({
    date: new Date().toISOString(),
    model: values.model || 'google/gemini-2.0-flash-exp:free',
    options: { fix: values.fix },
    results: result,
  }, null, 2));
  
  console.log(`\n📄 Validation report saved to: ${reportFile}`);
  
  // If fixes were applied and we have suggested fixes, save them
  if (values.fix && result.suggestedFixes.length > 0) {
    console.log(`\n🔧 Applying ${result.suggestedFixes.length} fixes...`);
    
    // Apply fixes to sentences
    const fixedSentences = sentences.map(s => {
      const fix = result.suggestedFixes.find(f => f.original === s.text);
      if (fix) {
        return {
          ...s,
          text: fix.suggested,
          accentedText: fix.suggested, // Will be re-accented if needed
        };
      }
      return s;
    });
    
    // Save fixed sentences
    await saveSentences(fixedSentences, true);
    console.log("✅ Fixes applied and saved!");
  }
  
  // Show summary of issues that need manual attention
  if (result.invalidSentences > 0) {
    console.log(`\n⚠️  ${result.invalidSentences} sentences need attention:`);
    const detailedResults = (result as any).detailedResults;
    if (detailedResults) {
      const lowScores = detailedResults
        .filter((r: any) => r.score < 7)
        .slice(0, 10);
      
      lowScores.forEach((r: any) => {
        console.log(`\n   [${r.sentence.id}] Score: ${r.score}/10`);
        console.log(`   Text: ${r.sentence.text}`);
        console.log(`   Issues: ${r.issues.join(', ')}`);
        if (r.correctedText) {
          console.log(`   Suggested: ${r.correctedText}`);
        }
      });
      
      if (detailedResults.filter((r: any) => r.score < 7).length > 10) {
        console.log(`\n   ... and ${detailedResults.filter((r: any) => r.score < 7).length - 10} more`);
      }
    }
  }
}

if (import.meta.main) {
  main().catch(console.error);
}