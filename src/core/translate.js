// On-device language detection and translation (Chrome's built-in Translator API), so
// Hindi, Tamil, Bengali and other messages are checked without leaving the device.

export async function toEnglish(text, { detectorApi = globalThis.LanguageDetector, translatorApi = globalThis.Translator } = {}) {
  if (!detectorApi || !translatorApi) return { text, translated: false };
  try {
    const det = await detectorApi.create();
    const [top] = await det.detect(text);
    if (!top || top.detectedLanguage === 'en' || top.confidence < 0.6) return { text, translated: false, language: top?.detectedLanguage };
    const pair = { sourceLanguage: top.detectedLanguage, targetLanguage: 'en' };
    if ((await translatorApi.availability(pair)) === 'unavailable') return { text, translated: false, language: top.detectedLanguage };
    const tr = await translatorApi.create(pair);
    return { text: await tr.translate(text), translated: true, language: top.detectedLanguage, original: text };
  } catch {
    return { text, translated: false };
  }
}
