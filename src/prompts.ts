export interface PromptConfig {
  sessionFocuses: string[];
  topicGuidances: string[];
  phoneticTargets: {
    uwSounds: number;
    dzhdz: number;
    softSign: number;
  };
  lengthDistribution: {
    short: { count: number; range: string; description: string };
    medium: { count: number; range: string; description: string };
    long: { count: number; range: string; description: string };
  };
}

export const PROMPT_CONFIG: PromptConfig = {
  sessionFocuses: [
    "Focus on present tense and everyday activities (morning routine, work, school, shopping)",
    "Focus on past tense and recent events (yesterday, last week, childhood memories)", 
    "Focus on future tense and plans (tomorrow, weekend, next month, vacation)",
    "Focus on opinions, preferences, and discussions (likes, dislikes, advice, suggestions)"
  ],
  
  topicGuidances: [
    "TOPICS: Food and cooking (breakfast, lunch, dinner, cafes, restaurants, recipes, groceries)",
    "TOPICS: Work and education (office, meetings, homework, exams, colleagues, deadlines, projects)", 
    "TOPICS: Technology and internet (phones, apps, social media, computers, games, online shopping)",
    "TOPICS: Entertainment (movies, TV shows, music, concerts, books, YouTube, streaming)",
    "TOPICS: Sports and fitness (gym, running, football, swimming, yoga, health habits)",
    "TOPICS: Transportation and travel (bus, car, traffic, vacation plans, hotels, airports)",
    "TOPICS: Shopping and money (stores, prices, sales, online shopping, budget, salary)",
    "TOPICS: Family and relationships (parents, kids, friends, dating, parties, celebrations)",
    "TOPICS: Numbers and counting (time, dates, ages, prices, phone numbers, addresses, quantities, years, percentages)"
  ],

  phoneticTargets: {
    uwSounds: 15,      // Words with ў sound
    dzhdz: 10,         // Words with дж/дз sounds
    softSign: 8        // Words with soft sign (ь)
  },

  lengthDistribution: {
    short: { count: 20, range: "3-6 words", description: "Simple statements, greetings, basic facts" },
    medium: { count: 35, range: "7-12 words", description: "Standard conversational sentences" },
    long: { count: 20, range: "13-18 words", description: "Complex ideas, descriptions, explanations" }
  }
};

