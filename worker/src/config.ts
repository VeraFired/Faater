/**
 * Fixed strings and limits. Nothing here is model-generated.
 *
 * The refusal and boundary copy is contract text, not UI copy: changing it
 * changes what the product promises. Persian copy is marked UNREVIEWED until a
 * native reviewer and a scholar pass it — it must not ship before then.
 */

export const VERSION = 'm1-0.1.0'

export const LIMITS = {
  minChars: 2,
  maxChars: 500,
  maxCards: 5,
  maxContext: 1,
} as const

export type Lang = 'en' | 'fa'

export const COPY = {
  en: {
    off_topic:
      'I can only answer questions about the Quran. This question is outside that scope, so I cannot answer it.',
    no_evidence:
      'I could not find a Quranic verse relevant to this question, so I cannot answer it. Try rephrasing with Quranic terms, or consult a qualified scholar.',
    too_short: 'Please ask a complete question.',
    too_long: 'That question is too long. Please shorten it.',
    fiqh_no_verse:
      'This question asks for a religious ruling, and I could not find a Quranic verse that addresses it directly. A ruling requires a qualified mufti.',
    fiqh_boundary:
      'The verses below are shown for reference only. This question asks for a religious ruling, and a ruling requires a qualified mufti.',
    crisis:
      'This question may involve a crisis or harm. I cannot provide guidance beyond the Quran, and this is not a substitute for professional help. If you are in immediate danger, contact your local emergency services or a crisis line in your country.',
    tafsir:
      'I can show the verse and its translations, but I do not provide tafsir or interpretation. Consult a qualified scholar for commentary.',
    meaning:
      'I cannot explain or interpret the Quran’s meaning. I can show verses and their translations; for meaning, consult a qualified scholar.',
  },
  fa: {
    // UNREVIEWED — native Persian review required before launch.
    off_topic:
      'من فقط به پرسش‌هایی درباره قرآن پاسخ می‌دهم. این پرسش خارج از این حوزه است و نمی‌توانم به آن پاسخ دهم.',
    no_evidence:
      'هیچ آیه‌ای از قرآن مرتبط با این پرسش پیدا نکردم؛ بنابراین نمی‌توانم به آن پاسخ دهم. لطفاً پرسش را با واژه‌های قرآنی بازنویسی کنید یا با عالمی واجد شرایط مشورت کنید.',
    too_short: 'لطفاً پرسش کامل‌تری بپرسید.',
    too_long: 'پرسش بیش از حد طولانی است. لطفاً آن را کوتاه‌تر کنید.',
    fiqh_no_verse:
      'این پرسش درخواست حکم شرعی است و آیه‌ای از قرآن نیافتم که مستقیماً به آن بپردازد. صدور حکم نیازمند مفتى واجد شرایط است.',
    fiqh_boundary:
      'آیات زیر فقط برای مراجعه نمایش داده می‌شوند. این پرسش درخواست حکم شرعی است و صدور حکم نیازمند مفتى واجد شرایط است.',
    crisis:
      'این پرسش ممکن است به بحران یا آسیب مربوط باشد. من نمی‌توانم فراتر از قرآن راهنمایی ارائه دهم و این پاسخ جایگزین کمک حرفه‌ای نیست. اگر در خطر فوری هستید، با خدمات اضطراری یا خط بحران کشور خود تماس بگیرید.',
    tafsir:
      'من می‌توانم آیه و ترجمه‌های آن را نشان دهم، اما تفسیر ارائه نمی‌دهم. برای تفسیر با عالمی واجد شرایط مشورت کنید.',
    meaning:
      'من نمی‌توانم معنا و تفسیر قرآن را توضیح دهم. می‌توانم آیات و ترجمه‌هایشان را نشان دهم؛ برای معنا با عالمی واجد شرایط مشورت کنید.',
  },
} as const

/**
 * Markers are a recall booster, never the decision. "Masjid al-Haram" contains
 * "haram"; the classifier (G1) is the intended primary signal. Until it exists,
 * a marker only upgrades an already-retrieved answer to `answered_with_boundary`
 * — it never invents an answer and never suppresses the verses.
 */
export const FIQH_MARKERS = [
  'halal', 'haram', 'fatwa', 'ruling', 'is it allowed', 'is it permissible',
  'is it forbidden', 'is it a sin', 'must i', 'wajib', 'makruh', 'sunnah of',
  'حلال', 'حرام', 'فتوا', 'حکم', 'جایز', 'واجب', 'مکروه', 'گناه',
] as const

/** Crisis and harm bypass verse cards entirely. A fixed referral, no retrieval. */
export const CRISIS_MARKERS = [
  'suicide', 'kill myself', 'end my life', 'self-harm', 'self harm', 'hurt myself',
  'domestic violence', 'being abused', 'he beats me', 'she beats me',
  'خودکشی', 'به خودم آسیب', 'آسیب به خودم', 'مرا کتک', 'خشونت خانگی',
] as const

/** Requests for commentary are refused with their own copy, not answered. */
export const TAFSIR_MARKERS = ['tafsir', 'tafseer', 'commentary', 'تفسیر', 'تفسير'] as const
export const MEANING_MARKERS = ['meaning of', 'interpret', 'تفسیر', 'معنی', 'معنا'] as const

export const containsMarker = (text: string, markers: readonly string[]): boolean => {
  const lower = text.toLowerCase()
  return markers.some((m) => lower.includes(m))
}