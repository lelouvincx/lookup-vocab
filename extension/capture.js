/* Shared by the content script and browser-free contract tests. */
globalThis.VocabularyCapture = (() => {
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  const visible = node => node.getClientRects().length > 0;

  function read(document) {
    const input = document.querySelector('textarea[jsname="BJE2fc"]');
    const tabs = [...document.querySelectorAll('[role="tablist"]')].filter(visible);
    const language = list => list?.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-language-code');
    const sourceLanguage = language(tabs[0]);
    const targetLanguage = language(tabs[1]);
    const sourceText = normalize(input?.value || '');
    const identity = JSON.stringify([sourceLanguage, targetLanguage, sourceText]);
    const result = {identity, sourceText, sourceLanguage, targetLanguage, translatedText: '', associated: false};
    if (!input || !visible(input) || sourceLanguage !== 'en' || targetLanguage !== 'vi') return result;
    for (const panel of document.querySelectorAll('c-wiz[jsrenderer="XYnMcf"][data-p]')) {
      if (!visible(panel)) continue;
      let data;
      try { data = JSON.parse(panel.getAttribute('data-p').replace(/^%\.@\./u, '[')); } catch { continue; }
      const spans = [...panel.querySelectorAll('[jsname="W297wb"]')].filter(visible);
      const translatedText = normalize(spans.map(span => span.textContent).join(' '));
      if (translatedText && spans.every(span => span.closest('[lang]')?.getAttribute('lang') === 'vi')) {
        // data-p is server-render metadata: it does NOT update during SPA typing.
        return {...result, translatedText, associated: data[0] === 'en' && data[1] === 'vi' && normalize(data[2] || '') === sourceText};
      }
    }
    return result;
  }

  class Settler {
    constructor() {
      this.identity = null; this.pair = ''; this.since = 0; this.consumed = false;
      this.lastOutput = ''; this.baseline = ''; this.sourceSince = 0; this.owners = new Map();
    }
    sample(value, now, {paused = false, maxLength = 300} = {}) {
      if (this.identity !== value.identity) {
        const initial = this.identity === null;
        this.identity = value.identity;
        this.baseline = initial && value.associated ? '' : this.lastOutput || value.translatedText;
        this.pair = '';
        this.since = now;
        this.sourceSince = now;
        this.consumed = false;
      }
      if (paused) this.consumed = true;
      const owner = this.owners.get(value.translatedText);
      const valid = value.translatedText && value.translatedText !== this.baseline && (!owner || owner === value.identity)
        && value.sourceLanguage === 'en' && value.targetLanguage === 'vi'
        && value.sourceText && value.sourceText.length <= Math.min(maxLength, 500)
        && value.sourceText.split(/\s+/u).length <= 80 && value.translatedText.length <= 2000;
      this.lastOutput = value.translatedText;
      const pair = valid ? JSON.stringify([value.sourceText, value.translatedText]) : '';
      if (pair !== this.pair) { this.pair = pair; this.since = now; }
      if (!pair || this.consumed || now - this.since < 1800 || now - this.sourceSince < 10000) return null;
      this.consumed = true;
      this.owners.set(value.translatedText, value.identity);
      return {sourceText: value.sourceText, translatedText: value.translatedText,
        sourceLanguage: 'en', targetLanguage: 'vi', capturedAt: new Date().toISOString()};
    }
  }
  return {read, Settler};
})();