export function createMainPrompt(
  sessionNum: number, 
  batchNum: number, 
  previousSentences: string[] = [],
  batchSize: number = 100
): string {
  const baseNum = sessionNum * 10000 + batchNum * batchSize;
  
  // Prepare previous sentences section - with 1M context we can show many more
  const previousSection = previousSentences.length > 0 ? `
IMPORTANT - DO NOT REPEAT THESE ALREADY GENERATED SENTENCES:
${previousSentences.map((sent, i) => `• ${sent}`).join('\n')}

Total sentences to avoid: ${previousSentences.length}
YOU MUST GENERATE COMPLETELY NEW AND DIFFERENT SENTENCES. NO REPETITION ALLOWED!
` : '';

  const sessionFocus = getSessionFocus(sessionNum);
  const topicGuidance = getTopicGuidance(batchNum);
  const { short, medium, long } = PROMPT_CONFIG.lengthDistribution;
  const { uwSounds, dzhdz, softSign } = PROMPT_CONFIG.phoneticTargets;

  return `Generate Belarusian sentences for a text-to-speech dataset.
${previousSection}

SESSION: ${sessionNum}, BATCH: ${batchNum + 1}

REQUIREMENTS:
1. Generate exactly ${batchSize} Belarusian sentences with this distribution:
   - ${Math.floor(batchSize * 0.70)} normal conversational sentences (${Math.floor(short.count * batchSize * 0.70/100)} short ${short.range}, ${Math.floor(medium.count * batchSize * 0.70/100)} medium ${medium.range}, ${Math.floor(long.count * batchSize * 0.70/100)} long ${long.range})
   - ${Math.floor(batchSize * 0.10)} questions (various types: yes/no, what, where, when, why, how)
   - ${Math.floor(batchSize * 0.10)} emotional sentences with emotion markers
   - ${Math.floor(batchSize * 0.05)} strong language/profanity sentences (marked with (злосна) or (раздражнёна))
   - ${Math.floor(batchSize * 0.03)} whisper sentences (marked with (шэпча), (ціха), or (ледзь чутна))
   - ${Math.floor(batchSize * 0.02)} non-verbal vocalizations (laughs, sighs, cries, etc.)

2. PHONETIC DIVERSITY REQUIREMENTS:
   - Include words with Belarusian-specific sounds: ў, дж, дз, цц, дзь
   - Balance consonant clusters: тр, кр, пр, шч, сць, ння
   - Ensure vowel variety: а, о, у, э, ы, і, я, ё, ю, е
   - Include both soft and hard consonants in each batch

3. GENDER DIVERSITY REQUIREMENTS:
   - 40% sentences from female perspective (using feminine verb forms: рабіла, пайшла, была)
   - 40% sentences from male perspective (using masculine forms: рабіў, пайшоў, быў)
   - 20% neutral/mixed gender sentences
   - Include diverse speakers: дзяўчына, жанчына, хлопец, мужчына, бабуля, дзядуля

4. SPEECH REGISTER DIVERSITY:
   - 70% colloquial/everyday language 
   - 20% neutral/standard register
   - 10% formal register (news, official announcements, academic)
   - Include incomplete thoughts, fillers ("ну", "дык", "гэта")
   - Natural exclamations ("Ой!", "Вай!", "Божа!")
   - Mix everyday and formal: both "ідзём у краму" and "наведваем крамніцу"

5. ABBREVIATIONS (include 5-10 per batch):
   - Common: г.д. (і гэтак далей), г.зн. (гэта значыць), напр. (напрыклад)
   - Titles: сп. (спадар), спн. (спадарыня), др. (доктар)
   - Time: г. (год/гадзіна), хв. (хвіліна), ст. (стагоддзе)
   - Academic: універ. (універсітэт), выкл. (выкладчык), студ. (студэнт)
   - Geographic: г. (горад), в. (вёска), р. (рака), возера (воз.)
   - Organizations: ААН (Арганізацыя Аб'яднаных Нацый)
   - Format: Include the abbreviation followed by full form in parentheses first time

6. Use authentic Belarusian (NO Russian influence)
7. Include stage directions in parentheses for emotional/non-verbal content
8. CRITICAL: Every sentence must be unique with varied vocabulary and structures
9. NUMBERS: Include 10-15 sentences with numbers (time, prices, dates, ages, phone numbers, addresses, quantities) written as digits not words

PHONETIC TARGETS FOR THIS BATCH:
- Must include at least ${uwSounds} words with ў sound
- Must include at least ${dzhdz} words with дж/дз sounds  
- Must include at least ${softSign} words with soft sign (ь)
- Ensure consonant cluster variety across all sentences

LENGTH DISTRIBUTION (Normal sentences):
- ${short.count} short (${short.range}): ${short.description}
- ${medium.count} medium (${medium.range}): ${medium.description}
- ${long.count} long (${long.range}): ${long.description}

SENTENCE TYPE GUIDELINES:

QUESTIONS (10 sentences) - Create diverse interrogative patterns:
- Location questions: Use varied structures with different contexts
- Time questions: Different temporal frameworks  
- Reason questions: Various motivations
- Object questions: Different focus points
- Method questions: Process variety
- Yes/no questions: Mix different question patterns
Use everyday contexts: work, family, shopping, hobbies, school.

EMOTIONAL (10 sentences) - Vary emotional contexts and intensity:
Emotion markers to rotate: (радасна), (сумна), (злосна), (здзіўлена), (з любоўю), (са страхам), (расчаравана), (з гонарам), (з трывогай), (весела), (з нецярпеннем), (ўзрушана)
- Mix short exclamations (1-3 words) with longer expressions (5-10 words)
- Use different situations: achievements, disappointments, surprises, relationships
- Vary intensity within emotions

WHISPER (3 sentences) - Diverse quiet contexts:
- Use different whisper markers: (шэпча), (ціха), (ледзь чутна)
- THEMES: library situations, sleeping baby contexts, nature observations, intimate conversations
- AVOID: Only secret/conspiracy content
- Length: 4-8 words typically

NON-VERBAL (2 vocalizations) - Natural sound expressions:
Rotate through: (смяецца), (уздыхае), (плача), (кашляе), (чыхае), (стогне), (пазяхае), (ахае)
- Mix formats: Some standalone like "(уздыхае)" or "(смяецца)", some with context
- Examples: 
  * Standalone: "[10050] (уздыхае)"
  * With context: "[10051] (смяецца) Гэта было вельмі смешна!"

PROFANITY/STRONG LANGUAGE (5 sentences) - Authentic angry/frustrated expressions:
- Use markers: (злосна), (раздражнёна), (крычыць), (абурана), (лаецца), (сварыцца)
- Include authentic Belarusian swear words and insults
- Range from mild to strong:
  * Mild: чорт, д'ябал, халера, бліскавіца
  * Medium: дурань, ідыёт, дурны, гад, сволач, скаціна, хрэн
  * Strong: курва, сука, жопа, лайно, срака
  * Very strong: хуй, хуйня, пізда, піздзец, ебаць, блядзь and their derivatives
- Vary contexts: traffic ("Куды прэш, ідыёт!"), work frustration, sports, arguments, gaming rage
- Keep natural - authentic emotional outbursts
- Mix single expletives with full angry sentences

NORMAL SENTENCES (70) - Follow phonetic and topical distribution:
${sessionFocus}
${topicGuidance}

VOCABULARY DIVERSITY REQUIREMENTS:
- Use different sentence starters (avoid repetitive beginnings)
- Rotate verbs: avoid overusing common verbs like "быць", "мець", "рабіць"
- Include synonyms and varied expressions for common concepts
- Mix registers appropriately: 70% colloquial, 20% neutral, 10% formal
- Include regional Belarusian expressions naturally

REGISTER & STYLE EXAMPLES:
- Colloquial: "Дык куды пайшлі?", "Ну і дзе яна?", "Забылася зусім!"
- Neutral: "Мы ідзём у краму па хлеб", "Яна працуе ў офісе"
- Formal: "Паважаныя грамадзяне, просім захоўваць цішыню"
- With abbreviations: "Сп. (спадар) Іваноў прыйшоў а 10 г. (гадзіне)"
- Female forms: "Я была ў горадзе", "Яна сказала мне"
- Male forms: "Я быў дома", "Ён пайшоў на працу"

FORMAT: Each sentence MUST start with [ID] where ID is a 5-digit number starting from ${String(baseNum + 1).padStart(5, '0')}.
Example format:
[${String(baseNum + 1).padStart(5, '0')}] Першае сказ без маркера.
[${String(baseNum + 2).padStart(5, '0')}] Другое сказ таксама без маркера.
[${String(baseNum + 3).padStart(5, '0')}] (радасна) Трэцяе сказ з маркерам эмоцыі.

IMPORTANT: Every line MUST start with [XXXXX] format. DO NOT OUTPUT PLAIN SENTENCES.

BEGIN GENERATION:`;
}

