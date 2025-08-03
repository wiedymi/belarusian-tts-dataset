import { Database } from "bun:sqlite";
import { XMLParser } from 'fast-xml-parser';
import { readFile, exists } from 'fs/promises';
import { join } from 'path';

export interface StressEntry {
  lemma: string;
  lemma_with_stress: string;
  stress_position: number;
  tag: string;
  sources: string;
  is_technical: boolean;
}

export class GrammarDBSQLite {
  private db: Database;
  private initialized: boolean = false;
  
  constructor(private dbPath: string = './data/grammardb.sqlite') {}
  
  /**
   * Initialize SQLite database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.db = new Database(this.dbPath, { create: true });
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stress_entries (
        lemma TEXT PRIMARY KEY,
        lemma_with_stress TEXT NOT NULL,
        stress_position INTEGER NOT NULL,
        tag TEXT,
        sources TEXT,
        is_technical BOOLEAN DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_tag ON stress_entries(tag);
      CREATE INDEX IF NOT EXISTS idx_technical ON stress_entries(is_technical);
      
      CREATE TABLE IF NOT EXISTS word_forms (
        form TEXT NOT NULL,
        lemma TEXT NOT NULL,
        form_tag TEXT,
        form_with_stress TEXT,
        FOREIGN KEY (lemma) REFERENCES stress_entries(lemma)
      );
      
      CREATE INDEX IF NOT EXISTS idx_form ON word_forms(form);
      CREATE INDEX IF NOT EXISTS idx_form_lemma ON word_forms(lemma);
    `);
    
    this.initialized = true;
  }
  
  /**
   * Import data from GrammarDB XML files
   */
  async importFromXML(grammarDbPath: string = './data/grammardb'): Promise<void> {
    await this.initialize();
    
    // Check if already populated
    const count = this.db.query("SELECT COUNT(*) as count FROM stress_entries").get() as { count: number };
    if (count.count > 0) {
      console.log(`Database already contains ${count.count} entries, skipping import`);
      return;
    }
    
    console.log('Importing GrammarDB XML files into SQLite...');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    
    const xmlFiles = [
      'A1.xml', 'A2.xml', 'C.xml', 'E.xml', 'I.xml', 'K.xml', 
      'M.xml', 'N1.xml', 'N2.xml', 'N3.xml', 'P.xml', 'R.xml', 
      'S.xml', 'V.xml', 'W.xml', 'Y.xml', 'Z.xml'
    ];
    
    // Prepare statements
    const insertStress = this.db.prepare(`
      INSERT OR REPLACE INTO stress_entries 
      (lemma, lemma_with_stress, stress_position, tag, sources, is_technical)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertForm = this.db.prepare(`
      INSERT INTO word_forms (form, lemma, form_tag, form_with_stress)
      VALUES (?, ?, ?, ?)
    `);
    
    // Use transaction for speed
    const importData = this.db.transaction((paradigms: any[]) => {
      for (const paradigm of paradigms) {
        const lemmaWithStress = paradigm['@_lemma'];
        if (!lemmaWithStress) continue;
        
        const lemma = lemmaWithStress.replace(/\+/g, '');
        const stressPosition = lemmaWithStress.indexOf('+');
        
        if (stressPosition === -1) continue;
        
        let sources = '';
        let isTechnical = false;
        
        // Process variants
        if (paradigm.Variant) {
          const variants = Array.isArray(paradigm.Variant) ? paradigm.Variant : [paradigm.Variant];
          
          for (const variant of variants) {
            if (variant['@_slouniki']) {
              sources = variant['@_slouniki'];
              isTechnical = this.checkIfTechnical(sources);
            }
            
            // Process forms
            if (variant.Form) {
              const forms = Array.isArray(variant.Form) ? variant.Form : [variant.Form];
              
              for (const form of forms) {
                const tag = form['@_tag'];
                const text = typeof form === 'string' ? form : form['#text'];
                if (tag && text) {
                  const cleanForm = text.replace(/\+/g, '');
                  insertForm.run(cleanForm, lemma, tag, text);
                }
              }
            }
          }
        }
        
        insertStress.run(
          lemma,
          lemmaWithStress,
          stressPosition,
          paradigm['@_tag'] || '',
          sources,
          isTechnical ? 1 : 0
        );
      }
    });
    
    let totalImported = 0;
    
    for (const xmlFile of xmlFiles) {
      const filePath = join(grammarDbPath, xmlFile);
      if (!await exists(filePath)) continue;
      
      console.log(`  Importing ${xmlFile}...`);
      const xmlData = await readFile(filePath, 'utf-8');
      const parsed = parser.parse(xmlData);
      
      if (parsed.Wordlist && parsed.Wordlist.Paradigm) {
        const paradigms = Array.isArray(parsed.Wordlist.Paradigm) 
          ? parsed.Wordlist.Paradigm 
          : [parsed.Wordlist.Paradigm];
        
        importData(paradigms);
        totalImported += paradigms.length;
      }
    }
    
    console.log(`Imported ${totalImported} paradigms`);
    
    // Verify import
    const finalCount = this.db.query("SELECT COUNT(*) as count FROM stress_entries").get() as { count: number };
    console.log(`Database now contains ${finalCount.count} unique lemmas`);
  }
  
  /**
   * Check if sources indicate technical/specialized vocabulary
   */
  private checkIfTechnical(sources: string): boolean {
    const generalDictionaries = ['tsbm1984', 'sbm2012', 'tsblm1996', 'biryla1987'];
    const sourceParts = sources.split(',');
    
    return !sourceParts.some(source => 
      generalDictionaries.some(dict => source.includes(dict))
    );
  }
  
  /**
   * Get stress information for a word
   */
  getStressInfo(word: string): StressEntry | null {
    const query = this.db.prepare(`
      SELECT * FROM stress_entries WHERE lemma = ?
    `);
    
    return query.get(word.toLowerCase()) as StressEntry | null;
  }
  
  /**
   * Get stress info by looking up word forms
   */
  getStressInfoByForm(word: string): StressEntry | null {
    // First try direct lemma lookup
    let result = this.getStressInfo(word);
    if (result) return result;
    
    // Then try word forms
    const formQuery = this.db.prepare(`
      SELECT DISTINCT s.* 
      FROM stress_entries s
      JOIN word_forms f ON s.lemma = f.lemma
      WHERE f.form = ?
      LIMIT 1
    `);
    
    return formQuery.get(word.toLowerCase()) as StressEntry | null;
  }
  
  /**
   * Get all technical/rare words
   */
  getTechnicalWords(limit: number = 1000): StressEntry[] {
    const query = this.db.prepare(`
      SELECT * FROM stress_entries 
      WHERE is_technical = 1 
      LIMIT ?
    `);
    
    return query.all(limit) as StressEntry[];
  }
  
  /**
   * Apply stress mark to a word based on database info
   */
  applyStressToWord(word: string, stressPosition: number): string {
    if (stressPosition < 0 || stressPosition >= word.length) return word;
    
    const vowels = 'аеёіоуыэюя';
    let vowelIndex = -1;
    
    // Find vowel at or after stress position
    for (let i = stressPosition; i < word.length; i++) {
      if (vowels.includes(word[i].toLowerCase())) {
        vowelIndex = i;
        break;
      }
    }
    
    if (vowelIndex === -1) {
      // Look backwards
      for (let i = stressPosition - 1; i >= 0; i--) {
        if (vowels.includes(word[i].toLowerCase())) {
          vowelIndex = i;
          break;
        }
      }
    }
    
    if (vowelIndex === -1) return word;
    
    // Apply combining acute accent
    return word.slice(0, vowelIndex + 1) + '\u0301' + word.slice(vowelIndex + 1);
  }
  
  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

// Export singleton instance
export const grammarDB = new GrammarDBSQLite();