import type { AccentedWord } from "./types";
import { grammarDB } from "./grammardb-sqlite";

export class BelarusianAccentMarkerGrammarDB {
  private initialized = false;
  
  /**
   * Initialize the accent marker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('Initializing accent marker with GrammarDB...');
    await grammarDB.initialize();
    await grammarDB.importFromXML(); // Will skip if already imported
    this.initialized = true;
  }
  
  /**
   * Analyze a sentence and add accent marks where needed
   */
  async analyzeAndAccent(text: string): Promise<{
    accentedText: string;
    accentedWords: AccentedWord[];
  }> {
    // Ensure initialized
    if (!this.initialized) {
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
      
      // Try to find stress info (first as lemma, then as form)
      const stressInfo = grammarDB.getStressInfoByForm(cleanWord);
      
      if (stressInfo && this.shouldAccentWord(cleanWord, stressInfo)) {
        const accentedForm = grammarDB.applyStressToWord(part, stressInfo.stress_position);
        
        accentedWords.push({
          word: part,
          accentedForm: this.preserveCase(part, accentedForm),
          position,
          reason: this.getAccentReason(cleanWord, stressInfo)
        });
        
        position += part.length;
        return this.preserveCase(part, accentedForm);
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
  private shouldAccentWord(word: string, stressInfo: any): boolean {
    // Skip very common short words (1 syllable)
    const syllableCount = this.countSyllables(word);
    if (syllableCount <= 1) return false;
    
    // Always accent technical/rare words
    if (stressInfo.is_technical) {
      return true;
    }
    
    // Accent longer words (4+ syllables)
    if (syllableCount >= 4) {
      return true;
    }
    
    // Accent verbs and proper nouns (often need stress)
    if (stressInfo.tag && (stressInfo.tag.startsWith('V') || stressInfo.tag === 'NP')) {
      return true;
    }
    
    // For 2-3 syllable words, only if no general dictionary sources
    const generalSources = ['tsbm1984', 'sbm2012', 'tsblm1996', 'biryla1987'];
    if (stressInfo.sources) {
      const hasGeneralSource = generalSources.some(dict => 
        stressInfo.sources.includes(dict)
      );
      return !hasGeneralSource;
    }
    
    return false;
  }
  
  /**
   * Get the reason for accenting
   */
  private getAccentReason(word: string, stressInfo: any): 'uncommon' | 'homograph' | 'foreign' | 'complex' {
    if (stressInfo.is_technical) {
      return 'uncommon';
    }
    
    const syllableCount = this.countSyllables(word);
    if (syllableCount >= 4) {
      return 'complex';
    }
    
    // Check if might be foreign (heuristic based on certain letter combinations)
    if (/[тц].*[ыі]|[кг].*[еэ]/.test(word) && word.length > 6) {
      return 'foreign';
    }
    
    // Check for potential homographs (words that might have variable stress)
    const potentialHomographs = ['замак', 'мука', 'варта', 'атлас', 'вугал'];
    if (potentialHomographs.includes(word)) {
      return 'homograph';
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
   * Preserve the original case when applying accented form
   */
  private preserveCase(original: string, accented: string): string {
    if (original === original.toLowerCase()) return accented;
    if (original === original.toUpperCase()) return accented.toUpperCase();
    
    // First letter uppercase
    if (original[0] === original[0].toUpperCase() && 
        original.slice(1) === original.slice(1).toLowerCase()) {
      return accented[0].toUpperCase() + accented.slice(1).toLowerCase();
    }
    
    // Mixed case - try to preserve pattern
    let result = '';
    let j = 0;
    
    for (let i = 0; i < original.length && j < accented.length; i++, j++) {
      if (original[i] === original[i].toUpperCase()) {
        result += accented[j].toUpperCase();
      } else {
        result += accented[j].toLowerCase();
      }
      
      // Handle combining diacritical marks
      if (j + 1 < accented.length && accented.charCodeAt(j + 1) === 0x0301) {
        result += accented[++j];
      }
    }
    
    // Add any remaining characters
    result += accented.slice(j);
    
    return result;
  }
  
  /**
   * Remove accent marks from text
   */
  removeAccents(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}

// Export singleton instance
export const accentMarkerGrammarDB = new BelarusianAccentMarkerGrammarDB();