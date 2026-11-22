(() => {
  const button = document.getElementById('copy');
  if (!button) return;
  button.addEventListener('click', async () => {
    const here = new URL(location.href);
    const base = 'https://gtt0261.github.io/instride-review/';
    const target = new URL(document.body.dataset.page === 'floor5' ? 'floor5/' : '', base);
    if (document.body.dataset.page === 'floor5' && /^(A|B)$/.test(here.searchParams.get('route'))) target.searchParams.set('route', here.searchParams.get('route'));
    const message = document.getElementById('shareMsg');
    message.hidden = false;
    try { await navigator.clipboard.writeText(target.href); message.textContent = 'Review link copied.'; }
    catch { message.textContent = 'Copy this link: '; const a = document.createElement('a'); a.href = target.href; a.textContent = target.href; message.append(a); }
  });
})();
