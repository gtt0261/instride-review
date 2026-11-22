'use strict';
const originals = new Map();
function originalAsset(path) {
  if (document.documentElement.dataset.bundled === 'true' && Object.hasOwn(window.REVIEW_PACK.files,path)) return path;
  return originals.get(path) || '';
}
async function readLocalFolder(files) {
  const pending = new Map(), known = window.REVIEW_PACK.files;
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    const name = 'media/' + parts.slice(-2).join('/');
    if (!Object.hasOwn(known,name)) continue;
    if (pending.has(name) || file.size > 96*1024*1024) throw Error('Duplicate or oversized file: '+name);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if (hash !== known[name]) throw Error('File does not match the route evidence: '+name);
    pending.set(name,file);
  }
  if (!pending.size) throw Error('Select the media folder containing route A or B.');
  const old = [...originals.values()]; originals.clear();
  for (const [name,file] of pending) originals.set(name,URL.createObjectURL(file));
  for (const url of old) URL.revokeObjectURL(url);
  return pending.size;
}
function publicPlot(canvas, r, frame) {
  const ctx=canvas.getContext('2d'), w=canvas.width,h=canvas.height, f=r.frames;
  ctx.fillStyle='#edf2e9';ctx.fillRect(0,0,w,h);
  const xs=f.map(v=>v.x),ys=f.map(v=>v.y),xmin=Math.min(...xs),ymin=Math.min(...ys),xmax=Math.max(...xs),ymax=Math.max(...ys);
  const k=Math.min((w-105)/(xmax-xmin||1),(h-78)/(ymax-ymin||1)),cx=w/2,cy=h/2;
  const xy=(x,y)=>[cx+(x-(xmin+xmax)/2)*k,cy-(y-(ymin+ymax)/2)*k];
  ctx.lineWidth=1;ctx.strokeStyle='#d7e2d4';ctx.beginPath();
  for(let x=Math.floor(xmin/10)*10-100;x<xmax+100;x+=10){const [px]=xy(x,0);ctx.moveTo(px,0);ctx.lineTo(px,h);}
  for(let y=Math.floor(ymin/10)*10-100;y<ymax+100;y+=10){const py=xy(0,y)[1];ctx.moveTo(0,py);ctx.lineTo(w,py);}ctx.stroke();
  function path(end,color,width){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';f.slice(0,end+1).forEach((v,i)=>{const p=xy(v.x,v.y);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.stroke();}
  path(f.length-1,'#9eb6a4',3);path(frame,'#21684d',5);
  const a=xy(f[0].x,f[0].y),b=xy(f.at(-1).x,f.at(-1).y),p=xy(f[frame].x,f[frame].y);
  ctx.font='600 17px Segoe UI, sans-serif';ctx.fillStyle='#375043';ctx.fillText('Start',a[0]+9,a[1]-10);ctx.fillText('STOP',b[0]+9,b[1]-10);
  for(const [point,color] of [[a,'#438e64'],[b,'#b16a37']]){ctx.fillStyle=color;ctx.beginPath();ctx.arc(...point,5,0,2*Math.PI);ctx.fill();}
  ctx.save();ctx.translate(...p);ctx.rotate(-f[frame].yaw);ctx.fillStyle='#123f32';ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(-8,-8);ctx.lineTo(-4,0);ctx.lineTo(-8,8);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.strokeStyle='#405b49';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,h-15);ctx.lineTo(15+10*k,h-15);ctx.stroke();ctx.font='15px Segoe UI, sans-serif';ctx.fillStyle='#395643';ctx.fillText('10 m',15,h-21);
}
