import type { Sentence, ValidationResult } from "./types";

export class BelarusianValidator {
  private russianMarkers = ['ъ', 'щ', 'ться', 'ого', 'его', 'ый', 'ий', 'ешь'];
  private belarusianMarkers = ['ў', 'дз', 'ць', 'ага', 'яго', 'ы', 'і', 'еш'];
  
  // Common Russian words that shouldn't appear
  private russianWords = ['что', 'это', 'только', 'очень', 'можно', 'нужно', 'больше'];
  
  // Common Belarusian words that should appear
  private belarusianWords = ['што', 'гэта', 'толькі', 'вельмі', 'можна', 'трэба', 'больш'];

  validateSentence(sentence: Sentence): ValidationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    // Skip validation for non-verbal sounds
    if (sentence.sentenceType === 'nonverbal') {
      return { isValid: true, issues: [], suggestions: [] };
    }

    // Extract clean text without stage directions
    const cleanText = sentence.text.replace(/^\([^)]+\)\s*/, '').toLowerCase();
    
    // Check for Russian influence (more lenient for profanity)
    if (sentence.sentenceType !== 'profanity') {
      // Check for Russian hard sign
      if (cleanText.includes('ъ')) {
        issues.push("Contains Russian hard sign (ъ)");
      }

      // Check for Russian щ
      if (cleanText.includes('щ')) {
        issues.push("Contains Russian щ (should be шч in Belarusian)");
      }

      // Check for Russian verb endings
      if (cleanText.match(/ться\b/)) {
        issues.push("Contains Russian reflexive verb ending -ться (should be -цца)");
      }

      // Check for Russian adjective endings
      if (cleanText.match(/ого\b|его\b/)) {
        issues.push("Contains Russian genitive endings -ого/-его (should be -ага/-яга)");
      }

      // Check for common Russian words
      for (const word of this.russianWords) {
        if (cleanText.includes(word)) {
          const belarusianEquivalent = this.belarusianWords[this.russianWords.indexOf(word)];
          issues.push(`Contains Russian word "${word}" (should be "${belarusianEquivalent}")`);
        }
      }
    }

    // Validate sentence length (different rules for different types)
    if (sentence.sentenceType === 'whisper' || sentence.sentenceType === 'emotional') {
      // More flexible length for these types
      if (sentence.wordCount < 2 || sentence.wordCount > 15) {
        issues.push(`Sentence has ${sentence.wordCount} words (should be 2-15 for ${sentence.sentenceType})`);
      }
    } else if (sentence.sentenceType === 'profanity') {
      // Even more flexible for profanity
      if (sentence.wordCount < 1 || sentence.wordCount > 12) {
        issues.push(`Sentence has ${sentence.wordCount} words (should be 1-12 for profanity)`);
      }
    } else if (sentence.sentenceType === 'nonverbal') {
      // Non-verbal sounds can be just the sound marker
      // No length validation needed
    } else {
      // Standard length validation
      if (sentence.wordCount < 3 || sentence.wordCount > 20) {
        issues.push("Sentence too short (less than 3 words)" + 
          (sentence.wordCount < 3 ? "" : " or too long for natural speech (more than 20 words)"));
      }
    }

    // Check for proper Belarusian features (less strict for emotional/profanity)
    if (sentence.sentenceType === 'normal') {
      const hasBelarusianFeatures = this.belarusianMarkers.some(marker => 
        cleanText.includes(marker)
      );

      if (!hasBelarusianFeatures && sentence.wordCount > 5) {
        suggestions.push("Consider adding more Belarusian-specific features (ў, дз, ць)");
      }
    }



    return {
      isValid: issues.length === 0,
      issues,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  validateDataset(sentences: Sentence[]): void {
    console.log("\n🔍 Validating dataset...");
    
    let validCount = 0;
    const allIssues: Map<string, number> = new Map();
    const issuesBySentence: Array<{sentence: Sentence, issues: string[]}> = [];

    for (const sentence of sentences) {
      const result = this.validateSentence(sentence);
      if (result.isValid) {
        validCount++;
      } else {
        if (result.issues.length > 0) {
          issuesBySentence.push({sentence, issues: result.issues});
        }
        
        result.issues.forEach(issue => {
          allIssues.set(issue, (allIssues.get(issue) || 0) + 1);
        });
      }
    }

    console.log(`✅ Valid sentences: ${validCount}/${sentences.length} (${(validCount/sentences.length*100).toFixed(2)}%)`);
    
    if (allIssues.size > 0) {
      console.log("\n⚠️  Issues found:");
      // Sort issues by frequency
      const sortedIssues = Array.from(allIssues.entries())
        .sort((a, b) => b[1] - a[1]);
      
      for (const [issue, count] of sortedIssues) {
        console.log(`  - ${issue}: ${count} occurrences`);
      }

      // Show examples of problematic sentences
      if (issuesBySentence.length > 0) {
        console.log("\n📋 Example problematic sentences:");
        const examples = issuesBySentence.slice(0, 5);
        for (const {sentence, issues} of examples) {
          console.log(`  [${sentence.id}] "${sentence.text}"`);
          console.log(`    Issues: ${issues.join(", ")}`);
        }
      }
    }

    // Phoneme statistics
    this.analyzePhonemes(sentences);
  }

  private analyzePhonemes(sentences: Sentence[]): void {
    const phonemeCounts = {
      'ў': 0,
      'дз': 0,
      'дж': 0,
      'ць': 0,
      'шч': 0,
    };

    for (const sentence of sentences) {
      const text = sentence.text.toLowerCase();
      for (const phoneme of Object.keys(phonemeCounts)) {
        phonemeCounts[phoneme as keyof typeof phonemeCounts] += 
          (text.match(new RegExp(phoneme, 'g')) || []).length;
      }
    }

    console.log("\n📊 Belarusian phoneme distribution:");
    for (const [phoneme, count] of Object.entries(phonemeCounts)) {
      const perSentence = (count / sentences.length).toFixed(2);
      console.log(`  ${phoneme}: ${count} total (${perSentence} per sentence avg)`);
    }
  }

  suggestImprovements(sentence: string): string {
    let improved = sentence;

    // Replace common Russian patterns with Belarusian
    const replacements: [RegExp, string][] = [
      [/\bчто\b/gi, 'што'],
      [/\bэто\b/gi, 'гэта'],
      [/\bтолько\b/gi, 'толькі'],
      [/\bочень\b/gi, 'вельмі'],
      [/\bможно\b/gi, 'можна'],
      [/\bнужно\b/gi, 'трэба'],
      [/ться\b/g, 'цца'],
      [/ого\b/g, 'ага'],
      [/его\b/g, 'яга'],
      [/щ/g, 'шч'],
      [/ъ/g, ''],
    ];

    for (const [pattern, replacement] of replacements) {
      improved = improved.replace(pattern, replacement);
    }

    return improved;
  }
}