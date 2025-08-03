#!/usr/bin/env bun

import { $ } from "bun";
import { mkdir, writeFile, readFile, exists } from "fs/promises";
import { join } from "path";
import type { GenerationConfig, Sentence } from "./types";
import { BelarusianValidator } from "./validator";
import { normalizeBelarusianText } from "./utils";
import { callGeminiWithRetry, RateLimiter, ApiError } from "./api-utils";
import { accentMarkerGrammarDB } from "./accent-utils-grammardb";
import { createMainPrompt, getSessionFocus, getTopicGuidance } from "./prompts";
import { CLISpinner, CLIProgress, createHeader, formatSection, formatInfo, formatSuccess, formatError, formatWarning, formatListItem } from "./cli-utils";

const CONFIG: GenerationConfig = {
  model: "gemini-2.5-pro",
  sentencesPerSession: 900,     // 2.5 hours per session
  secondsPerSentence: 10,
  batchSize: 300,               // Increased to 300 to use fewer API calls (3 calls per session)
  outputDir: "./output",
  sessionCount: 25,             // 25 sessions = 22,500 sentences (~62.5 hours)
  parallelBatches: 1,           // No parallel for gemini-2.5-pro due to rate limits
};

class BelarusianDatasetGenerator {
  private generatedSentences: Sentence[] = [];
  private validator: BelarusianValidator;
  private spinner: CLISpinner;
  private sessionSentences: Map<number, Sentence[]> = new Map();
  private rateLimiter: RateLimiter;

  constructor(private config: GenerationConfig) {
    this.validator = new BelarusianValidator();
    this.spinner = new CLISpinner();
    // Initialize rate limiter based on model
    const rateLimits = {
      'gemini-2.5-pro': { rpm: 5, minDelay: 12000 },      // 5 RPM = 12s between calls
      'gemini-2.5-flash': { rpm: 10, minDelay: 6000 },    // 10 RPM = 6s between calls
      'gemini-2.5-flash-lite': { rpm: 15, minDelay: 4000 }, // 15 RPM = 4s between calls
      'gemini-2.0-flash': { rpm: 15, minDelay: 4000 },    // 15 RPM = 4s between calls
      'gemini-2.0-flash-lite': { rpm: 30, minDelay: 2000 }, // 30 RPM = 2s between calls
    };
    const limits = rateLimits[this.config.model] || { rpm: 10, minDelay: 6000 };
    this.rateLimiter = new RateLimiter(limits.rpm, limits.minDelay);
  }

  async initialize() {
    console.log(createHeader(
      "Dataset Generator v1.0.0",
      "Incremental Save Mode - Never Lose Progress"
    ));
    
    console.log(formatSection("Configuration"));
    console.log(formatInfo("Model", this.config.model));
    console.log(formatInfo("Sessions", this.config.sessionCount));
    console.log(formatInfo("Sentences per session", this.config.sentencesPerSession));
    console.log(formatInfo("Total sentences", this.config.sessionCount * this.config.sentencesPerSession));
    console.log(formatInfo("Parallel batches", this.config.parallelBatches || 1));
    console.log(formatInfo("Output directory", this.config.outputDir));
    
    console.log(formatSection("Initializing GrammarDB"));
    await accentMarkerGrammarDB.initialize();

    this.spinner.start("Creating output directories...");
    
    // Create output directories
    await mkdir(join(this.config.outputDir, "sentences"), { recursive: true });
    await mkdir(join(this.config.outputDir, "srt"), { recursive: true });
    await mkdir(join(this.config.outputDir, "reports"), { recursive: true });
    await mkdir(join(this.config.outputDir, "prompts"), { recursive: true });
    await mkdir(join(this.config.outputDir, "temp"), { recursive: true });

    this.spinner.succeed("Initialization complete");
  }

