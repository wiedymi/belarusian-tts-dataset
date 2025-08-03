import { XMLParser } from 'fast-xml-parser';
import { readFile, writeFile, exists } from 'fs/promises';
import { join } from 'path';

export interface GrammarDBEntry {
  lemma: string;
  lemmaWithStress: string;
  stressPosition: number;
  tag: string;
  forms: Map<string, string>;
  sources?: string[];
}

export class GrammarDBParser {
  private stressMap: Map<string, GrammarDBEntry> = new Map();
  private cacheFile = './data/grammardb-cache.json';
  
  constructor(private grammarDbPath: string = './data/grammardb') {}
  
  /**
   * Load and parse GrammarDB XML files
   */
  async loadDatabase(useCache: boolean = true): Promise<void> {
    // Try to load from cache first
    if (useCache && await exists(this.cacheFile)) {
      console.log('Loading GrammarDB from cache...');
      const cacheData = await readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(cacheData);
      this.stressMap = new Map(parsed.entries);
      console.log(`Loaded ${this.stressMap.size} entries from cache`);
      return;
    }
    
    console.log('Parsing GrammarDB XML files...');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    
    // List of XML files to parse
    const xmlFiles = [
      'A1.xml', 'A2.xml', 'C.xml', 'E.xml', 'I.xml', 'K.xml', 
      'M.xml', 'N1.xml', 'N2.xml', 'N3.xml', 'P.xml', 'R.xml', 
      'S.xml', 'V.xml', 'W.xml', 'Y.xml', 'Z.xml'
    ];
    
    let totalEntries = 0;
    
    for (const xmlFile of xmlFiles) {
      const filePath = join(this.grammarDbPath, xmlFile);
      if (!await exists(filePath)) continue;
      
      console.log(`  Parsing ${xmlFile}...`);
      const xmlData = await readFile(filePath, 'utf-8');
      const parsed = parser.parse(xmlData);
      
      if (parsed.Wordlist && parsed.Wordlist.Paradigm) {
        const paradigms = Array.isArray(parsed.Wordlist.Paradigm) 
          ? parsed.Wordlist.Paradigm 
          : [parsed.Wordlist.Paradigm];
        
        for (const paradigm of paradigms) {
          this.processParadigm(paradigm);
          totalEntries++;
        }
      }
    }
    
    console.log(`Parsed ${totalEntries} paradigms, ${this.stressMap.size} unique lemmas`);
    
    // Save to cache
    if (useCache) {
      await this.saveCache();
    }
  }
  
  /**
   * Process a single paradigm entry
   */
  private processParadigm(paradigm: any): void {
    const lemmaWithStress = paradigm['@_lemma'];
    if (!lemmaWithStress) return;
    
    // Extract lemma without stress and find stress position
    const lemma = lemmaWithStress.replace(/\+/g, '');
    const stressPosition = lemmaWithStress.indexOf('+');
    
    if (stressPosition === -1) return; // No stress marked
    
    const entry: GrammarDBEntry = {
      lemma,
      lemmaWithStress,
      stressPosition,
      tag: paradigm['@_tag'] || '',
      forms: new Map(),
      sources: []
    };
    
    // Process variants
    if (paradigm.Variant) {
      const variants = Array.isArray(paradigm.Variant) ? paradigm.Variant : [paradigm.Variant];
      
      for (const variant of variants) {
        // Extract sources
        if (variant['@_slouniki']) {
          entry.sources = variant['@_slouniki'].split(',');
        }
        
        // Process forms
        if (variant.Form) {
          const forms = Array.isArray(variant.Form) ? variant.Form : [variant.Form];
          
          for (const form of forms) {
            const tag = form['@_tag'];
            const text = typeof form === 'string' ? form : form['#text'];
            if (tag && text) {
              entry.forms.set(tag, text);
            }
          }
        }
      }
    }
    
    this.stressMap.set(lemma, entry);
  }
  
  /**
   * Save parsed data to cache
   */
  private async saveCache(): Promise<void> {
    const cacheData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      entries: Array.from(this.stressMap.entries())
    };
    
    await writeFile(this.cacheFile, JSON.stringify(cacheData));
    console.log('Saved cache to', this.cacheFile);
  }
  
  /**
   * Get stress information for a word
   */
  getStressInfo(word: string): GrammarDBEntry | null {
    return this.stressMap.get(word.toLowerCase()) || null;
  }
  
  /**
   * Convert stress position to accent mark
   */
  applyStressToWord(word: string, stressPosition: number): string {
    if (stressPosition < 0 || stressPosition >= word.length) return word;
    
    // Find the vowel at or after the stress position
    const vowels = 'аеёіоуыэюя';
    let vowelIndex = -1;
    
    for (let i = stressPosition; i < word.length; i++) {
      if (vowels.includes(word[i].toLowerCase())) {
        vowelIndex = i;
        break;
      }
    }
    
    if (vowelIndex === -1) {
      // Look backwards if no vowel found forward
      for (let i = stressPosition - 1; i >= 0; i--) {
        if (vowels.includes(word[i].toLowerCase())) {
          vowelIndex = i;
          break;
        }
      }
    }
    
    if (vowelIndex === -1) return word;
    
    // Apply combining acute accent after the vowel
    return word.slice(0, vowelIndex + 1) + '\u0301' + word.slice(vowelIndex + 1);
  }
  
  /**
   * Check if a word is rare/technical based on its sources
   */
  isRareOrTechnical(entry: GrammarDBEntry): boolean {
    if (!entry.sources || entry.sources.length === 0) return true;
    
    // Words only in specialized dictionaries are considered technical
    const generalDictionaries = ['tsbm1984', 'sbm2012', 'tsblm1996', 'biryla1987'];
    return !entry.sources.some(source => 
      generalDictionaries.some(dict => source.includes(dict))
    );
  }
}