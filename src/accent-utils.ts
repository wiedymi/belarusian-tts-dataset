import type { AccentedWord } from "./types";

// Common Belarusian words that typically don't need accents
const COMMON_WORDS = new Set([
  'і', 'у', 'на', 'з', 'па', 'не', 'што', 'як', 'для', 'да', 'але', 'ці',
  'гэта', 'яго', 'яна', 'яны', 'мы', 'вы', 'ты', 'я', 'быць', 'мець',
  'рабіць', 'казаць', 'ведаць', 'бачыць', 'хацець', 'магчы', 'трэба',
  'можна', 'добра', 'дрэнна', 'вельмі', 'зараз', 'потым', 'таму', 'калі',
  'дзе', 'чаму', 'хто', 'той', 'гэты', 'наш', 'ваш', 'свой', 'увесь',
  'адзін', 'два', 'тры', 'многа', 'мала', 'першы', 'апошні', 'новы', 'стары'
]);

// Words that are homographs and always need accent marks to disambiguate
const HOMOGRAPHS: Record<string, string[]> = {
  'замак': ['за́мак', 'замо́к'],  // castle vs lock
  'мука': ['му́ка', 'мука́'],     // flour vs torment
  'варта': ['ва́рта', 'варта́'],  // worth vs guard
  'атлас': ['а́тлас', 'атла́с'],  // atlas vs satin
  'вугал': ['ву́гал', 'вуга́л'],  // corner vs coal
  'замкі': ['за́мкі', 'замкі́'],  // castles vs locks
};

// Complex/uncommon words that benefit from accent marks
const COMPLEX_WORDS: Record<string, string> = {
  'адміністрацыя': 'адміністра́цыя',
  'арганізацыя': 'арганіза́цыя',
  'універсітэт': 'універсітэ́т',
  'тэлефанаваць': 'тэлефанава́ць',
  'фатаграфаваць': 'фатаграфава́ць',
  'абавязковы': 'абавязко́вы',
  'незалежнасць': 'незале́жнасць',
  'прадстаўнік': 'прадстаўні́к',
  'кіраўніцтва': 'кіраўні́цтва',
  'паведамленне': 'паведамле́нне',
  'размяшчэнне': 'размяшчэ́нне',
  'выкарыстанне': 'выкарыста́нне',
  'прызначэнне': 'прызначэ́нне',
  'абсталяванне': 'абсталява́нне',
  'забеспячэнне': 'забеспячэ́нне',
};

// Foreign loanwords that often need accent marks
const FOREIGN_WORDS: Record<string, string> = {
  'кампутар': 'кампу́тар',
  'інтэрнэт': 'інтэрнэ́т',
  'тэлевізар': 'тэлеві́зар',
  'аўтамабіль': 'аўтамабі́ль',
  'рэстаран': 'рэстара́н',
  'магазін': 'магазі́н',
  'дакумент': 'дакуме́нт',
  'студэнт': 'студэ́нт',
  'прэзідэнт': 'прэзідэ́нт',
  'парламент': 'парламе́нт',
  'дэпутат': 'дэпута́т',
  'міністр': 'міні́стр',
  'дырэктар': 'дырэ́ктар',
  'інжынер': 'інжыне́р',
  'праграміст': 'праграмі́ст',
};

// Suffixes that often indicate where stress falls
const STRESS_PATTERNS = {
  'аваць': -2,  // stress on the syllable before 'аваць'
  'іраваць': -2,
  'аванне': -3,
  'ірaванне': -3,
  'ацыя': -2,
  'іцыя': -2,
  'ізм': -1,
  'іст': -1,
  'ічны': -2,
  'альны': -2,
};

