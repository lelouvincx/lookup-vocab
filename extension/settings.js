const form = document.querySelector('form');
const status = document.querySelector('#status');
const fields = ['appUrl', 'token', 'maxLength', 'paused'];
document.querySelector('#paused').addEventListener('change', async event => {
  try {
    const result = await chrome.runtime.sendMessage({type: 'pause', paused: event.target.checked});
    if (result.error) throw new Error(result.error);
    status.textContent = event.target.checked ? 'Capture and delivery paused' : 'Capture and delivery resumed';
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
async function refresh(fill = false) {
  const data = await chrome.runtime.sendMessage({type: 'status'});
  if (fill) for (const field of fields) {
    const input = document.getElementById(field);
    if (field === 'paused') input.checked = data.options[field];
    else input.value = data.options[field];
  }
  document.querySelector('#queue').textContent = `${data.queued} pending captures${data.lastError ? ` · ${data.lastError}` : ''}`;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const url = new URL(document.querySelector('#appUrl').value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use an HTTPS app origin, or localhost for development');
    const appUrl = url.origin;
    if (!await chrome.permissions.request({origins: [`${appUrl}/*`]})) throw new Error('App host permission was not granted');
    const result = await chrome.runtime.sendMessage({type: 'configure', options: {
      appUrl, token: document.querySelector('#token').value,
      maxLength: Number(document.querySelector('#maxLength').value), paused: document.querySelector('#paused').checked
    }});
    if (result.error) throw new Error(result.error);
    status.textContent = 'Settings saved';
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#retry').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'retry'});
  status.textContent = 'Retry requested. Delivery stays paused if pause is enabled.';
  await refresh();
});
document.querySelector('#clear').addEventListener('click', async () => {
  if (!confirm('Clear all pending captures? This cannot be undone. Capture and delivery will pause. A request already accepted by the server cannot be recalled.')) return;
  try {
    const result = await chrome.runtime.sendMessage({type: 'clearQueue'});
    if (result.error) throw new Error(result.error);
    status.textContent = 'Pending captures cleared. Capture and delivery paused.';
    await refresh(true);
  } catch (error) { status.textContent = error.message; }
});
refresh(true).catch(error => { status.textContent = error.message; });
