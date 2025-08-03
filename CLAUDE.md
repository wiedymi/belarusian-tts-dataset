# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Guidelines

- Never add comments to code. Let the code speak for itself through clear, self-documenting naming and structure.
- Preserve exact code formatting and style when making edits. Match the existing patterns.

## Commands

### Dataset Generation
```bash
# Generate dataset using Gemini CLI (22,500 sentences, 25 sessions)
bun run generate

# Generate using OpenRouter API (flexible models, structured output)
export OPENROUTER_API_KEY="your-key-here"
bun run generate:openrouter                         # Default: google/gemini-2.0-flash-exp:free
bun run generate:openrouter -m anthropic/claude-3.5-sonnet -s 10  # Custom model & sessions
bun run generate:openrouter --help                  # All options
```

### Validation & Auto-Fix
```bash
# Basic validation (fast regex-based)
bun run validate

# Deep AI validation with Gemini
bun run validate:deep                               # Check grammar, naturalness, appropriateness
bun run validate:fix                                # Deep validation + auto-fix issues

# Validation with OpenRouter
bun run validate:openrouter                         # Validate all sessions
bun run validate:openrouter --fix                   # Auto-fix issues
bun run validate:openrouter -s 1 -m openai/gpt-4o  # Specific session & model
```

### Database & Utilities
```bash
# Build accent marking database (240,000+ Belarusian words)
bun run build:db

# Clean all generated files
bun run clean
```

### Real-Time Monitoring
```bash
# Watch generation progress
tail -f output/temp/session1_temp.txt

# Check session progress
ls -la output/temp/

# View AI prompts (debugging)
cat output/prompts/session1_prompts.txt

# Count generated sentences
wc -l output/sentences/*.txt
```

## Architecture Overview

### Data Processing Pipeline
```
1. Prompt Generation → 2. Parallel AI Processing → 3. Real-time Validation → 4. Auto-save → 5. Output Files
      ↓                         ↓                           ↓                     ↓              ↓
   Topics &               Gemini/OpenRouter            Type detection        Every 100      JSON/TXT/SRT
   Templates                Batching                   & Belarusian          sentences      with metadata
```

### Key Components

**Generation Entry Points:**
- `src/generate-dataset.ts` - Gemini CLI generation (parallel batches, auto-resume)
- `src/generate-dataset-openrouter.ts` - OpenRouter API generation (structured output, model flexibility)

**Validation Entry Points:**
- `src/validate-dataset.ts` - Gemini-based validation coordinator
- `src/validate-dataset-openrouter.ts` - OpenRouter validation with model selection

**Core Processing:**
- `src/types.ts` - TypeScript interfaces (5 sentence types, emotion/nonverbal subtypes)
- `src/validator.ts` - Regex validation (Russian detection, word limits 3-20)
- `src/gemini-validator.ts` - AI deep validation (grammar, naturalness, auto-fix)
- `src/openrouter-validator.ts` - Structured output validation via OpenRouter
- `src/prompts.ts` - Prompt templates (phonetic requirements, topic guidance)
- `src/utils.ts` - Utilities (progress tracking, normalization, duration calc)

**API Integration:**
- `src/api-utils.ts` - Gemini CLI wrapper (retries, rate limiting, streaming)
- `src/openrouter-client.ts` - AI SDK v4 integration (structured responses)

**Accent Marking System:**
- `src/grammardb-sqlite.ts` - SQLite interface (240,000+ words)
- `src/accent-utils-grammardb.ts` - Context-aware accent placement
- `src/build-grammardb.ts` - XML→SQLite database builder

### Configuration

**Gemini CLI** (`src/generate-dataset.ts`):
```typescript
const CONFIG = {
  model: "gemini-2.5-flash",    // AI model to use
  sentencesPerSession: 900,      // ~2.5 hours recording per session
  parallelBatches: 5,            // Concurrent processing (1-5)
  sessionCount: 25,              // Total sessions (22,500 sentences)
  batchSize: 100                 // Sentences per batch
}
```

**OpenRouter** (CLI options):
```bash
-m, --model <model>              # Any OpenRouter model (default: google/gemini-2.0-flash-exp:free)
-s, --sessions <number>          # Number of sessions (default: 25)
-p, --parallel-batches <number>  # Concurrent batches (default: 3)
--sentences-per-session <number> # Sentences per session (default: 900)
```

### Output Structure
```
output/
├── sentences/     # Final datasets (JSON + TXT with accent marks)
├── srt/          # Subtitle files for recording (2-sec gaps)
├── reports/      # Statistics and analytics
├── prompts/      # Generated AI prompts (debugging)
├── temp/         # Auto-save files (resume points)
└── backup/       # Pre-fix validation backups
```

## Important Context

