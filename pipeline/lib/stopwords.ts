/**
 * Query-side stopwords for the English and Persian fields.
 *
 * Scope is deliberately narrow: function words only. Quantifiers and content
 * words that happen to be common ("all", "more", "great") are left in, because
 * in scripture they carry meaning — «all praise» is not the same as «praise».
 *
 * These are applied at QUERY time only. The index keeps every token, so
 * contiguous-phrase matching still sees the exact document text.
 *
 * Arabic is intentionally absent: its function words are clitics (و، ب، ل، ال)
 * that the stemmer already handles, and a standalone Arabic stopword list risks
 * stripping «ما» («what») from questions that need it.
 */

import { normalizeJoined } from './normalize.ts'

export const STOPWORDS_EN: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because', 'while', 'until',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'about',
  'as', 'upon', 'through', 'against', 'between', 'during', 'before', 'after',
  'above', 'below', 'over', 'under',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
  'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  // Folded contractions. foldEnglish("what's") is "whats", so the global
  // stopword "what" alone does not filter the query-side form.
  'whats',
  'not', 'no', 'nor', 'there', 'here', 'whether', 'own', 'same',
  's', 't', 'don', 'doesn', 'isn', 'aren', 'wasn', 'weren', 'won', 'wouldn',
  // The question frame itself: "what does it SAY ABOUT X". These describe the
  // act of asking, not the topic. "say" appears in 647 English verses, so as a
  // query term it outranks the topic word and returns short verses beginning
  // "Say, ...". Speech verbs stay in when they ARE the topic (speak, speech),
  // because those queries are genuinely about speech.
  'say', 'says', 'said', 'saying', 'tell', 'tells', 'told',
  'regarding', 'concerning', 'regards', 'according', 'mention', 'mentions',
])

/**
 * Persian stopwords, hand-chosen but MACHINE-FOLDED below.
 *
 * Writing these in Persian orthography does not work: normalize() folds
 * ک→ك, ی→ي and آ→ا, so a set literal containing «که» never matches a query
 * token, which has already become «كه». Every entry is put through
 * normalizeJoined() so the stored form is exactly what the tokenizer will
 * produce.
 */
const FA_RAW = [
  // function words
  'و', 'در', 'به', 'از', 'که', 'این', 'آن', 'را', 'با', 'برای', 'بر',
  'است', 'بود', 'بودن', 'شد', 'شده', 'شود', 'می', 'نمی',
  'یک', 'تا', 'هم', 'یا', 'اگر', 'ولی', 'اما', 'پس', 'چون',
  'چه', 'چرا', 'چگونه', 'کجا', 'کی', 'آیا',
  'همه', 'هیچ', 'نیز', 'دیگر', 'باید',
  'کرد', 'کند', 'کنم', 'کنی', 'کنیم', 'کنید', 'کنند',
  'هست', 'نیست', 'خود', 'خویش', 'وی', 'او',
  'آنها', 'آنان', 'ایشان', 'ما', 'شما', 'من', 'تو',
  // The question frame: «درباره X چه می‌گوید». «درباره» is RARE in the corpus
  // (12 verses), which gives it a HIGH idf — so every Persian question phrased
  // the ordinary way returned those same 12 verses and nothing else. Rare is
  // not the same as informative.
  'درباره', 'باره', 'مورد', 'راجع', 'خصوص', 'باب', 'نسبت',
  'گوید', 'گویند', 'گفته', 'بگو', 'بگوی', 'بگوید', 'بگویید',
  'می‌گوید', 'می‌گویند', 'می‌گویم', 'می‌شود', 'نمی‌شود',
  'می‌کند', 'نمی‌کند', 'می‌توان', 'نمی‌توان',
]

function derive(raw: string[]): ReadonlySet<string> {
  const out = new Set<string>()
  for (const entry of raw) {
    // Joined form only. Splitting a ZWNJ entry into its parts looks harmless
    // but smuggles content words in: «می‌توان» splits to «مي» + «توان», and
    // «توان» means "power/ability", so every query containing it lost that
    // term. The split parts that ARE function words («مي», «گويد») are listed
    // in FA_RAW explicitly.
    const joined = normalizeJoined(entry)
    if (joined) out.add(joined)
  }
  return out
}

export const STOPWORDS_FA: ReadonlySet<string> = derive(FA_RAW)

/**
 * Words that name the corpus itself. In a question like "what does the Quran
 * say about patience" they describe the frame, not the information sought, and
 * they cannot discriminate between verses because they are the subject of all
 * of them.
 *
 * They are DOWN-WEIGHTED (see FRAME_WEIGHT in bm25.ts), never deleted:
 * "القرآن الكريم" and «قرآن چیست» are questions about the Quran itself and must
 * still retrieve it.
 */
export const FRAME_TERMS: ReadonlySet<string> = new Set([
  'quran', 'koran', 'quraan',
  // Folded possessives/plurals of the corpus name. "Quran's" becomes "qurans"
  // before English search, and without these the possessive is a content term
  // even though its singular is a frame term.
  'qurans', 'korans', 'quraans', 'alquran',
  // Normalized forms: normalize() folds آ→ا, so these are what reaches search.
  'قران', 'القران',
])

/**
 * English function words used for language identification, not for filtering.
 * If any appear, the query is an English sentence and must not be run through
 * the Finglish expander — "quran" is a valid Finglish key, and without this
 * guard the English question "what does the Quran say about X" expanded into
 * Arabic and hijacked the ranking.
 */
export const ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'what', 'which', 'who', 'how', 'why', 'when', 'where',
  'does', 'do', 'did', 'is', 'are', 'was', 'were', 'be', 'been',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'about', 'and', 'or',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her',
  'this', 'that', 'these', 'those', 'can', 'should', 'would', 'will',
  'me', 'tell', 'please',
])

/**
 * Fold English search text into a plain ASCII-ish key space.
 *
 * Two different defects live here:
 *   1. Apostrophes. normalize() turns `'` into a SPACE, so «Qur'an» indexes as
 *      the two tokens "qur an" and can never match a user typing "quran".
 *   2. Transliteration diacritics. The Sahih International edition writes
 *      «qurān» with a macron (U+0101) and «ṣalāh» with dots below, so *even*
 *      after the apostrophe fix the token is "qurān", not "quran". NFD
 *      decomposition plus a combining-mark strip turns ā→a, ṣ→s, ḥ→h.
 *
 * Applied to the English field only, and only to search keys — display text is
 * never touched.
 */
export function foldEnglish(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // ā → a, ṣ → s, ḥ → h
    .replace(/['‘’ʼ`]/g, '') // qur'an → quran
    .replace(/[ʿʾʻˈʕ]/g, '') // transliteration half-rings
    .normalize('NFC')
}