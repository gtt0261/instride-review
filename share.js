document.getElementById('copy').onclick = async () => {
  const target = new URL('./', location.href);
  const active = document.getElementById('case-select').value;
  if (active && active !== 'airport') target.searchParams.set('case', active);
  const url = target.href;
  const msg = document.getElementById('shareMsg');
  msg.hidden = false;
  try { await navigator.clipboard.writeText(url); msg.textContent = 'Review link copied.'; }
  catch { const a = document.createElement('a'); a.href = url; a.textContent = url; msg.replaceChildren('Copy this link: ', a); }
};