export class BelarusianAccentMarker {
  /**
   * Analyze a sentence and add accent marks where needed
   */
  analyzeAndAccent(text: string): {
    accentedText: string;
    accentedWords: AccentedWord[];
  } {
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
      const accentInfo = this.shouldAccentWord(cleanWord);
      
      if (accentInfo) {
        accentedWords.push({
          word: part,
          accentedForm: this.preserveCase(part, accentInfo.accentedForm),
          position,
          reason: accentInfo.reason
        });
        position += part.length;
        return this.preserveCase(part, accentInfo.accentedForm);
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
   * Determine if a word should have accent marks and why
   */
  private shouldAccentWord(word: string): {
    accentedForm: string;
    reason: 'uncommon' | 'homograph' | 'foreign' | 'complex';
  } | null {
    const cleanWord = word.toLowerCase().replace(/[.,!?;:«»"'()—-]/g, '');
    
    // Skip common words
    if (COMMON_WORDS.has(cleanWord)) {
      return null;
    }
    
    // Check for homographs (always accent these)
    if (HOMOGRAPHS[cleanWord]) {
      // For homographs, we'd need context to choose the right form
      // For now, default to the first option
      return {
        accentedForm: HOMOGRAPHS[cleanWord][0],
        reason: 'homograph'
      };
    }
    
    // Check complex words
    if (COMPLEX_WORDS[cleanWord]) {
      return {
        accentedForm: COMPLEX_WORDS[cleanWord],
        reason: 'complex'
      };
    }
    
    // Check foreign words
    if (FOREIGN_WORDS[cleanWord]) {
      return {
        accentedForm: FOREIGN_WORDS[cleanWord],
        reason: 'foreign'
      };
    }
    
    // Check if it's a long word (4+ syllables) that might benefit from accent
    const syllableCount = this.countSyllables(cleanWord);
    if (syllableCount >= 4) {
      const accented = this.guessAccent(cleanWord);
      if (accented !== cleanWord) {
        return {
          accentedForm: accented,
          reason: 'complex'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Count syllables in a Belarusian word (approximate)
   */
  private countSyllables(word: string): number {
    const vowels = /[аеёіоуыэюя]/gi;
    const matches = word.match(vowels);
    return matches ? matches.length : 0;
  }
  
  /**
   * Attempt to guess where accent should go based on patterns
   */
  private guessAccent(word: string): string {
    // Check known suffix patterns
    for (const [suffix, stressPosition] of Object.entries(STRESS_PATTERNS)) {
      if (word.endsWith(suffix)) {
        return this.addAccentAtPosition(word, suffix, stressPosition);
      }
    }
    
    // Default: no accent if we can't determine
    return word;
  }
  
  /**
   * Add accent mark at the specified position relative to suffix
   */
  private addAccentAtPosition(word: string, suffix: string, relativePosition: number): string {
    const vowels = 'аеёіоуыэюя';
    const basePart = word.slice(0, -suffix.length);
    
    // Find vowels in the base part
    const vowelPositions: number[] = [];
    for (let i = 0; i < basePart.length; i++) {
      if (vowels.includes(basePart[i].toLowerCase())) {
        vowelPositions.push(i);
      }
    }
    
    if (vowelPositions.length === 0) return word;
    
    // Calculate which vowel to accent
    const targetVowelIndex = vowelPositions.length + relativePosition;
    if (targetVowelIndex < 0 || targetVowelIndex >= vowelPositions.length) {
      return word;
    }
    
    const accentPosition = vowelPositions[targetVowelIndex];
    return basePart.slice(0, accentPosition) + 
           basePart[accentPosition] + '\u0301' + 
           basePart.slice(accentPosition + 1) + 
           suffix;
  }
  
  /**
   * Preserve the original case when applying accented form
   */
  private preserveCase(original: string, accented: string): string {
    if (original === original.toLowerCase()) return accented;
    if (original === original.toUpperCase()) return accented.toUpperCase();
    
    // Mixed case - try to preserve it
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
    
    // Add any remaining characters from accented
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
export const accentMarker = new BelarusianAccentMarker();