export function getSessionFocus(sessionNum: number): string {
  return PROMPT_CONFIG.sessionFocuses[(sessionNum - 1) % PROMPT_CONFIG.sessionFocuses.length];
}

export function getTopicGuidance(batchNum: number): string {
  return PROMPT_CONFIG.topicGuidances[batchNum % PROMPT_CONFIG.topicGuidances.length];
}

export function createStructuredPrompt(
  sessionNum: number, 
  batchNum: number, 
  previousSentences: string[] = []
): string {
  const sessionFocus = getSessionFocus(sessionNum);
  const topicGuidance = getTopicGuidance(batchNum);
  const { uwSounds, dzhdz, softSign } = PROMPT_CONFIG.phoneticTargets;

  const previousSection = previousSentences.length > 0 ? `
DO NOT REPEAT THESE SENTENCES:
${previousSentences.slice(-50).join('\n')}
` : '';

  return `Generate exactly 100 Belarusian sentences for a TTS dataset.

${previousSection}

STRICT REQUIREMENTS:
- 75 normal conversational sentences
- 10 questions (varied types: yes/no, what, where, when, why, how)
- 10 emotional sentences with markers
- 3 whispered sentences with markers
- 2 non-verbal vocalizations

LANGUAGE: Pure Belarusian without Russian influence

${sessionFocus}
${topicGuidance}

PHONETIC REQUIREMENTS:
- Include at least ${uwSounds} words with ў
- Include at least ${dzhdz} words with дж/дз
- Include at least ${softSign} words with ь

EMOTION MARKERS: радасна, сумна, злосна, здзіўлена, з любоўю, са страхам, расчаравана, з гонарам, з трывогай, весела
WHISPER MARKERS: шэпча, ціха, ледзь чутна
NON-VERBAL MARKERS: смяецца, уздыхае, плача, крычыць, кашляе, чыхае, стогне, пазяхае, ахае

Return a JSON object with a "sentences" array containing objects with:
- text: the sentence without markers or formatting
- type: one of "normal", "question", "emotional", "whisper", "nonverbal"
- marker: (optional) the emotion/action marker without parentheses`;
}

export function createValidationPrompt(sentences: { id: string; text: string }[]): string {
  const sentenceList = sentences.map((s, i) => 
    `${i + 1}. [${s.id}] ${s.text}`
  ).join('\n');

  return `You are a Belarusian language expert. Analyze these sentences for a TTS dataset.

For each sentence, provide:
1. Quality score (1-10, where 10 = perfect)
2. Issues found (if any)  
3. Corrected version (if score < 8)

Check for:
- Grammar correctness
- Natural Belarusian (not Russian influence)
- Pronunciation difficulty for TTS
- Meaning clarity
- Cultural appropriateness
- Accent marks (stress marks):
  * Are accent marks correctly placed based on context?
  * For homographs (like замак/castle vs lock), is the correct stress shown?
  * Are difficult/rare words properly marked with accents?
  * Should any accents be added or removed?

SENTENCES TO ANALYZE:
${sentenceList}

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
1. Score: 9/10 | Issues: none | Suggestion: - | Accent: correct
2. Score: 6/10 | Issues: Russian word "что" should be "што" | Suggestion: Што ты думаеш пра гэта? | Accent: needs за́мак not замо́к
3. Score: 8/10 | Issues: minor - could be more natural | Suggestion: - | Accent: add stress to універсітэ́т

Note: For accent issues, specify what needs to be changed. Use "correct" if accents are fine.

ANALYZE ALL ${sentences.length} SENTENCES:`;
}