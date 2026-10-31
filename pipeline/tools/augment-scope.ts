/**
 * Augment the scope-training set with template-controlled questions.
 *
 * The generator produced few elliptical Persian questions ("دربارهٔ صبر چه
 * گفته شده؟") and almost no hard negatives that use the Quran frame
 * ("What does the Quran say about the first caliph?"). Without both, a lexical
 * model learns "Quran + topic" as a shortcut and refuses ordinary Persian
 * questions. These templates are hand-authored, deterministic, and auditable;
 * they are training data, not evaluation data.
 *
 * Usage:
 *   node pipeline/tools/augment-scope.ts [eval/scope-train.json]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'scope-train.json')
const lexicon = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8')) as {
  concepts: Array<{ id: string; en: string; fa: string }>
  names: Array<{ id: string; en: string; fa: string }>
}
const data = JSON.parse(await readFile(dataPath, 'utf8')) as {
  _meta: Record<string, unknown>
  items: Array<{ class: string; topic: string; q_en: string; q_fa: string }>
}

type Topic = { en: string; fa: string }
const FIQH: Topic[] = [
  { en: 'how many rak’ahs are in Fajr prayer', fa: 'تعداد رکعت‌های نماز صبح' },
  { en: 'the steps of wudu', fa: 'مراحل وضو' },
  { en: 'when ghusl is required', fa: 'موارد وجوب غسل' },
  { en: 'the rate of zakat', fa: 'مقدار زکات' },
  { en: 'khums', fa: 'خمس' },
  { en: 'prayer while travelling', fa: 'نماز مسافر' },
  { en: 'moon sighting for Ramadan', fa: 'رؤیت هلال رمضان' },
  { en: 'the marriage contract', fa: 'صیغهٔ عقد ازدواج' },
  { en: 'the procedure for divorce', fa: 'مراحل طلاق' },
  { en: 'inheritance shares', fa: 'سهم‌الارث' },
  { en: 'halal slaughter', fa: 'ذبح شرعی' },
  { en: 'bank interest', fa: 'سود بانکی' },
  { en: 'insurance', fa: 'بیمه' },
  { en: 'tayammum', fa: 'تیمم' },
  { en: 'the wording of the adhan', fa: 'متن اذان' },
]
const HISTORY: Topic[] = [
  { en: 'the first caliph', fa: 'خلیفهٔ اول' },
  { en: 'the Battle of Karbala', fa: 'واقعهٔ کربلا' },
  { en: 'the Umayyad dynasty', fa: 'دولت اموی' },
  { en: 'the Abbasid dynasty', fa: 'دولت عباسی' },
  { en: 'the compilation of hadith', fa: 'جمع‌آوری حدیث' },
  { en: 'Sahih al-Bukhari', fa: 'صحیح بخاری' },
  { en: 'the Prophet’s birth year', fa: 'سال تولد پیامبر' },
  { en: 'the Dome of the Rock', fa: 'قبه‌الصخره' },
  { en: 'Al-Azhar', fa: 'الازهر' },
  { en: 'the Ottoman caliphate', fa: 'خلافت عثمانی' },
  { en: 'Ibn Sina', fa: 'ابن‌سینا' },
  { en: 'Al-Khwarizmi', fa: 'خوارزمی' },
  { en: 'the first printing of the Quran', fa: 'اولین چاپ قرآن' },
  { en: 'the Grand Mosque of Cordoba', fa: 'مسجد قرطبه' },
  { en: 'the house of the Prophet in Medina', fa: 'خانهٔ پیامبر در مدینه' },
]
const OTHER_ISLAMIC: Topic[] = [
  { en: 'the number of hadiths', fa: 'تعداد احادیث' },
  { en: 'the chain of narration', fa: 'سند روایت' },
  { en: 'Tafsir al-Mizan', fa: 'تفسیر المیزان' },
  { en: 'the rules of tajwid', fa: 'احکام تجوید' },
  { en: 'the Hafs recitation', fa: 'قرائت حفص' },
  { en: 'the seven qira’at', fa: 'قرائات هفت‌گانه' },
  { en: 'the schools of law', fa: 'مذاهب فقهی' },
  { en: 'the number of surahs', fa: 'تعداد سوره‌ها' },
  { en: 'the order of revelation', fa: 'ترتیب نزول' },
  { en: 'abrogation in the Quran', fa: 'نسخ در قرآن' },
  { en: 'Ash’ari theology', fa: 'کلام اشعری' },
  { en: 'the Mu’tazila', fa: 'معتزله' },
  { en: 'Sufism', fa: 'تصوف' },
  { en: 'hadith qudsi', fa: 'حدیث قدسی' },
  { en: 'the orthography of the mushaf', fa: 'رسم‌الخط مصحف' },
]
const OOD: Topic[] = [
  { en: 'What is the capital of France?', fa: 'پایتخت فرانسه کجاست؟' },
  { en: 'How do I bake bread?', fa: 'چگونه نان بپزم؟' },
  { en: 'What is a Python list?', fa: 'لیست در پایتون چیست؟' },
  { en: 'How tall is Mount Everest?', fa: 'قلهٔ اورست چقدر بلند است؟' },
  { en: 'What is the weather like in Tehran?', fa: 'هوای تهران چگونه است؟' },
  { en: 'How do I change a car tire?', fa: 'چگونه لاستیک خودرو را عوض کنم؟' },
  { en: 'What is the boiling point of water?', fa: 'نقطهٔ جوش آب چند درجه است؟' },
  { en: 'Who won the 2022 World Cup?', fa: 'جام جهانی ۲۰۲۲ را چه کسی برد؟' },
  { en: 'How do I learn to play guitar?', fa: 'چگونه گیتار زدن را یاد بگیرم؟' },
  { en: 'What is the population of Japan?', fa: 'جمعیت ژاپن چقدر است؟' },
]

const items = [...data.items]
const seen = new Set(data.items.map((i) => i.q_en.toLowerCase().trim()))
const add = (cls: string, topic: string, q_en: string, q_fa: string) => {
  if (seen.has(q_en.toLowerCase().trim())) return
  seen.add(q_en.toLowerCase().trim())
  items.push({ class: cls, topic, q_en, q_fa })
}

// Quran-scope positives from the concept lexicon. Skip the `quran` concept:
// "What does the Quran say about the Quran?" is degenerate.
for (const c of [...lexicon.concepts, ...lexicon.names]) {
  if (!c.en || !c.fa || c.id === 'quran') continue
  add('quran', `aug:concept:${c.id}`, `What does the Quran say about ${c.en}?`, `قرآن دربارهٔ ${c.fa} چه می‌گوید؟`)
  add('quran', `aug:concept:${c.id}`, `What does the Quran teach about ${c.en}?`, `دربارهٔ ${c.fa} چه گفته شده است؟`)
  add('quran', `aug:concept:${c.id}`, `What does it say about ${c.en}?`, `دربارهٔ ${c.fa} چه می‌گوید؟`)
  add('quran', `aug:concept:${c.id}`, `What guidance is there about ${c.en}?`, `آیا دربارهٔ ${c.fa} راهنمایی وجود دارد؟`)
}

// Hard negatives in the same surface frame. A model that keys on "Quran +
// topic" must see that the frame is equally available to non-Quranic questions.
for (const [cls, topics] of [
  ['fiqh', FIQH],
  ['history', HISTORY],
  ['other_islamic', OTHER_ISLAMIC],
] as const) {
  for (const t of topics) {
    add(cls, `aug:hard:${t.en}`, `What does the Quran say about ${t.en}?`, `قرآن دربارهٔ ${t.fa} چه می‌گوید؟`)
    add(cls, `aug:hard:${t.en}`, `Does the Quran mention ${t.en}?`, `دربارهٔ ${t.fa} چه گفته شده است؟`)
    add(cls, `aug:hard:${t.en}`, `What does it say about ${t.en}?`, `دربارهٔ ${t.fa} چه می‌گوید؟`)
    add(cls, `aug:hard:${t.en}`, `What guidance is there about ${t.en}?`, `آیا دربارهٔ ${t.fa} راهنمایی وجود دارد؟`)
  }
}
for (const t of OOD) {
  add('ood', `aug:ood:${t.en}`, t.en, t.fa)
}

data._meta.augmented = {
  added: items.length - data.items.length,
  source: 'hand-authored templates + data/build/lexicon.json concept labels',
}
data.items = items
await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(`[augment-scope] ${data.items.length} items`)
console.log(`  added ${data._meta.augmented.added}`)
const counts: Record<string, number> = {}
for (const i of data.items) counts[i.class] = (counts[i.class] ?? 0) + 1
console.log('  counts:', counts)