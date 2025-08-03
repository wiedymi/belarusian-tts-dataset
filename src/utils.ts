export function normalizeBelarusianText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"«»—–\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractPhonemes(word: string): string[] {
  const phonemes: string[] = [];
  const lowercaseWord = word.toLowerCase();
  
  // Check for special Belarusian digraphs
  if (lowercaseWord.includes('дз')) phonemes.push('dz');
  if (lowercaseWord.includes('дж')) phonemes.push('dž');
  
  // Check for special Belarusian letters
  if (lowercaseWord.includes('ў')) phonemes.push('ŭ');
  if (lowercaseWord.includes('ь')) phonemes.push('soft');
  if (lowercaseWord.includes('\'')) phonemes.push('apos');
  
  // Check for palatalized consonants
  if (lowercaseWord.includes('ць')) phonemes.push('ć');
  if (lowercaseWord.includes('сь')) phonemes.push('ś');
  if (lowercaseWord.includes('зь')) phonemes.push('ź');
  if (lowercaseWord.includes('нь')) phonemes.push('ń');
  if (lowercaseWord.includes('ль')) phonemes.push('ĺ');
  
  return phonemes;
}


export function splitIntoChunks<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getTimeStamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

export function calculateSpeechMetrics(text: string): {
  syllables: number;
  estimatedDuration: number;
  complexity: number;
} {
  const words = text.trim().split(/\s+/);
  const vowels = text.match(/[аеёіоуыэюяАЕЁІОУЫЭЮЯ]/g) || [];
  const syllables = vowels.length;
  
  // Estimate duration based on syllables (average 0.3 seconds per syllable)
  const estimatedDuration = Math.max(3, Math.min(10, syllables * 0.3));
  
  // Calculate complexity (0-1) based on word length and special characters
  const avgWordLength = text.length / words.length;
  const hasSpecialChars = /[ўдз\'ь]/.test(text);
  const complexity = Math.min(1, (avgWordLength / 10) + (hasSpecialChars ? 0.2 : 0));
  
  return {
    syllables,
    estimatedDuration,
    complexity,
  };
}

export function generateSessionId(): string {
  return `session_${getTimeStamp()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

export class ProgressTracker {
  private startTime: number;
  private lastUpdate: number;
  
  constructor(private total: number, private label: string = "Progress") {
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
  }
  
  update(current: number): void {
    const now = Date.now();
    
    // Only update if at least 100ms have passed
    if (now - this.lastUpdate < 100) return;
    
    this.lastUpdate = now;
    const elapsed = (now - this.startTime) / 1000;
    const progress = current / this.total;
    const eta = progress > 0 ? (elapsed / progress) - elapsed : 0;
    
    const progressBar = this.createProgressBar(progress);
    const percentage = (progress * 100).toFixed(1);
    
    process.stdout.write(
      `\r${this.label}: ${progressBar} ${percentage}% (${current}/${this.total}) ETA: ${formatDuration(eta)}`
    );
  }
  
  complete(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    console.log(`\n✅ ${this.label} complete in ${formatDuration(elapsed)}`);
  }
  
  private createProgressBar(progress: number, width: number = 30): string {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }
}

export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private interval: Timer | null = null;
  
  start(message: string): void {
    this.stop(); // Clear any existing spinner
    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.frames[this.currentFrame]} ${message}`);
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }
  
  update(message: string): void {
    process.stdout.write(`\r${this.frames[this.currentFrame]} ${message}`);
  }
  
  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (finalMessage) {
      process.stdout.write(`\r${finalMessage}\n`);
    } else {
      process.stdout.write('\r');
    }
  }
}