import type { AccentedWord } from "./types";
import { GrammarDBParser, GrammarDBEntry } from "./grammardb-parser";

export class BelarusianAccentMarkerV2 {
  private grammarDB: GrammarDBParser;
  private isLoaded: boolean = false;
  
  constructor() {
    this.grammarDB = new GrammarDBParser();
  }
  
  /**
   * Initialize the accent marker by loading GrammarDB
   */
  async initialize(): Promise<void> {
    if (this.isLoaded) return;
    
    console.log('Initializing Belarusian accent marker with GrammarDB...');
    await this.grammarDB.loadDatabase(true); // Use cache
    this.isLoaded = true;
  }
  
  /**
   * Analyze a sentence and add accent marks where needed
   */
  async analyzeAndAccent(text: string): Promise<{
    accentedText: string;
    accentedWords: AccentedWord[];
  }> {
    // Ensure database is loaded
    if (!this.isLoaded) {
      await this.initialize();
    }
    
    const words = text.split(/(\s+|[.,!?;:«»"'()—-])/);
    const accentedWords: AccentedWord[] = [];
    let position = 0;
    
    const accentedParts = words.map((part) => {
      // Skip punctuation and whitespace
      if (/^[\s.,!?;:«»"'()—-]+$/.test(part)) {
        position += part.length;
        return part;
      }
      
      const cleanWord = part.toLowerCase();
      const stressInfo = this.grammarDB.getStressInfo(cleanWord);
      
      if (stressInfo && this.shouldAccentWord(cleanWord, stressInfo)) {
        const accentedForm = this.grammarDB.applyStressToWord(part, stressInfo.stressPosition);
        
        accentedWords.push({
          word: part,
          accentedForm: accentedForm,
          position,
          reason: this.getAccentReason(stressInfo)
        });
        
        position += part.length;
        return accentedForm;
      }
      
      position += part.length;
      return part;
    });
    
    return {
      accentedText: accentedParts.join(''),
      accentedWords
    };
  }
  
  /**
   * Determine if a word should have accent marks
   */
  private shouldAccentWord(word: string, stressInfo: GrammarDBEntry): boolean {
    // Skip very common short words (1-2 syllables)
    const syllableCount = this.countSyllables(word);
    if (syllableCount <= 1) return false;
    
    // Always accent if it's rare/technical
    if (this.grammarDB.isRareOrTechnical(stressInfo)) {
      return true;
    }
    
    // Accent longer words (4+ syllables)
    if (syllableCount >= 4) {
      return true;
    }
    
    // Check if it's a potentially ambiguous word based on tag
    // V = verb, N = noun, A = adjective, etc.
    const complexTags = ['V', 'NP']; // Verbs and proper nouns often need accents
    if (complexTags.some(tag => stressInfo.tag.startsWith(tag))) {
      return true;
    }
    
    // For 2-3 syllable words, only accent if from specialized sources
    return stressInfo.sources ? 
      !stressInfo.sources.some(s => s.includes('tsbm1984') || s.includes('sbm2012')) : 
      false;
  }
  
  /**
   * Get the reason for accenting
   */
  private getAccentReason(stressInfo: GrammarDBEntry): 'uncommon' | 'homograph' | 'foreign' | 'complex' {
    if (this.grammarDB.isRareOrTechnical(stressInfo)) {
      return 'uncommon';
    }
    
    const word = stressInfo.lemma;
    const syllableCount = this.countSyllables(word);
    
    if (syllableCount >= 4) {
      return 'complex';
    }
    
    // Check if it might be a foreign word (rough heuristic)
    if (word.includes('ц') && word.includes('ы') && word.length > 6) {
      return 'foreign';
    }
    
    return 'complex';
  }
  
  /**
   * Count syllables in a Belarusian word
   */
  private countSyllables(word: string): number {
    const vowels = /[аеёіоуыэюя]/gi;
    const matches = word.match(vowels);
    return matches ? matches.length : 0;
  }
  
  /**
   * Remove accent marks from text
   */
  removeAccents(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}

// Export singleton instance
export const accentMarkerV2 = new BelarusianAccentMarkerV2();