  private async loadExistingData() {
    console.log(formatSection("Checking for existing progress"));
    
    for (let session = 1; session <= this.config.sessionCount; session++) {
      const sessionFile = join(this.config.outputDir, `sentences/session${session}.json`);
      
      if (await exists(sessionFile)) {
        try {
          const content = await readFile(sessionFile, 'utf-8');
          const data = JSON.parse(content);
          // Handle both old format (array) and new format (object with sentences property)
          const sentences: Sentence[] = Array.isArray(data) ? data : (data.sentences || []);
          this.sessionSentences.set(session, sentences);
          this.generatedSentences.push(...sentences);
          console.log(formatSuccess(`Found session ${session}: ${sentences.length} sentences`));
        } catch (error) {
          console.log(formatWarning(`Session ${session} file exists but is corrupted`));
        }
      }
    }
    
    if (this.generatedSentences.length > 0) {
      console.log(formatInfo("Total existing sentences", this.generatedSentences.length));
    }
  }

  async generate() {
    await this.initialize();
    await this.loadExistingData();
    
    const totalSentences = this.config.sessionCount * this.config.sentencesPerSession;
    const remainingSentences = totalSentences - this.generatedSentences.length;
    
    if (remainingSentences <= 0) {
      console.log(formatSuccess("Dataset already complete!"));
      return;
    }
    
    console.log(formatSection("Starting dataset generation"));
    console.log(formatInfo("Target", `${totalSentences} sentences across ${this.config.sessionCount} sessions`));
    console.log();
    console.log(); // Extra line for visual separation

    // Create overall progress tracker
    const totalProgress = new CLIProgress(totalSentences, "Overall Progress");
    if (this.generatedSentences.length > 0) {
      totalProgress.update(this.generatedSentences.length);
    }
    
    for (let session = 1; session <= this.config.sessionCount; session++) {
      // Skip if session already complete
      const existingSentences = this.sessionSentences.get(session) || [];
      if (existingSentences.length >= this.config.sentencesPerSession) {
        console.log(formatSuccess(`Session ${session} already complete (${existingSentences.length} sentences)`));
        continue;
      }
      
      // Use progress.log if available, otherwise console.log
      const log = (msg: string) => totalProgress ? totalProgress.log(msg) : console.log(msg);
      
      log(formatSection(`Session ${session}/${this.config.sessionCount} - ${existingSentences.length > 0 ? 'Resuming' : 'Starting'} generation`));
      log(formatInfo("Focus", getSessionFocus(session)));
      if (existingSentences.length > 0) {
        log(formatInfo("Existing", `${existingSentences.length} sentences`));
      }
      
      const sentences = await this.generateSession(session, totalProgress, existingSentences);
      
      // Final save for the session
      this.spinner.start(`Finalizing session ${session}...`);
      await this.saveSentences(sentences, session);
      await this.createSRT(sentences, session);
      this.spinner.succeed(`Session ${session} complete: ${sentences.length} sentences`);
      
      this.sessionSentences.set(session, sentences);
    }
    
    totalProgress.complete();
    console.log(formatSection("Generating final report"));
    await this.generateReport();
    console.log("\n" + formatSuccess("Dataset generation complete!"));
  }

