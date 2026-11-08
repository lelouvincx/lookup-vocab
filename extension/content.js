(() => {
  const {read, Settler} = VocabularyCapture;
  const settler = new Settler();
  let options = {paused: true, maxLength: 300};
  let identity;
  let eventId;
  let pending;
  let busy = false;
  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  // Sampling avoids expensive whole-page mutation processing and catches SPA URL/language changes.
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      options = (await chrome.runtime.sendMessage({type: 'status'})).options;
      const value = read(document);
      if (identity !== value.identity) {
        pending = null;
        eventId = (await chrome.runtime.sendMessage({type: 'observe', identity: value.identity})).eventId;
        identity = value.identity;
      }
      if (read(document).identity !== identity) return;
      if (options.paused) pending = null;
      if (composing && !options.paused) return;
      const capture = settler.sample(value, performance.now(), options);
      if (capture) pending = {...capture, eventId};
      if (pending && !options.paused) {
        const response = await chrome.runtime.sendMessage({type: 'capture', capture: pending});
        if (response.ok) pending = null;
      }
    } catch { /* A suspended/reloaded extension or transient storage failure retries next sample. */ }
    finally { busy = false; }
  }
  setInterval(tick, 250);
  tick();
})();
