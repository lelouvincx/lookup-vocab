const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const http = require('node:http');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(`${__dirname}/background.js`, 'utf8');
const site = {url: 'https://translate.google.com/?sl=en&tl=vi', tab: {id: 7}};
const settings = {url: 'chrome-extension://test/settings.html', tab: {id: 8}};

function worker(state) {
  let listener;
  const context = vm.createContext({crypto: webcrypto, fetch, URL, AbortController, AbortSignal,
    chrome: {
      storage: {local: {setAccessLevel: async () => {},
        get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(state[key])])),
        set: async values => Object.assign(state, structuredClone(values))}},
      alarms: {create() {}, onAlarm: {addListener() {}}},
      tabs: {onRemoved: {addListener() {}}},
      permissions: {contains: async () => true, remove: async () => true},
      runtime: {getURL: path => `chrome-extension://test/${path}`,
        onStartup: {addListener() {}}, onMessage: {addListener(fn) { listener = fn; }}}
    }});
  vm.runInContext(source, context);
  return {
    send: (message, sender = site) => new Promise(resolve => {
      if (!listener(message, sender, resolve)) resolve({denied: true});
    }),
    flush: async () => {
      await new Promise(setImmediate);
      await vm.runInContext('serial', context);
      await vm.runInContext('delivery', context);
    }
  };
}

test('durable queue survives worker restart; network retry uses exactly the same eventId; pause and dedup', async t => {
  const requests = [];
  let failing = true;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({path: req.url, auth: req.headers.authorization, body: JSON.parse(body)});
    res.writeHead(failing ? 503 : 200, {'Content-Type': 'application/json'});
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const state = {};
  let w = worker(state);
  const config = {appUrl: `http://127.0.0.1:${server.address().port}`, token: 'synthetic-test-token', maxLength: 300, paused: false};
  assert.equal((await w.send({type: 'configure', options: config}, settings)).ok, true);
  const {eventId} = await w.send({type: 'observe', identity: '["en","vi","hello"]'});
  const capture = {eventId, sourceText: 'hello', translatedText: 'xin chào', sourceLanguage: 'en', targetLanguage: 'vi', capturedAt: new Date().toISOString()};
  await w.send({type: 'capture', capture});
  await w.flush();
  assert.equal(state.queue.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(state.queue[0].capture.eventId, eventId);
  assert.equal((await w.send({type: 'status'})).options.token, undefined, 'content script cannot read token');
  assert.equal((await w.send({type: 'status'}, {url: 'https://example.com', tab: {id: 7}})).denied, true);
  await w.send({type: 'pause', paused: true}, settings);
  await w.flush();
  w = worker(state); // Same persisted storage, brand-new worker globals.
  failing = false;
  await w.send({type: 'retry'}, settings);
  await w.flush();
  assert.equal(requests.length, 1, 'paused worker does not upload');
  await w.send({type: 'pause', paused: false}, settings);
  await w.flush();
  assert.equal(state.queue.length, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => r.body.eventId), [eventId, eventId]);
  assert.ok(requests.every(r => r.path === '/api/captures' && r.auth === 'Bearer synthetic-test-token'));
  assert.equal((await w.send({type: 'observe', identity: '["en","vi","hello"]'})).eventId, eventId);
  await w.send({type: 'capture', capture});
  await w.flush();
  assert.equal(requests.length, 2, 'reload/rerender cannot create another event');
  await w.send({type: 'observe', identity: '["en","vi",""]'});
  const repeated = await w.send({type: 'observe', identity: '["en","vi","hello"]'});
  assert.notEqual(repeated.eventId, eventId, 'clear then repeat creates a new review event');
  await w.send({type: 'pause', paused: true}, settings);
  await w.send({type: 'capture', capture: {...capture, eventId: repeated.eventId}});
  await w.flush();
  assert.equal(state.queue.length, 0, 'paused captures are discarded, not backfilled');
  assert.equal((await w.send({type: 'configure', options: {...config, maxLength: 501}}, settings)).ok, false);
  failing = true;
  await w.send({type: 'pause', paused: false}, settings);
  await w.send({type: 'capture', capture: {...capture, eventId: repeated.eventId}});
  await w.flush();
  assert.equal(state.queue.length, 1);
  await w.send({type: 'clearQueue'}, settings);
  await w.flush();
  assert.equal(state.queue.length, 0, 'clear pending is a recovery path for permanently rejected captures');
  assert.equal(state.options.paused, true, 'clearing also pauses');
  assert.equal(state.lastError, '');
});