  private async generateSession(
    sessionNum: number, 
    totalProgress?: CLIProgress,
    existingSentences: Sentence[] = []
  ): Promise<Sentence[]> {
    // Ensure existingSentences is always an array
    const sentences: Sentence[] = Array.isArray(existingSentences) ? [...existingSentences] : [];
    const batchCount = Math.ceil(this.config.sentencesPerSession / this.config.batchSize);
    
    // Adjust parallel batches based on rate limits
    const modelLimits = {
      'gemini-2.5-pro': 1,        // 5 RPM - no parallelism
      'gemini-2.5-flash': 2,      // 10 RPM - limited parallelism
      'gemini-2.5-flash-lite': 3, // 15 RPM
      'gemini-2.0-flash': 3,      // 15 RPM
      'gemini-2.0-flash-lite': 5, // 30 RPM - more parallelism
    };
    const maxParallel = modelLimits[this.config.model] || 2;
    const parallelBatches = Math.min(this.config.parallelBatches || 1, maxParallel);
    
    // Calculate which batches to skip
    const completedBatches = Math.floor(existingSentences.length / this.config.batchSize);
    const startBatch = completedBatches;
    
    if (totalProgress) {
      totalProgress.log(formatInfo("Processing", `${batchCount - startBatch} batches with ${parallelBatches} parallel workers`));
    } else {
      console.log(formatInfo("Processing", `${batchCount - startBatch} batches with ${parallelBatches} parallel workers`));
    }
    
    // Process batches in parallel groups
    for (let i = startBatch; i < batchCount; i += parallelBatches) {
      const batchGroup = [];
      const groupSize = Math.min(parallelBatches, batchCount - i);
      
      if (totalProgress) {
        totalProgress.log(formatSection(`Batch group ${Math.floor((i - startBatch) / parallelBatches) + 1}/${Math.ceil((batchCount - startBatch) / parallelBatches)} (${groupSize} parallel batches)`));
      } else {
        console.log(formatSection(`Batch group ${Math.floor((i - startBatch) / parallelBatches) + 1}/${Math.ceil((batchCount - startBatch) / parallelBatches)} (${groupSize} parallel batches)`));
      }
      
      // Create promises for parallel batch processing
      for (let j = 0; j < groupSize; j++) {
        const batchNum = i + j;
        if (batchNum < batchCount) {
          batchGroup.push(this.generateBatchWithInfo(sessionNum, batchNum, totalProgress));
        }
      }
      
      // Wait for all batches in the group to complete
      const results = await Promise.all(batchGroup);
      
      // Process results and save incrementally
      for (const result of results) {
        sentences.push(...result.sentences);
        
        // Save after each batch completes
        await this.saveIncremental(sessionNum, sentences);
        
        if (totalProgress) {
          totalProgress.update(
            this.generatedSentences.length + sentences.length
          );
        }
      }
      
      // Use the progress log method to print messages above the progress bar
      if (totalProgress) {
        totalProgress.log(formatSuccess(`Batch group complete: ${results.reduce((sum, r) => sum + r.sentences.length, 0)} sentences generated`));
        totalProgress.log(formatInfo("Progress saved", `${sentences.length}/${this.config.sentencesPerSession} sentences for session ${sessionNum}`));
      } else {
        console.log(formatSuccess(`Batch group complete: ${results.reduce((sum, r) => sum + r.sentences.length, 0)} sentences generated`));
        console.log(formatInfo("Progress saved", `${sentences.length}/${this.config.sentencesPerSession} sentences for session ${sessionNum}`));
      }
    }
    
    return sentences;
  }

