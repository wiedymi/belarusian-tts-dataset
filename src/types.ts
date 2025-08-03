export type SentenceType = 'normal' | 'question' | 'emotional' | 'whisper' | 'nonverbal';

export type NonVerbalType = 'laugh' | 'sigh' | 'gasp' | 'cry' | 'scream' | 'cough' | 
  'sneeze' | 'hmm' | 'groan' | 'yawn' | 'hiccup';

export type EmotionType = 'joy' | 'anger' | 'sadness' | 'fear' | 'surprise' | 
  'disgust' | 'love' | 'frustration';

export interface Sentence {
  id: string;
  text: string;
  sessionNum: number;
  batchNum: number;
  wordCount: number;
  estimatedDuration: number;
  sentenceType?: SentenceType;
  emotionType?: EmotionType;
  nonVerbalType?: NonVerbalType;
  intensity?: 'mild' | 'medium' | 'strong';
  accentedText?: string;
  accentedWords?: AccentedWord[];
}

export interface AccentedWord {
  word: string;
  accentedForm: string;
  position: number;
  reason?: 'uncommon' | 'homograph' | 'foreign' | 'complex';
}

export interface GenerationConfig {
  model: string;
  sentencesPerSession: number;
  secondsPerSentence: number;
  batchSize: number;
  outputDir: string;
  sessionCount: number;
  parallelBatches?: number;
}

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  suggestions?: string[];
}

export interface SessionReport {
  session: number;
  sentences: number;
  words: number;
  estimatedDuration: number;
}

export interface DatasetReport {
  totalSentences: number;
  totalWords: number;
  estimatedDuration: number;
  averageWordsPerSentence: number;
  wordCoverage: Set<string>;
  sessionBreakdown: SessionReport[];
  phonemeAnalysis: Record<string, number>;
}