/**
 * Faater frontend — zero dependencies, zero build step.
 *
 * The answer path is the Worker's. This file only renders what the API returns:
 * fixed copy, Arabic verbatim, labelled translations, links. It never composes
 * religious text and never calls a model.
 */

const STRINGS = {
  en: {
    title: 'Ask the Quran',
    lede: 'A free search over the Quran in English and Persian. You get verses and translations — never commentary, never a ruling.',
    label: 'Your question',
    placeholder: 'What does the Quran say about patience?',
    ask: 'Ask',
    hint: 'It can only answer from Quranic text. If no relevant verse is found, it refuses.',
    trustTitle: 'How to read this',
    trustArabic: 'The Arabic is the Quran, verbatim. Nothing on this site changes it.',
    trustTranslation: 'A translation is interpretation, not the Quran. Each translation is labelled with its translator.',
    trustNoTafsir: 'No tafsir and no explanation are shown. For meaning, consult a qualified scholar.',
    trustLinks: 'Verse links go to quran.com and tanzil.net; the text here comes from Tanzil and QuranEnc.',
    footer: 'Free to use. No accounts, no ads, no tracking.',
    footerLicense: 'Quran text: Tanzil.net (CC BY 3.0). Translations: QuranEnc.com.',
    error: 'Could not reach the service. Please try again.',
    verses: (n) => `${n} ${n === 1 ? 'verse' : 'verses'}`,
    translation: 'Translation',
    footnotes: 'Footnotes',
    quranCom: 'Read on quran.com',
    tanzil: 'Read on Tanzil',
    surah: 'Surah',
  },
  fa: {
    title: 'از قرآن بپرسید',
    lede: 'جست‌وجوی رایگان در قرآن به انگلیسی و فارسی. فقط آیه و ترجمه می‌بینید — نه تفسیر، نه حکم.',
    label: 'پرسش شما',
    placeholder: 'قرآن درباره صبر چه می‌گوید؟',
    ask: 'بپرسید',
    hint: 'این سامانه فقط از متن قرآن پاسخ می‌دهد. اگر آیه مرتبطی پیدا نشود، پاسخ نمی‌دهد.',
    trustTitle: 'چگونه این را بخوانیم',
    trustArabic: 'متن عربی، قرآن بدون تغییر است. هیچ چیز در این سایت آن را تغییر نمی‌دهد.',
    trustTranslation: 'ترجمه تفسیر است، نه خود قرآن. هر ترجمه با نام مترجم آمده است.',
    trustNoTafsir: 'تفسیر و توضیح نمایش داده نمی‌شود. برای معنا با عالمی واجد شرایط مشورت کنید.',
    trustLinks: 'پیوند آیات به quran.com و tanzil.net می‌رود؛ متن از تنزیل و قرآن‌انک است.',
    footer: 'استفاده رایگان. بدون حساب، بدون تبلیغ، بدون ردگیری.',
    footerLicense: 'متن قرآن: Tanzil.net (CC BY 3.0). ترجمه‌ها: QuranEnc.com.',
    error: 'ارتباط با سامانه برقرار نشد. دوباره تلاش کنید.',
    verses: (n) => `${n.toLocaleString('fa-IR')} آیه`,
    translation: 'ترجمه',
    footnotes: 'پانوشت‌ها',
    quranCom: 'خواندن در quran.com',
    tanzil: 'خواندن در تنزیل',
    surah: 'سوره',
  },
}

const $ = (sel, root = document) => root.querySelector(sel)
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  for (const child of children) node.append(child)
  return node
}

let lang = 'en'
try {
  const saved = localStorage.getItem('faater-lang')
  if (saved === 'fa' || saved === 'en') lang = saved
} catch {
  // private mode: fall back to navigation language
}
if (lang === 'en' && /^fa\b/i.test(navigator.language ?? '')) lang = 'fa'

const t = (key) => STRINGS[lang][key]

function applyLang() {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    if (key && typeof STRINGS[lang][key] === 'string') node.textContent = STRINGS[lang][key]
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = node.getAttribute('data-i18n-placeholder')
    if (key && typeof STRINGS[lang][key] === 'string') node.setAttribute('placeholder', STRINGS[lang][key])
  }
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang))
  }
  try {
    localStorage.setItem('faater-lang', lang)
  } catch {
    // ignore
  }
}

function verseCard(verse) {
  const surahName = verse.surah_name[lang] ?? verse.surah_name.en
  const head = el('div', { class: 'verse-head' }, [
    el('a', {
      class: 'verse-ref',
      href: verse.links.quran_com,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: verse.ref,
    }),
    el('span', { class: 'verse-surah', text: `${t('surah')} ${surahName}` }),
  ])

  const parts = [head]
  if (verse.basmala) {
    parts.push(el('div', { class: 'basmala', dir: 'rtl', lang: 'ar', text: verse.basmala }))
  }
  parts.push(el('p', { class: 'arabic', dir: 'rtl', lang: 'ar', text: verse.arabic }))

  for (const tr of verse.translations) {
    const label = el('span', {
      class: 'translation-label',
      text: `${t('translation')} · ${tr.title}`,
    })
    const text = el('p', {
      class: 'translation-text',
      lang: tr.language,
      dir: tr.language === 'en' ? 'ltr' : 'rtl',
      text: tr.text,
    })
    const block = el('div', { class: 'translation' }, [label, text])
    if (tr.footnotes?.length) {
      const list = el(
        'ol',
        {},
        tr.footnotes.map((fn) => el('li', { text: fn.text })),
      )
      block.append(el('details', { class: 'footnotes' }, [el('summary', { text: t('footnotes') }), list]))
    }
    parts.push(block)
  }

  const links = el('div', { class: 'card-links' }, [
    el('a', {
      href: verse.links.quran_com,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: t('quranCom'),
    }),
    el('a', {
      href: verse.links.tanzil,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: t('tanzil'),
    }),
  ])
  parts.push(links)

  return el('article', { class: 'verse-card' }, parts)
}

function clearResults() {
  const status = $('#status')
  const results = $('#results')
  status.hidden = true
  status.className = 'status'
  status.replaceChildren()
  results.replaceChildren()
}

function showMessage(kind, message) {
  const status = $('#status')
  status.hidden = false
  status.className = `status ${kind}`
  status.replaceChildren(el('p', { text: message }))
}

async function submit(query) {
  clearResults()
  const results = $('#results')
  results.append(el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }))
  const button = $('#submit')
  button.disabled = true

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, lang }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    results.replaceChildren()
    if (data.message) showMessage(data.status, data.message)
    for (const notice of data.notices ?? []) {
      results.append(el('div', { class: 'status-boundary', text: notice.text }))
    }
    if (data.verses?.length) {
      for (const verse of data.verses) results.append(verseCard(verse))
    }
  } catch {
    results.replaceChildren()
    showMessage('refused', t('error'))
  } finally {
    button.disabled = false
  }
}

$('#ask-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = $('#q')
  const query = input.value.trim()
  if (!query) return
  submit(query)
})

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => {
    lang = btn.dataset.lang
    applyLang()
    const results = $('#results')
    const status = $('#status')
    // Re-render the last result's chrome in the new language by re-rendering
    // only labels is not worth the complexity; clear stale monolingual copy.
    status.hidden = true
    results.replaceChildren()
  })
}

applyLang()