### Language Requirements
- **Strict Belarusian**: Regex validation against Russian markers (ъ, щ, -ться)
- **Phoneme Coverage**: Tracks ў, дз, дж, ць for balanced representation
- **Word Count**: 3-20 words per sentence (optimal for TTS training)
- **Accent Marks**: GrammarDB with 240,000+ words for stress marking

### Content Distribution (per session)
```
75% Normal conversation    (~675 sentences)
10% Questions             (~90 sentences)
10% Emotional expressions (~90 sentences)
3%  Whispered speech      (~27 sentences)
2%  Non-verbal sounds     (~18 sentences)
```

### Phonetic Targets (per 100 sentences)
- 15+ words with ў sound
- 10+ words with дж/дз digraphs
- 8+ words with soft sign (ь)
- Balanced vowel/consonant distribution

### Resume & Recovery
```
output/temp/session1_temp.json    # Auto-saved every 100 sentences
output/sentences/session1.json    # Final output triggers resume
```
- Automatic continuation from interruption
- Duplicate prevention via sentence tracking
- Preserves batch and session metadata

### Validation Pipeline
1. **Regex Validation**: Russian detection, length checks (instant)
2. **AI Deep Validation**: Grammar, naturalness, context (Gemini/OpenRouter)
3. **Auto-fix Workflow**: Backup → AI correction → Save
4. **Accent Marking**: Context-aware stress placement via GrammarDB

### Recording Format (SRT)
```srt
1
00:00:00,000 --> 00:00:10,000
[1_10001] Добры дзень, мае сябры!

2
00:00:12,000 --> 00:00:22,000
[1_10002] (радасна) Я так шчаслівы сёння!
```

### API Comparison
| Feature | Gemini CLI | OpenRouter |
|---------|------------|------------|
| Setup | Simple (env var) | API key required |
| Models | Gemini only | 50+ models |
| Output | Text parsing | Structured JSON |
| Cost | Pay-per-use | Free tier + paid |
| SDK | CLI wrapper | AI SDK v4 |

## Testing & Development

### Running Tests
```bash
# No test suite currently implemented
# Use validation tools to verify generated content:
bun run validate        # Quick regex validation
bun run validate:deep   # AI-powered validation
```

### Development Workflow
```bash
# 1. Test generation with small batch
bun run generate:openrouter -s 1 --sentences-per-session 50

# 2. Validate output
bun run validate

# 3. Check specific features
grep "(злосна)" output/sentences/session1.txt  # Check anger expressions
grep "ў" output/sentences/session1.txt | wc -l  # Count ў usage
```

### Debugging
```bash
# View generated prompts
cat output/prompts/session1_prompts.txt

# Check temp files for in-progress generation
ls -la output/temp/

# Monitor API calls (Gemini CLI)
export DEBUG=1
bun run generate
```

## Type System & Data Flow

### Core Types (src/types.ts)
- **SentenceType**: 'normal' | 'question' | 'emotional' | 'whisper' | 'nonverbal'
- **EmotionType**: 'joy' | 'anger' | 'sadness' | 'fear' | 'surprise' | 'disgust' | 'love' | 'frustration'
- **NonVerbalType**: 'laugh' | 'sigh' | 'gasp' | 'cry' | 'scream' | 'cough' | 'sneeze' | 'hmm' | 'groan' | 'yawn' | 'hiccup'

### Sentence Object Structure
```typescript
interface Sentence {
  id: string;              // "sessionNum_10000+index"
  text: string;            // Raw sentence
  sessionNum: number;      // 1-25
  batchNum: number;        // Batch within session
  wordCount: number;       // 3-20 words
  estimatedDuration: number;
  sentenceType?: SentenceType;
  emotionType?: EmotionType;
  nonVerbalType?: NonVerbalType;
  intensity?: 'mild' | 'medium' | 'strong';
  accentedText?: string;   // With accent marks
  accentedWords?: AccentedWord[];
}
```

### Generation Flow
1. **Prompt Builder** creates topic-aware prompts with phonetic targets
2. **AI Generator** (Gemini/OpenRouter) produces raw sentences
3. **Validator** checks Belarusian authenticity and structure
4. **Type Detector** classifies sentences by content markers
5. **Accent Marker** adds stress marks using GrammarDB
6. **Output Writer** saves JSON/TXT/SRT formats

## Error Handling & Recovery

### Common Issues
- **Rate Limits**: Automatic retry with exponential backoff (up to 5 attempts)
- **API Errors**: Graceful degradation, saves progress before exit
- **Validation Failures**: Logs to `output/validation_errors.log`
- **Interrupted Generation**: Auto-resume from last saved batch

### Manual Recovery
```bash
# Resume interrupted session
bun run generate  # Automatically detects and resumes

# Force restart specific session
rm output/sentences/session5.json
rm output/temp/session5_temp.json
bun run generate

# Merge partial results
cat output/temp/session*_temp.txt > merged_partial.txt
```