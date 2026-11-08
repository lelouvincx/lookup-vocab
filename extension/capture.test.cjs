const {test} = require('node:test');
const assert = require('node:assert/strict');
require('./capture.js');
const {Settler} = globalThis.VocabularyCapture;
const value = (source = 'hello', translated = 'xin chào', languages = ['en', 'vi']) => ({
  identity: JSON.stringify([...languages, source]), sourceText: source, translatedText: translated,
  sourceLanguage: languages[0], targetLanguage: languages[1], associated: true
});

test('waits ten seconds and stable output; rerenders and old translation reappearing do not recapture', () => {
  const s = new Settler();
  assert.equal(s.sample(value(), 0), null);
  assert.equal(s.sample(value(), 9999), null);
  assert.equal(s.sample(value(), 10000).sourceText, 'hello');
  assert.equal(s.sample(value('hello', 'alternative'), 11000), null);
  assert.equal(s.sample(value(), 12000), null);
  // Old output stays visible after source changes: never accept it as the new pair.
  assert.equal(s.sample(value('goodbye', 'xin chào'), 13000), null);
  assert.equal(s.sample(value('goodbye', 'xin chào'), 22999), null);
  assert.equal(s.sample(value('goodbye', 'tạm biệt'), 23000), null);
  assert.equal(s.sample(value('goodbye', 'tạm biệt'), 24799), null);
  assert.equal(s.sample(value('goodbye', 'tạm biệt'), 24800).translatedText, 'tạm biệt');
  assert.equal(s.sample(value(), 25000), null);
  assert.equal(s.sample(value(), 34999), null);
  assert.equal(s.sample(value(), 35000).sourceText, 'hello');
});

test('typing resets source quiet time; language switching, auto detection, long text, pause are denied', () => {
  const s = new Settler();
  s.sample(value('h', 'h'), 0);
  s.sample(value('he', 'anh ta'), 1000);
  s.sample(value('hello'), 2000);
  assert.equal(s.sample(value(), 11999), null);
  assert.ok(s.sample(value(), 12000));
  for (const pair of [['auto', 'vi'], ['vi', 'en'], ['en', 'fr']]) {
    const other = new Settler();
    other.sample(value('hello', 'xin chào', pair), 0);
    assert.equal(other.sample(value('hello', 'xin chào', pair), 10000), null);
  }
  for (const [source, translated] of [['a'.repeat(301), 'x'], ['a '.repeat(81), 'x'], ['hello', 'x'.repeat(2001)]]) {
    const other = new Settler();
    other.sample(value(source, translated), 0);
    assert.equal(other.sample(value(source, translated), 10000), null);
  }
  const paused = new Settler();
  paused.sample(value(), 0, {paused: true});
  assert.equal(paused.sample(value(), 10000, {paused: false}), null, 'resume does not backfill paused lookup');
});

test('different sources with the same output are skipped conservatively', () => {
  const s = new Settler();
  s.sample(value(), 0);
  assert.ok(s.sample(value(), 10000));
  s.sample(value('hi'), 11000);
  assert.equal(s.sample(value('hi'), 21000), null);
});
