const defaults = {paused: true, maxLength: 300, appUrl: '', token: ''};
let serial = Promise.resolve();
let controller;
let pauseRequested = false;
let delivery;
const locked = work => {
  const result = serial.then(work);
  serial = result.catch(() => {});
  return result;
};
const options = async () => ({...defaults, ...(await chrome.storage.local.get('options')).options});
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
chrome.alarms.create('deliver', {periodInMinutes: 1});

async function deliver() {
  while (true) {
    const config = await options();
    const {queue = []} = await chrome.storage.local.get('queue');
    const item = queue[0];
    if (pauseRequested || config.paused || !config.appUrl || !config.token || !item || item.nextAttempt > Date.now()) return;
    controller = new AbortController();
    try {
      const response = await fetch(`${config.appUrl}/api/captures`, {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`},
        body: JSON.stringify(item.capture), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        redirect: 'error', credentials: 'omit'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await locked(async () => {
        const {queue = []} = await chrome.storage.local.get('queue');
        await chrome.storage.local.set({queue: queue.filter(entry => entry.capture.eventId !== item.capture.eventId), lastError: ''});
      });
    } catch (error) {
      item.attempts += 1;
      item.nextAttempt = Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(item.attempts, 7));
      await locked(async () => {
        const {queue = []} = await chrome.storage.local.get('queue');
        await chrome.storage.local.set({queue: queue.map(entry => entry.capture.eventId === item.capture.eventId ? item : entry),
          lastError: error.name === 'AbortError' ? 'Delivery interrupted; queued for retry' : error.message});
      });
      return;
    } finally { controller = null; }
  }
}
function kickDelivery() {
  if (!delivery) delivery = deliver().catch(() => {}).finally(() => { delivery = null; });
}
chrome.alarms.onAlarm.addListener(kickDelivery);
chrome.runtime.onStartup.addListener(kickDelivery);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromSite = sender.tab && sender.url?.startsWith('https://translate.google.com/');
  const fromSettings = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!fromSite && !fromSettings) return false;
  // Abort promptly, even if a fetch currently occupies the serialization lock.
  if (fromSettings && ((message.type === 'configure' && message.options?.paused) || (message.type === 'pause' && message.paused) || message.type === 'clearQueue')) {
    pauseRequested = true;
    controller?.abort();
  }
  locked(async () => {
    const config = await options();
    if (fromSettings && message.type === 'clearQueue') {
      pauseRequested = true;
      await chrome.storage.local.set({options: {...config, paused: true}, queue: [], lastError: ''});
      return {ok: true};
    }
    if (fromSettings && message.type === 'pause') {
      pauseRequested = Boolean(message.paused);
      await chrome.storage.local.set({options: {...config, paused: pauseRequested}});
      return {ok: true};
    }
    if (message.type === 'status') {
      const {queue = [], lastError = ''} = await chrome.storage.local.get(['queue', 'lastError']);
      return {options: fromSite ? {paused: config.paused, maxLength: config.maxLength} : config, queued: queue.length, lastError};
    }
    if (fromSite && message.type === 'observe') {
      const {lookups = {}} = await chrome.storage.local.get('lookups');
      const key = String(sender.tab.id);
      if (lookups[key]?.identity !== message.identity) lookups[key] = {identity: message.identity, eventId: crypto.randomUUID()};
      await chrome.storage.local.set({lookups});
      return lookups[key];
    }
    if (fromSite && message.type === 'capture') {
      if (config.paused || pauseRequested) return {ok: true}; // Discard while paused, never create a deferred capture.
      const capture = message.capture;
      const {lookups = {}, queue = [], delivered = []} = await chrome.storage.local.get(['lookups', 'queue', 'delivered']);
      if (!capture || capture.eventId !== lookups[String(sender.tab.id)]?.eventId
        || capture.sourceLanguage !== 'en' || capture.targetLanguage !== 'vi'
        || typeof capture.sourceText !== 'string' || !capture.sourceText.trim()
        || capture.sourceText.length > Math.min(config.maxLength, 500) || capture.sourceText.trim().split(/\s+/u).length > 80
        || typeof capture.translatedText !== 'string' || !capture.translatedText.trim() || capture.translatedText.length > 2000
        || !Number.isFinite(Date.parse(capture.capturedAt))) throw new Error('Invalid capture');
      if (!delivered.includes(capture.eventId) && !queue.some(item => item.capture.eventId === capture.eventId)) {
        queue.push({capture, attempts: 0, nextAttempt: 0});
        // Keep the accepted ID with its tab revision even after delivery/reload.
        delivered.push(capture.eventId);
        await chrome.storage.local.set({queue, delivered});
      }
      return {ok: true};
    }
    if (fromSettings && message.type === 'configure') {
      const next = message.options;
      const url = new URL(next.appUrl);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use an HTTPS app origin, or localhost for development');
      if (!Number.isInteger(next.maxLength) || next.maxLength < 1 || next.maxLength > 500 || typeof next.token !== 'string' || !next.token.trim()) throw new Error('Enter a token and a length from 1 to 500');
      const {queue = []} = await chrome.storage.local.get('queue');
      if (queue.length && config.appUrl && config.appUrl !== url.origin) throw new Error('Deliver pending captures before changing app URL');
      if (!await chrome.permissions.contains({origins: [`${url.origin}/*`]})) throw new Error('App host permission was not granted');
      await chrome.storage.local.set({options: {...next, paused: Boolean(next.paused), appUrl: url.origin, token: next.token.trim()}});
      pauseRequested = Boolean(next.paused);
      if (config.appUrl && config.appUrl !== url.origin) await chrome.permissions.remove({origins: [`${config.appUrl}/*`]});
      return {ok: true};
    }
    if (fromSettings && message.type === 'retry') {
      const {queue = []} = await chrome.storage.local.get('queue');
      queue.forEach(item => { item.nextAttempt = 0; });
      await chrome.storage.local.set({queue});
      return {ok: true};
    }
    throw new Error('Unsupported request');
  }).then(result => {
    reply(result);
    if (['capture', 'configure', 'retry', 'pause'].includes(message.type)) kickDelivery();
  }, error => reply({ok: false, error: error.message}));
  return true;
});
chrome.tabs?.onRemoved?.addListener(id => locked(async () => {
  const {lookups = {}, delivered = [], queue = []} = await chrome.storage.local.get(['lookups', 'delivered', 'queue']);
  delete lookups[String(id)];
  const retained = new Set([...Object.values(lookups).map(value => value.eventId), ...queue.map(item => item.capture.eventId)]);
  await chrome.storage.local.set({lookups, delivered: delivered.filter(id => retained.has(id))});
}));
