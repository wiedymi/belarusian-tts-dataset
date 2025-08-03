#!/usr/bin/env bun

import { mkdir, writeFile, readFile, exists } from "fs/promises";
import { join } from "path";
import { parseArgs } from "util";
import type { GenerationConfig, Sentence } from "./types";
import { BelarusianValidator } from "./validator";
import { normalizeBelarusianText, Spinner, ProgressTracker } from "./utils";
import { accentMarkerGrammarDB } from "./accent-utils-grammardb";
import { createMainPrompt, createStructuredPrompt, getSessionFocus, getTopicGuidance } from "./prompts";
import { OpenRouterClient, getOpenRouterConfig } from "./openrouter-client";
import { z } from "zod";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: {
      type: 'string',
      short: 'm',
      default: 'google/gemini-2.0-flash-exp:free',
    },
    sessions: {
      type: 'string',
      short: 's',
      default: '25',
    },
    'sentences-per-session': {
      type: 'string',
      default: '900',
    },
    'parallel-batches': {
      type: 'string',
      short: 'p',
      default: '3',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

if (values.help) {
  console.log(`
Belarusian TTS Dataset Generator with OpenRouter

Usage: bun run generate-dataset-openrouter.ts [options]

Options:
  -m, --model <model>              OpenRouter model to use (default: google/gemini-2.0-flash-exp:free)
  -s, --sessions <number>          Number of sessions to generate (default: 25)
  --sentences-per-session <number> Sentences per session (default: 900)
  -p, --parallel-batches <number>  Number of parallel batches (default: 3)
  -h, --help                       Show this help message

Available free models:
  - google/gemini-2.0-flash-exp:free (recommended)
  - google/gemini-1.5-flash:free
  - meta-llama/llama-3.2-1b-instruct:free
  - meta-llama/llama-3.1-8b-instruct:free
  - mistralai/mistral-7b-instruct:free

Environment variables:
  OPENROUTER_API_KEY    Your OpenRouter API key (required)
  OPENROUTER_MODEL      Default model (optional)

Example:
  export OPENROUTER_API_KEY="your-key-here"
  bun run generate-dataset-openrouter.ts -m google/gemini-2.0-flash-exp:free -s 5
`);
  process.exit(0);
}

const CONFIG: GenerationConfig = {
  model: values.model || "google/gemini-2.0-flash-exp:free",
  sentencesPerSession: parseInt(values['sentences-per-session'] || '900'),
  secondsPerSentence: 10,
  batchSize: 100,
  outputDir: "./output",
  sessionCount: parseInt(values.sessions || '25'),
  parallelBatches: parseInt(values['parallel-batches'] || '3'),
};

const SentenceSchema = z.object({
  sentences: z.array(z.object({
    text: z.string().describe("The Belarusian sentence text without any markers or IDs"),
    type: z.enum(['normal', 'question', 'emotional', 'whisper', 'nonverbal']).describe("Type of sentence"),
    marker: z.string().optional().describe("Emotion/action marker like 'радасна', 'шэпча', 'смяецца' (without parentheses)"),
  })).length(100).describe("Exactly 100 Belarusian sentences following the distribution requirements"),
});

class BelarusianDatasetGenerator {
  private generatedSentences: Sentence[] = [];
  private validator: BelarusianValidator;
  private spinner: Spinner;
  private sessionSentences: Map<number, Sentence[]> = new Map();
  private openRouterClient: OpenRouterClient;

  constructor(private config: GenerationConfig) {
    this.validator = new BelarusianValidator();
    this.spinner = new Spinner();
    
    const openRouterConfig = getOpenRouterConfig();
    openRouterConfig.model = config.model;
    this.openRouterClient = new OpenRouterClient(openRouterConfig);
  }

  async initialize() {
    console.log("🔧 Initializing Belarusian TTS Dataset Generator (OpenRouter Edition)...");
    console.log(`📋 Configuration:`);
    console.log(`   Model: ${this.config.model}`);
    console.log(`   Sessions: ${this.config.sessionCount}`);
    console.log(`   Sentences per session: ${this.config.sentencesPerSession}`);
    console.log(`   Total sentences: ${this.config.sessionCount * this.config.sentencesPerSession}`);
    console.log(`   Parallel batches: ${this.config.parallelBatches}`);
    console.log(`   Estimated time: ~${(this.config.sessionCount * this.config.sentencesPerSession * this.config.secondsPerSentence / 3600).toFixed(1)} hours`);
    
    await mkdir(this.config.outputDir, { recursive: true });
    await mkdir(join(this.config.outputDir, "sentences"), { recursive: true });
    await mkdir(join(this.config.outputDir, "srt"), { recursive: true });
    await mkdir(join(this.config.outputDir, "reports"), { recursive: true });
    await mkdir(join(this.config.outputDir, "prompts"), { recursive: true });
    await mkdir(join(this.config.outputDir, "temp"), { recursive: true });
    
    console.log("\n🔗 Testing OpenRouter connection...");
    try {
      const testResponse = await this.openRouterClient.generateText(
        "Say 'hello' in Belarusian",
        { maxTokens: 10 }
      );
      console.log(`✅ OpenRouter connected. Test response: ${testResponse.trim()}`);
    } catch (error) {
      console.error("❌ Failed to connect to OpenRouter:", error);
      throw error;
    }
    
    console.log("\n📚 Loading existing sessions...");
    for (let session = 1; session <= this.config.sessionCount; session++) {
      const sessionFile = join(this.config.outputDir, `sentences/session${session}.json`);
      if (await exists(sessionFile)) {
        const data = JSON.parse(await readFile(sessionFile, "utf-8"));
        const sentences = data.sentences || data;
        this.generatedSentences.push(...sentences);
        console.log(`   ✓ Loaded session ${session}: ${sentences.length} sentences`);
      }
    }
    
    console.log(`\n📊 Total existing sentences: ${this.generatedSentences.length}`);
  }

  async generate() {
    for (let session = 1; session <= this.config.sessionCount; session++) {
      const sessionFile = join(this.config.outputDir, `sentences/session${session}.json`);
      const tempFile = join(this.config.outputDir, `temp/session${session}_temp.json`);
      
      let existingSentences: Sentence[] = [];
      
      if (await exists(sessionFile)) {
        const data = JSON.parse(await readFile(sessionFile, "utf-8"));
        existingSentences = data.sentences || data;
        console.log(`\n✅ Session ${session} already complete (${existingSentences.length} sentences)`);
        continue;
      }
      
      if (await exists(tempFile)) {
        const data = JSON.parse(await readFile(tempFile, "utf-8"));
        existingSentences = data;
        console.log(`\n🔄 Resuming session ${session} from temp file (${existingSentences.length} sentences)`);
      }
      
      console.log(`\n📝 Session ${session}/${this.config.sessionCount} - ${existingSentences.length > 0 ? 'Resuming' : 'Starting'} generation`);
      console.log(`   Focus: ${getSessionFocus(session)}`);
      if (existingSentences.length > 0) {
        console.log(`   Existing: ${existingSentences.length} sentences`);
      }
      
      this.sessionSentences.set(session, existingSentences);
      
      const sentences = await this.generateSession(session, existingSentences);
      await this.saveSession(session, sentences);
    }

    console.log("\n✅ All sessions generated successfully!");
    await this.generateReports();
  }

  private async generateSession(sessionNum: number, existingSentences: Sentence[] = []): Promise<Sentence[]> {
    const sentences: Sentence[] = [...existingSentences];
    const batchesNeeded = Math.ceil((this.config.sentencesPerSession - sentences.length) / this.config.batchSize);
    
    if (batchesNeeded === 0) {
      return sentences;
    }

    const batchGroups = Math.ceil(batchesNeeded / this.config.parallelBatches);
    
    for (let groupIndex = 0; groupIndex < batchGroups; groupIndex++) {
      const startBatch = groupIndex * this.config.parallelBatches;
      const endBatch = Math.min(startBatch + this.config.parallelBatches, batchesNeeded);
      const batchesInGroup = endBatch - startBatch;
      
      console.log(`\n📦 Batch group ${groupIndex + 1}/${batchGroups} (${batchesInGroup} parallel batches)`);
      
      const batchPromises = [];
      for (let i = startBatch; i < endBatch; i++) {
        const currentBatchNum = Math.floor(sentences.length / this.config.batchSize) + i - startBatch;
        batchPromises.push(this.generateBatchWithInfo(sessionNum, currentBatchNum));
      }
      
      const results = await Promise.all(batchPromises);
      
      for (const result of results) {
        sentences.push(...result.sentences);
        this.sessionSentences.set(sessionNum, [...sentences]);
      }
      
      if (sentences.length % 100 === 0 || sentences.length >= this.config.sentencesPerSession) {
        await this.saveIncremental(sessionNum, sentences);
      }
      
      const totalInGroup = results.reduce((sum, r) => sum + r.sentences.length, 0);
      console.log(`✅ Batch group complete: ${totalInGroup} sentences generated`);
      console.log(`💾 Progress saved: ${sentences.length}/${this.config.sentencesPerSession} sentences for session ${sessionNum}`);
    }
    
    return sentences.slice(0, this.config.sentencesPerSession);
  }

  private async saveIncremental(sessionNum: number, sentences: Sentence[]) {
    const tempFile = join(this.config.outputDir, `temp/session${sessionNum}_temp.json`);
    await writeFile(tempFile, JSON.stringify(sentences, null, 2));
    
    const textFile = join(this.config.outputDir, `temp/session${sessionNum}_temp.txt`);
    const textContent = sentences.map(s => `[${s.id}] ${s.text}`).join('\n');
    await writeFile(textFile, textContent);
  }

  private async generateBatchWithInfo(sessionNum: number, batchNum: number): Promise<{
    batchNum: number;
    sentences: Sentence[];
  }> {
    console.log(`   🔸 Starting batch ${batchNum + 1} - ${getTopicGuidance(batchNum)}`);
    
    let retryCount = 0;
    const maxBatchRetries = 3;
    
    while (retryCount < maxBatchRetries) {
      try {
        const sentences = await this.generateBatch(sessionNum, batchNum);
        
        if (sentences.length === 0) {
          retryCount++;
          console.log(`   ⚠️  Batch ${batchNum + 1} returned 0 sentences. Retry ${retryCount}/${maxBatchRetries}...`);
          if (retryCount < maxBatchRetries) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
        }
        
        console.log(`   ✅ Batch ${batchNum + 1} complete: ${sentences.length} sentences`);
        
        if (sentences.length > 0) {
          const samples = sentences.slice(0, 2);
          samples.forEach(s => {
            console.log(`      → ${s.text}`);
          });
          if (sentences.length > 2) {
            console.log(`      ... and ${sentences.length - 2} more`);
          }
        }
        
        return { batchNum, sentences };
      } catch (error) {
        console.error(`   ❌ Batch ${batchNum + 1} failed:`, error);
        retryCount++;
        
        if (retryCount < maxBatchRetries) {
          console.log(`   🔄 Retrying batch ${batchNum + 1} (attempt ${retryCount + 1}/${maxBatchRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          console.log(`   ❌ Batch ${batchNum + 1} failed after ${maxBatchRetries} attempts`);
          return { batchNum, sentences: [] };
        }
      }
    }
    
    return { batchNum, sentences: [] };
  }

  private async generateBatch(sessionNum: number, batchNum: number): Promise<Sentence[]> {
    const previousSentences = this.getPreviousSentences(sessionNum, batchNum);
    const prompt = createStructuredPrompt(sessionNum, batchNum, previousSentences);
    
    await writeFile(
      join(this.config.outputDir, `prompts/session${sessionNum}_batch${batchNum}.txt`),
      prompt
    );

    const startTime = Date.now();
    
    try {
      const result = await this.openRouterClient.generateStructuredData(
        prompt,
        SentenceSchema,
        { 
          temperature: 0.8, 
          maxTokens: 8000,
          retryOptions: {
            maxRetries: 5,
            initialDelay: 3000,
            maxDelay: 60000,
          }
        }
      );
      
      const apiTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`      ⏱️  API response time: ${apiTime}s`);
      console.log(`      📊 Received ${result.sentences.length} structured sentences`);
      
      const sentences: Sentence[] = [];
      const baseNum = sessionNum * 10000 + batchNum * 100;
      
      for (let i = 0; i < result.sentences.length; i++) {
        const structured = result.sentences[i];
        const sentenceId = String(baseNum + i + 1).padStart(5, '0');
        
        const fullText = structured.marker 
          ? `(${structured.marker}) ${structured.text}`
          : structured.text;
        
        const sentenceData = this.detectSentenceType(fullText);
        
        let accentInfo = { accentedText: fullText, accentedWords: [] as any[] };
        if (sentenceData.sentenceType !== 'nonverbal') {
          accentInfo = await accentMarkerGrammarDB.analyzeAndAccent(fullText);
        }
        
        const sentence: Sentence = {
          id: `${sessionNum}_${sentenceId}`,
          text: fullText,
          sessionNum,
          batchNum,
          sentenceType: sentenceData.sentenceType,
          emotionType: sentenceData.emotionType,
          nonVerbalType: sentenceData.nonVerbalType,
          wordCount: sentenceData.wordCount,
          hasQuestionMark: sentenceData.hasQuestionMark,
          hasExclamation: sentenceData.hasExclamation,
          normalizedText: normalizeBelarusianText(fullText),
          accentedText: accentInfo.accentedText,
          accentedWords: accentInfo.accentedWords,
          duration: this.config.secondsPerSentence,
          phonemeData: {
            hasUSound: /ў/.test(fullText),
            hasDzSound: /дз/.test(fullText),
            hasDzhSound: /дж/.test(fullText),
            hasSoftSign: /ь/.test(fullText),
          },
        };
        
        const validation = this.validator.validateSentence(sentence);
        if (validation.isValid) {
          sentences.push(sentence);
        } else {
          console.log(`      ⚠️  Invalid sentence skipped: "${fullText}"`);
          console.log(`         Reason: ${validation.issues.join(', ')}`);
        }
      }
      
      return sentences;
    } catch (error) {
      console.error(`      ❌ API call failed:`, error);
      throw error;
    }
  }

  private getPreviousSentences(sessionNum: number, batchNum: number): string[] {
    const currentSessionSentences = this.sessionSentences.get(sessionNum) || [];
    const allGeneratedSentences = this.generatedSentences;
    
    const recentSentences: string[] = [];
    
    if (allGeneratedSentences.length > 0) {
      const previousSessionSentences = allGeneratedSentences
        .filter(s => s.sessionNum < sessionNum)
        .slice(-100)
        .map(s => s.text);
      recentSentences.push(...previousSessionSentences);
    }
    
    if (currentSessionSentences.length > 0) {
      const currentTexts = currentSessionSentences.map(s => s.text);
      recentSentences.push(...currentTexts);
    }
    
    return recentSentences.slice(-200);
  }

  private createPrompt(sessionNum: number, batchNum: number, previousSentences: string[] = []): string {
    return createMainPrompt(sessionNum, batchNum, previousSentences);
  }

  private async parseSentences(response: string, sessionNum: number, batchNum: number): Promise<Sentence[]> {
    const sentences: Sentence[] = [];
    const lines = response.split('\n');
    const seenTexts = new Set<string>();
    
    const sentenceRegex = /\[(\d{5})\]\s+(.+)/;
    
    for (const line of lines) {
      const match = line.match(sentenceRegex);
      if (match) {
        const [, id, text] = match;
        const cleanText = text.trim();
        
        if (seenTexts.has(cleanText)) {
          console.log(`      ⚠️  Skipping duplicate: "${cleanText}"`);
          continue;
        }
        
        const isDuplicateInSession = this.isDuplicateText(cleanText, sessionNum);
        if (isDuplicateInSession) {
          console.log(`      ⚠️  Skipping session duplicate: "${cleanText}"`);
          continue;
        }
        
        seenTexts.add(cleanText);
        
        const sentenceData = this.detectSentenceType(cleanText);
        
        let accentInfo = { accentedText: cleanText, accentedWords: [] as any[] };
        if (sentenceData.sentenceType !== 'nonverbal') {
          accentInfo = await accentMarkerGrammarDB.analyzeAndAccent(cleanText);
        }
        
        const sentence: Sentence = {
          id: `${sessionNum}_${id}`,
          text: cleanText,
          sessionNum,
          batchNum,
          sentenceType: sentenceData.sentenceType,
          emotionType: sentenceData.emotionType,
          nonVerbalType: sentenceData.nonVerbalType,
          wordCount: sentenceData.wordCount,
          hasQuestionMark: sentenceData.hasQuestionMark,
          hasExclamation: sentenceData.hasExclamation,
          normalizedText: normalizeBelarusianText(cleanText),
          accentedText: accentInfo.accentedText,
          accentedWords: accentInfo.accentedWords,
          duration: this.config.secondsPerSentence,
          phonemeData: {
            hasUSound: /ў/.test(cleanText),
            hasDzSound: /дз/.test(cleanText),
            hasDzhSound: /дж/.test(cleanText),
            hasSoftSign: /ь/.test(cleanText),
          },
        };
        
        const validation = this.validator.validateSentence(sentence);
        if (validation.isValid) {
          sentences.push(sentence);
        } else {
          console.log(`      ⚠️  Invalid sentence skipped: "${cleanText}"`);
          console.log(`         Reason: ${validation.issues.join(', ')}`);
        }
      }
    }
    
    return sentences;
  }

  private isDuplicateText(text: string, currentSessionNum: number): boolean {
    const currentSessionSentences = this.sessionSentences.get(currentSessionNum) || [];
    if (currentSessionSentences.some(s => s.text === text)) {
      return true;
    }
    
    if (this.generatedSentences.some(s => s.text === text)) {
      return true;
    }
    
    return false;
  }

  private detectSentenceType(text: string): {
    sentenceType: 'normal' | 'question' | 'emotional' | 'whisper' | 'nonverbal';
    emotionType?: string;
    nonVerbalType?: string;
    wordCount: number;
    hasQuestionMark: boolean;
    hasExclamation: boolean;
  } {
    const hasQuestionMark = text.includes('?');
    const hasExclamation = text.includes('!');
    
    const emotionalMarkers = [
      'радасна', 'сумна', 'злосна', 'здзіўлена', 'з любоўю', 
      'са страхам', 'расчаравана', 'з гонарам', 'з трывогай', 
      'весела', 'з нецярпеннем', 'ўзрушана'
    ];
    
    const whisperMarkers = ['шэпча', 'ціха', 'ледзь чутна'];
    
    const nonVerbalMarkers = [
      'смяецца', 'уздыхае', 'плача', 'крычыць', 'кашляе', 
      'чыхае', 'стогне', 'пазяхае', 'ахае'
    ];
    
    const markerRegex = /\(([^)]+)\)/;
    const markerMatch = text.match(markerRegex);
    const marker = markerMatch ? markerMatch[1] : '';
    const textWithoutMarker = text.replace(markerRegex, '').trim();
    
    const wordCount = textWithoutMarker.split(/\s+/).filter(w => w.length > 0).length;
    
    if (marker) {
      if (whisperMarkers.some(m => marker.includes(m))) {
        return { sentenceType: 'whisper', wordCount, hasQuestionMark, hasExclamation };
      }
      if (emotionalMarkers.some(m => marker.includes(m))) {
        return { sentenceType: 'emotional', emotionType: marker, wordCount, hasQuestionMark, hasExclamation };
      }
      if (nonVerbalMarkers.some(m => marker.includes(m))) {
        return { sentenceType: 'nonverbal', nonVerbalType: marker, wordCount, hasQuestionMark, hasExclamation };
      }
    }
    
    // Questions (check content, not just punctuation)
    if (hasQuestionMark) {
      return { sentenceType: 'question', wordCount, hasQuestionMark, hasExclamation };
    }
    
    // Default to normal
    return { sentenceType: 'normal', wordCount, hasQuestionMark, hasExclamation };
  }

  private async saveSession(sessionNum: number, sentences: Sentence[]) {
    const sessionFile = join(this.config.outputDir, `sentences/session${sessionNum}.json`);
    const textFile = join(this.config.outputDir, `sentences/session${sessionNum}.txt`);
    const srtFile = join(this.config.outputDir, `srt/session${sessionNum}.srt`);
    
    // Save JSON
    await writeFile(sessionFile, JSON.stringify({ 
      metadata: {
        sessionNum,
        sentenceCount: sentences.length,
        generatedAt: new Date().toISOString(),
        model: this.config.model,
      },
      sentences 
    }, null, 2));
    
    // Save text with accents
    const textLines = sentences.map(s => {
      const line = `[${s.id}] ${s.text}`;
      if (s.accentedText && s.accentedText !== s.text) {
        return `${line}\n         → ${s.accentedText}`;
      }
      return line;
    });
    await writeFile(textFile, textLines.join('\n'));
    
    // Generate SRT
    await this.generateSRT(sentences, srtFile);
    
    console.log(`✅ Session ${sessionNum} saved: ${sentences.length} sentences`);
    
    // Clean up temp file
    const tempFile = join(this.config.outputDir, `temp/session${sessionNum}_temp.json`);
    const tempTextFile = join(this.config.outputDir, `temp/session${sessionNum}_temp.txt`);
    try {
      if (await exists(tempFile)) {
        await Bun.file(tempFile).unlink();
      }
      if (await exists(tempTextFile)) {
        await Bun.file(tempTextFile).unlink();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  private async generateSRT(sentences: Sentence[], outputPath: string) {
    let srtContent = '';
    let currentTime = 0;
    const gapBetweenSentences = 2; // 2 seconds gap
    
    sentences.forEach((sentence, index) => {
      const startTime = currentTime;
      const endTime = startTime + sentence.duration;
      
      // Format time as HH:MM:SS,mmm
      const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
      };
      
      // Add subtitle entry
      srtContent += `${index + 1}\n`;
      srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
      
      // Use accented text if available, otherwise use original
      const displayText = sentence.accentedText || sentence.text;
      srtContent += `${displayText}\n`;
      
      // Add metadata as comment
      const metadata = [];
      if (sentence.sentenceType !== 'normal') {
        metadata.push(`Type: ${sentence.sentenceType}`);
      }
      if (sentence.emotionType) {
        metadata.push(`Emotion: ${sentence.emotionType}`);
      }
      if (metadata.length > 0) {
        srtContent += `[${metadata.join(', ')}]\n`;
      }
      
      srtContent += '\n';
      
      // Update time for next subtitle
      currentTime = endTime + gapBetweenSentences;
    });
    
    await writeFile(outputPath, srtContent);
  }

  private async generateReports() {
    console.log("\n📊 Generating reports...");
    
    // Collect all sentences
    const allSentences: Sentence[] = [];
    for (let session = 1; session <= this.config.sessionCount; session++) {
      const sessionFile = join(this.config.outputDir, `sentences/session${session}.json`);
      if (await exists(sessionFile)) {
        const data = JSON.parse(await readFile(sessionFile, "utf-8"));
        allSentences.push(...(data.sentences || data));
      }
    }
    
    // Generate statistics
    const stats = {
      totalSentences: allSentences.length,
      byType: {
        normal: allSentences.filter(s => s.sentenceType === 'normal').length,
        question: allSentences.filter(s => s.sentenceType === 'question').length,
        emotional: allSentences.filter(s => s.sentenceType === 'emotional').length,
        whisper: allSentences.filter(s => s.sentenceType === 'whisper').length,
        nonverbal: allSentences.filter(s => s.sentenceType === 'nonverbal').length,
      },
      phonemeStats: {
        withUSound: allSentences.filter(s => s.phonemeData?.hasUSound).length,
        withDzSound: allSentences.filter(s => s.phonemeData?.hasDzSound).length,
        withDzhSound: allSentences.filter(s => s.phonemeData?.hasDzhSound).length,
        withSoftSign: allSentences.filter(s => s.phonemeData?.hasSoftSign).length,
      },
      averageWordCount: allSentences.reduce((sum, s) => sum + s.wordCount, 0) / allSentences.length,
      totalDuration: allSentences.reduce((sum, s) => sum + s.duration, 0),
    };
    
    await writeFile(
      join(this.config.outputDir, "reports/statistics.json"),
      JSON.stringify(stats, null, 2)
    );
    
    console.log("✅ Reports generated");
    console.log(`   Total sentences: ${stats.totalSentences}`);
    console.log(`   Distribution: ${stats.byType.normal} normal, ${stats.byType.question} questions, ${stats.byType.emotional} emotional`);
    console.log(`   Phoneme coverage: ${stats.phonemeStats.withUSound} with ў, ${stats.phonemeStats.withDzSound} with дз/дж`);
  }
}

// Main execution
async function main() {
  try {
    const generator = new BelarusianDatasetGenerator(CONFIG);
    await generator.initialize();
    await generator.generate();
  } catch (error) {
    console.error("❌ Generation failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}