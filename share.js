document.getElementById('copy').onclick = async () => {
  const url = new URL('./', location.href).href;
  const msg = document.getElementById('shareMsg');
  msg.hidden = false;
  try { await navigator.clipboard.writeText(url); msg.textContent = 'Review link copied.'; }
  catch { const a = document.createElement('a'); a.href = url; a.textContent = url; msg.replaceChildren('Copy this link: ', a); }
};