  private async generateBatchWithInfo(sessionNum: number, batchNum: number, progress?: CLIProgress): Promise<{
    batchNum: number;
    sentences: Sentence[];
  }> {
    const topicGuidance = getTopicGuidance(batchNum);
    const log = (msg: string) => progress ? progress.log(msg) : console.log(msg);
    
    log(formatListItem(`Starting batch ${batchNum + 1} - ${topicGuidance}`, 3));
    
    let retryCount = 0;
    const maxRetries = 5; // Increased from 3 to 5
    
    while (retryCount < maxRetries) {
      try {
        const sentences = await this.generateBatch(sessionNum, batchNum);
        
        // If we got 0 sentences, retry
        if (sentences.length === 0 && retryCount < maxRetries - 1) {
          retryCount++;
          const delay = Math.min(5000 * retryCount, 20000); // Progressive delay: 5s, 10s, 15s, 20s
          log(formatWarning(`Batch ${batchNum + 1} returned 0 sentences, retrying (${retryCount}/${maxRetries - 1}) in ${delay/1000}s...`, 6));
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // If we still got 0 sentences after all retries, it's a critical error
        if (sentences.length === 0) {
          log(formatError(`CRITICAL: Batch ${batchNum + 1} returned 0 sentences after ${retryCount + 1} attempts. Stopping generation.`, 6));
          process.exit(1);
        }
        
        log(formatSuccess(`Batch ${batchNum + 1} complete: ${sentences.length} sentences`, 6));
        return { batchNum, sentences };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (retryCount < maxRetries - 1) {
          retryCount++;
          const delay = Math.min(5000 * retryCount, 20000); // Progressive delay: 5s, 10s, 15s, 20s
          log(formatWarning(`Batch ${batchNum + 1} failed: ${errorMessage}, retrying (${retryCount}/${maxRetries - 1}) in ${delay/1000}s...`, 6));
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        log(formatError(`Batch ${batchNum + 1} failed after ${maxRetries} attempts: ${errorMessage}`, 6));
        console.error(error);
        return { batchNum, sentences: [] };
      }
    }
    
    // Should not reach here, but just in case
    return { batchNum, sentences: [] };
  }

  private async saveIncremental(sessionNum: number, sentences: Sentence[]) {
    const tempFile = join(this.config.outputDir, `temp/session${sessionNum}_temp.json`);
    await writeFile(tempFile, JSON.stringify(sentences, null, 2));
  }

  private async generateBatch(sessionNum: number, batchNum: number): Promise<Sentence[]> {
    // Get previous sentences for deduplication
    const previousSentences = this.getPreviousSentences(sessionNum, batchNum);
    const prompt = this.createPrompt(sessionNum, batchNum, previousSentences);
    
    // Save prompt for debugging
    await writeFile(
      join(this.config.outputDir, `prompts/session${sessionNum}_batch${batchNum}.txt`),
      prompt
    );
    
    // Wait for rate limit
    await this.rateLimiter.waitIfNeeded();
    
    // Call Gemini API with proper retry config
    const response = await callGeminiWithRetry(this.config.model, prompt, {
      maxRetries: 2,
      initialDelay: 5000,
      maxDelay: 30000,
      backoffFactor: 2,
      timeoutMs: 600000, // 10 minutes for larger batches (300 sentences)
    });
    
    const sentences = await this.parseSentences(response, sessionNum, batchNum);
    
    // Validate and add accent marks
    const processedSentences = await this.processSentences(sentences);
    
    return processedSentences;
  }

  private getPreviousSentences(sessionNum: number, batchNum: number): string[] {
    const currentSessionSentences = this.sessionSentences.get(sessionNum) || [];
    const allGeneratedSentences = this.generatedSentences;
    
    // With 1M context, we can include much more for better deduplication
    const recentSentences: string[] = [];
    
    // Add from previous sessions (last 2000 sentences - about 2 sessions worth)
    if (allGeneratedSentences.length > 0) {
      const previousSessionSentences = allGeneratedSentences
        .filter(s => s.sessionNum < sessionNum)
        .slice(-2000)
        .map(s => s.text);
      recentSentences.push(...previousSessionSentences);
    }
    
    // Add from current session (all so far)
    if (currentSessionSentences.length > 0) {
      const currentTexts = currentSessionSentences.map(s => s.text);
      recentSentences.push(...currentTexts);
    }
    
    // Return last 5000 sentences (still well within 1M token context)
    // Average sentence ~10 words * 5000 = 50k words = ~75k tokens
    return recentSentences.slice(-5000);
  }

  private createPrompt(sessionNum: number, batchNum: number, previousSentences: string[] = []): string {
    return createMainPrompt(sessionNum, batchNum, previousSentences, this.config.batchSize);
  }


  private async parseSentences(response: string, sessionNum: number, batchNum: number): Promise<Sentence[]> {
    const sentences: Sentence[] = [];
    const lines = response.split('\n');
    const seenTexts = new Set<string>(); // Track duplicates within this batch
    
    const sentenceRegex = /\[(\d{5})\]\s+(.+)/;
    
    for (const line of lines) {
      const match = line.match(sentenceRegex);
      if (match) {
        const [, id, text] = match;
        const cleanText = text.trim();
        
        // Skip duplicates within this batch
        if (seenTexts.has(cleanText)) {
          console.log(formatWarning(`Skipping duplicate: "${cleanText}"`, 9));
          continue;
        }
        
        seenTexts.add(cleanText);
        
        // Parse emotion/action markers
        const markerMatch = cleanText.match(/^\(([^)]+)\)\s+(.+)$/);
        let sentenceText = cleanText;
        let marker = '';
        
        if (markerMatch) {
          marker = markerMatch[1];
          sentenceText = markerMatch[2];
        }
        
        // Determine sentence type
        let sentenceType: Sentence['sentenceType'] = 'normal';
        let emotionType: string | undefined;
        let nonVerbalType: string | undefined;
        
        if (marker) {
          if (['шэпча', 'ціха', 'ледзь чутна'].includes(marker)) {
            sentenceType = 'whisper';
          } else if (['смяецца', 'уздыхае', 'плача', 'кашляе', 'чыхае', 'стогне', 'пазяхае', 'ахае'].includes(marker)) {
            sentenceType = 'nonverbal';
            nonVerbalType = marker;
          } else if (['злосна', 'раздражнёна', 'абурана', 'крычыць', 'лаецца', 'сварыцца'].includes(marker)) {
            // Check if it contains any profanity indicators
            const profanityWords = ['чорт', 'д\'ябал', 'халера', 'дурань', 'ідыёт', 'задаўбаў', 
                                   'дурны', 'бліскавіца', 'пайшоў', 'сволач', 'скаціна', 'падла',
                                   'гад', 'сука', 'курва', 'хрэн', 'жопа', 'срака', 'лайно',
                                   'хуй', 'хуйня', 'хуёвы', 'хуёва', 'нахуй', 'пахуй', 'ахуець',
                                   'пізда', 'піздзец', 'піздаваты', 'напіздзіць', 'выпіздзіць',
                                   'ебаць', 'ёб', 'заебаў', 'заебала', 'паёбаны', 'ёбаны',
                                   'бля', 'блядзь', 'блядскі', 'мудак', 'мудзіла', 'підар'];
            const hasProfanity = profanityWords.some(word => sentenceText.toLowerCase().includes(word));
            
            if (hasProfanity || marker === 'лаецца') {
              sentenceType = 'profanity';
              emotionType = marker;
            } else {
              sentenceType = 'emotional';
              emotionType = marker;
            }
          } else {
            sentenceType = 'emotional';
            emotionType = marker;
          }
        } else if (sentenceText.includes('?')) {
          sentenceType = 'question';
        }
        
        const normalizedText = normalizeBelarusianText(sentenceText);
        // For non-verbal sounds, word count should be 0 (it's just a sound)
        const wordCount = sentenceType === 'nonverbal' && sentenceText.trim() === '' 
          ? 0 
          : normalizedText.split(' ').filter(w => w.length > 0).length;
        
        sentences.push({
          id,
          text: sentenceText,
          sessionNum,
          batchNum,
          sentenceType,
          emotionType,
          nonVerbalType,
          wordCount,
          hasQuestionMark: sentenceText.includes('?'),
          hasExclamation: sentenceText.includes('!'),
          normalizedText,
          accentedText: '', // Will be filled later
          accentedWords: [], // Will be filled later
          duration: this.config.secondsPerSentence,
          phonemeData: {
            hasUSound: false,
            hasDzSound: false,
            hasDzhSound: false,
            hasSoftSign: false
          }
        });
      }
    }
    
    return sentences;
  }

  private async processSentences(sentences: Sentence[]): Promise<Sentence[]> {
    const processed: Sentence[] = [];
    
    for (const sentence of sentences) {
      // Validate
      const validationResult = this.validator.validateSentence(sentence);
      if (!validationResult.isValid) {
        console.log(formatWarning(`Invalid sentence: "${sentence.text}" - ${validationResult.issues.join(', ')}`, 9));
        continue;
      }
      
      // Add accent marks
      const { accentedText, accentedWords } = await accentMarkerGrammarDB.analyzeAndAccent(sentence.text);
      sentence.accentedText = accentedText;
      sentence.accentedWords = accentedWords;
      
      // Update phoneme data
      const words = sentence.normalizedText.split(' ');
      sentence.phonemeData = {
        hasUSound: words.some(w => w.includes('ў')),
        hasDzSound: words.some(w => w.includes('дз')),
        hasDzhSound: words.some(w => w.includes('дж')),
        hasSoftSign: words.some(w => w.includes('ь'))
      };
      
      processed.push(sentence);
    }
    
    return processed;
  }

  private async saveSentences(sentences: Sentence[], sessionNum: number) {
    const outputFile = join(this.config.outputDir, `sentences/session${sessionNum}.json`);
    const textFile = join(this.config.outputDir, `sentences/session${sessionNum}.txt`);
    
    // Save JSON with metadata
    const data = {
      metadata: {
        sessionNum,
        sentenceCount: sentences.length,
        generatedAt: new Date().toISOString(),
        model: this.config.model
      },
      sentences
    };
    
    await writeFile(outputFile, JSON.stringify(data, null, 2));
    
    // Save text format
    const textContent = sentences
      .map(s => {
        const prefix = s.emotionType ? `(${s.emotionType}) ` : 
                       s.sentenceType === 'whisper' ? `(${s.marker || 'шэпча'}) ` :
                       s.nonVerbalType ? `(${s.nonVerbalType}) ` : '';
        return `[${s.id}] ${prefix}${s.text}\n         → ${s.accentedText}`;
      })
      .join('\n');
    
    await writeFile(textFile, textContent);
  }

  private async createSRT(sentences: Sentence[], sessionNum: number) {
    const srtFile = join(this.config.outputDir, `srt/session${sessionNum}.srt`);
    const srtContent = sentences
      .map((s, i) => {
        const startTime = i * (s.duration + 2); // 2 second gap between sentences
        const endTime = startTime + s.duration;
        
        const prefix = s.emotionType ? `(${s.emotionType}) ` : 
                       s.sentenceType === 'whisper' ? `(${s.marker || 'шэпча'}) ` :
                       s.nonVerbalType ? `(${s.nonVerbalType}) ` : '';
        
        return `${i + 1}\n${this.formatSRTTime(startTime)} --> ${this.formatSRTTime(endTime)}\n[${s.id}] ${prefix}${s.text}`;
      })
      .join('\n\n');
    
    await writeFile(srtFile, srtContent);
  }

  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  private async generateReport() {
    // Rebuild full list
    this.generatedSentences = [];
    for (let session = 1; session <= this.config.sessionCount; session++) {
      const sentences = this.sessionSentences.get(session) || [];
      this.generatedSentences.push(...sentences);
    }
    
    // Calculate total duration including gaps (2 seconds per gap)
    const totalDuration = this.generatedSentences.length * (this.config.secondsPerSentence + 2) - 2;
    
    const report = {
      totalSentences: this.generatedSentences.length,
      byType: {
        normal: this.generatedSentences.filter(s => s.sentenceType === 'normal').length,
        question: this.generatedSentences.filter(s => s.sentenceType === 'question').length,
        emotional: this.generatedSentences.filter(s => s.sentenceType === 'emotional').length,
        profanity: this.generatedSentences.filter(s => s.sentenceType === 'profanity').length,
        whisper: this.generatedSentences.filter(s => s.sentenceType === 'whisper').length,
        nonverbal: this.generatedSentences.filter(s => s.sentenceType === 'nonverbal').length,
      },
      phonemeStats: {
        withUSound: this.generatedSentences.filter(s => s.phonemeData.hasUSound).length,
        withDzSound: this.generatedSentences.filter(s => s.phonemeData.hasDzSound).length,
        withDzhSound: this.generatedSentences.filter(s => s.phonemeData.hasDzhSound).length,
        withSoftSign: this.generatedSentences.filter(s => s.phonemeData.hasSoftSign).length,
      },
      averageWordCount: this.generatedSentences.reduce((sum, s) => sum + s.wordCount, 0) / this.generatedSentences.length,
      totalDuration
    };
    
    await writeFile(
      join(this.config.outputDir, "reports/statistics.json"),
      JSON.stringify(report, null, 2)
    );
  }
}

// Main execution
const generator = new BelarusianDatasetGenerator(CONFIG);
await generator.generate();