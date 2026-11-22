'use strict';
const C = window.InStrideCase, $ = id => document.getElementById(id);
const publicMedia = {approach:'media/approach.jpg', front:'media/front.jpg', reverse:'media/reverse.jpg', seen:'media/seen.jpg', stop:'media/stop.jpg', clip:'media/approach.mp4'};
let media = publicMedia, selected = 'approach', draft = [...C.area], picking = false, first;
const captions = {
  approach:'Frame 9. The robot has cleared the pillar and turns toward the bank of machines.',
  front:'Same stop, facing the drawer. All nine sampled sight lines hit the orange drawer first.',
  reverse:'Same stop, turned 180°. All nine sampled points on the drawer are outside the camera view.',
  clip:'31 robot observations played at three actions per second. The approach ends with an in-place turn and STOP.'
};
const refText = {source:'Source camera, frame 40. From left to right: lottery, USPS, FedEx and UPS.', match:'Reconstructed meshes rendered from the same camera as source frame 40.', late:'Source camera, frame 96. The lottery machine now occludes the FedEx slot.'};
function selectView(key) {
  selected = key;
  for (const b of document.querySelectorAll('[data-key]')) b.setAttribute('aria-pressed', String(b.dataset.key === key));
  const playing = key === 'clip', film = $('film');
  film.pause(); film.hidden = !playing; $('hero').hidden = playing; $('filmControls').hidden=!playing;
  if (playing) { film.src = media.clip; film.poster = media.approach;film.play().catch(()=>{}); }
  else { $('hero').src = media[key]; $('hero').alt = captions[key]; }
  $('caption').textContent = captions[key]; $('scores').replaceChildren();
  const scores = key === 'front' || key === 'reverse' ? ['H · In region','A · 0 to draft area', key === 'front' ? 'S · 9/9 target rays' : 'S · 0/9 target rays'] : ['31 observations','0 collision steps','Draft boundaries'];
  for (const text of scores) { const s = document.createElement('span'); s.textContent = text; if (text.includes('0/9')) s.className = 'no'; $('scores').append(s); }
  draw();
}
function selectRef(key) {
  for (const b of document.querySelectorAll('[data-ref]')) b.setAttribute('aria-pressed', String(b.dataset.ref === key));
  $('refImage').src = media[key]; $('refImage').alt = refText[key]; $('refLabel').textContent = refText[key];
}
$('chooseAirport').onclick=()=>$('localMedia').click();
const film=$('film');
function filmClock(t){return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function updateFilm(){const duration=Number.isFinite(film.duration)?film.duration:0;$('filmSeek').max=duration||1;$('filmSeek').value=film.currentTime;$('filmTime').textContent=filmClock(film.currentTime)+' / '+filmClock(duration);$('filmToggle').textContent=film.paused?'Play':'Pause';}
for(const event of ['loadedmetadata','timeupdate','pause','play','ended'])film.addEventListener(event,updateFilm);
$('filmToggle').onclick=()=>{if(film.paused)film.play().catch(()=>{$('caption').textContent='The video could not be played in this browser.';});else film.pause();updateFilm();};
$('filmSeek').oninput=()=>{if(Number.isFinite(film.duration))film.currentTime=Number($('filmSeek').value);};
function activateMedia(pack) {
  if (pack.schema !== 'instride-private-media-v1' || pack.scene !== 'airport-parcel' || !pack.content) throw Error('This file belongs to a different evidence pack.');
  for (const key of [...Object.keys(publicMedia), ...Object.keys(refText)]) {
    const val = pack.content[key], prefix = key === 'clip' ? 'data:video/mp4;base64,' : 'data:image/jpeg;base64,';
    if (typeof val !== 'string' || !val.startsWith(prefix) || val.length < 100) throw Error('The evidence pack has an invalid ' + key + ' asset.');
  }
  media = pack.content; $('mode').textContent = 'Local RGB'; $('seen').src = media.seen; $('stop').src = media.stop;
  $('reference').hidden = false; selectRef('source'); selectView(selected);
  $('mediaStatus').textContent = 'RGB and capture references are open on this device.';
}
$('localMedia').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 5*1024*1024) throw Error('Select the airport evidence JSON file (under 5 MB).');
    const bytes = await file.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== 'bdcca8abeab509b1b4f927417a9c81ceedd85a0b1c77e316891806d390e84379') throw Error('This file does not match the verified airport evidence pack.');
    activateMedia(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) { $('mediaStatus').textContent = error.message; }
  e.target.value = '';
});
const canvas = $('map'), ctx = canvas.getContext('2d'), bounds = [-3.9,-.45,3.15,5.55], padding = 14;
const scale = Math.min((canvas.width-2*padding)/(bounds[2]-bounds[0]),(canvas.height-2*padding)/(bounds[3]-bounds[1]));
const left = (canvas.width-(bounds[2]-bounds[0])*scale)/2, topEdge = (canvas.height-(bounds[3]-bounds[1])*scale)/2;
const screen = (x,y) => [left+(x-bounds[0])*scale,topEdge+(bounds[3]-y)*scale];
function rect(r, fill, stroke) {
  const [x,y] = screen(r[0],r[3]), w=(r[2]-r[0])*scale, h=(r[3]-r[1])*scale;
  ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle=stroke;ctx.lineWidth=1.4;ctx.strokeRect(x,y,w,h);
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.beginPath();ctx.rect(left,topEdge,(bounds[2]-bounds[0])*scale,(bounds[3]-bounds[1])*scale);ctx.clip();
  for (let x=-3;x<=3;x++) rect([x,bounds[1],x,bounds[3]],'#0000','#e0e5d9');
  for (let y=0;y<=5;y++) rect([bounds[0],y,bounds[2],y],'#0000','#e0e5d9');
  rect(C.zone,'#e0ecd9aa','#90b18d');
  for (const ob of C.obstacles) rect(ob.rect, '#a9b6aa','#839489');
  rect(C.area,'#76ba9e88','#216950'); if (draft.some((v,i)=>Math.abs(v-C.area[i])>.001)) rect(draft,'#f6b36a77','#ab5d23');
  ctx.lineJoin='round';ctx.strokeStyle='#1b7055';ctx.lineWidth=4;ctx.beginPath();C.poses.forEach(([x,y],i)=>{const p=screen(x,y);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.stroke();
  const [x,y]=screen(...C.stop);ctx.beginPath();ctx.arc(x,y,C.radius_u*scale,0,2*Math.PI);ctx.fillStyle='#45846449';ctx.fill();ctx.strokeStyle='#1e684e';ctx.lineWidth=2;ctx.stroke();
  const s=selected==='reverse'?1:-1;ctx.beginPath();ctx.moveTo(x,y+s*36);ctx.lineTo(x-6,y+s*21);ctx.lineTo(x+6,y+s*21);ctx.closePath();ctx.fillStyle='#15553e';ctx.fill();
  const a=screen(...C.path[0]);ctx.fillStyle='#1e684e';ctx.beginPath();ctx.arc(...a,5,0,Math.PI*2);ctx.fill();
  ctx.font='600 16px Segoe UI, sans-serif';ctx.fillStyle='#243d2d';for(const [x0,y0,t] of [[-3.15,5.22,'Lottery'],[-1.67,5.22,'USPS'],[-.85,5.22,'FedEx'],[.34,5.22,'UPS'],[1.14,.56,'Pillar'],[2.38,.13,'Start']])ctx.fillText(t,...screen(x0,y0));
  if(first){ctx.fillStyle='#ad571c';ctx.beginPath();ctx.arc(...screen(...first),5,0,Math.PI*2);ctx.fill();}ctx.restore();
}
const coords=['x0','y0','x1','y1'];
function fill() {coords.forEach((id,i)=>$(id).value=draft[i].toFixed(2));}
function readRect() {
  const r = coords.map(id=>$(id).valueAsNumber);
  if(!r.every(Number.isFinite)||r[0]<bounds[0]||r[1]<bounds[1]||r[2]>bounds[2]||r[3]>bounds[3]||r[2]-r[0]<.05||r[3]-r[1]<.05) { $('mapStatus').textContent = 'Enter a rectangle inside the map with min values below max values.'; return null; } return r;
}
function stopPick() { picking=false; first=null; $('pick').setAttribute('aria-pressed','false'); }
$('pick').onclick=()=>{picking=true;first=null;$('pick').setAttribute('aria-pressed','true');$('mapStatus').textContent='Select the first corner on the map.';draw();};
canvas.onclick=e=>{
  if(!picking)return;const box=canvas.getBoundingClientRect(), x=bounds[0]+((e.clientX-box.left)*canvas.width/box.width-left)/scale, y=bounds[3]-((e.clientY-box.top)*canvas.height/box.height-topEdge)/scale;
  if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]) return;
  if(!first){first=[x,y];$('mapStatus').textContent='Select the opposite corner.';draw();return;}
  const r=[Math.min(first[0],x),Math.min(first[1],y),Math.max(first[0],x),Math.max(first[1],y)].map(v=>Math.round(v*100)/100);
  if(r[2]-r[0]<.05||r[3]-r[1]<.05){$('mapStatus').textContent='Choose two distinct corners.';return;}
  draft=r;stopPick();fill();draw();$('mapStatus').textContent='Orange shows your proposed area. Collision and distance need rechecking.';
};
$('apply').onclick=()=>{const r=readRect();if(r){draft=r;stopPick();draw();$('mapStatus').textContent='Area preview updated. Target-ray results refer to the original stop.';}};
$('restore').onclick=()=>{draft=[...C.area];stopPick();fill();draw();$('mapStatus').textContent='Original candidate area restored.';};
$('save').onclick=()=>{
  const reviewer=$('who').value.trim(),decision=$('decision').value,notes=$('note').value.trim();
  if(!reviewer||decision==='pending'){ $('msg').textContent='Enter a reviewer alias and choose a decision.';return; }
  if(decision!=='accept'&&!notes){ $('msg').textContent='Add a note explaining the revision or missing evidence.';return; }
  const r=readRect();if(!r||picking){$('msg').textContent='Finish the rectangle or reset the area before export.';return;}
  draft=r;draw();const now=new Date();
  const record={schema:'instride-approach-review/1',scene_id:C.source_id,asset_sha256:C.source_version,instruction:C.instruction,target_part:'FedEx | hinged orange drawer',coordinate_system:'local XY in reconstruction units',initial_area:C.area,proposed_area:r,reviewer,decision,notes,reviewed_view:selected,media:media===publicMedia?'instance_geometry':'local_rgb',validation_status:'human_proposal_pending_validation',time_utc:now.toISOString()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='airport-fedex-review-'+now.toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);$('msg').textContent='Review exported. Share the JSON file with the review lead.';
};
for(const b of document.querySelectorAll('[data-key]')) b.onclick=()=>selectView(b.dataset.key);
for(const b of document.querySelectorAll('[data-ref]')) b.onclick=()=>selectRef(b.dataset.ref);
fill();selectView('approach');if(window.InStridePrivate)activateMedia(window.InStridePrivate);
