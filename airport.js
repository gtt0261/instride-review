const $ = id => document.getElementById(id);
async function json(name) {
  const response = await fetch(name);
  if (!response.ok) throw Error(response.statusText);
  return response.json();
}
async function ready() {
  const catalog = await json('evaluation-candidates.json');
  const requested = new URLSearchParams(location.search).get('case');
  const entry = catalog.cases.find(c => c.id === requested) ?? catalog.cases[0];
  const choose = $('case-select');
  choose.replaceChildren(...catalog.cases.map(c => new Option(c.title + ' · ≤' + c.length_m_range[1].toFixed(1) + ' m', c.id)));
  choose.value = entry.id;
  choose.onchange = () => {
    const url = new URL('./', location.href);
    if (choose.value !== 'airport') url.searchParams.set('case', choose.value);
    location.href = url.href;
  };
  const media = entry.assets;
  const [route, audit, receipt] = await Promise.all([json(media+'trajectory.json'), json(media+'audit.json'),json(media+'run.json')]);
  const frames = route.frames, keys = audit.keys, film = $('film'), canvas = $('map'), ctx = canvas.getContext('2d');
  const airport = entry.id === 'airport';
  const hazards = route.hazards ?? [];
  const expanded = rect => [rect[0]-1.15/route.scale_m_per_u[0],rect[1]-1.15/route.scale_m_per_u[0],
                            rect[2]+1.15/route.scale_m_per_u[0],rect[3]+1.15/route.scale_m_per_u[0]];
  const closeBounds = airport ? [-4.15,-.9,3.35,5.90] : expanded(route.zone);
  const points = route.waypoints;
  const wideBounds = [Math.min(...points.map(p=>p[0]))-4,Math.min(...points.map(p=>p[1]))-2.6,
                      Math.max(...points.map(p=>p[0]))+3.7,Math.max(...points.map(p=>p[1]))+4.5];
  const titles = {clip:'Play the route to follow the robot to the target.', start:'Robot view at departure.',
    turn:'View at the start of the first turn.', approach:'View during the approach to the target.',
    stop:'Final robot view facing '+entry.target_label+'.',reverse:'Comparison at the same position with the camera turned 180°.'};
  let selected = 'clip', current = 0, close = false, picking = null, first = null, area = route.area.slice();
  let proposedBlocks = [];
  $('case-status').textContent=entry.title+' · Human review pending';
  document.querySelector('h1').textContent=entry.instruction;
  document.title=entry.title+' · InStride Review';
  $('case-summary').textContent=entry.region_name+' · '+entry.length_m_range.map(n=>n.toFixed(1)).join('–')+' m estimated · 40 m route cap';
  $('target-label').textContent=entry.target_label;
  $('target-side').textContent=entry.operative_surface;
  $('stop-note').textContent=entry.stop_note;
  const scores=entry.geometric_checks;
  $('draft-score').textContent='Region entered · '+scores.approach_distance_m.toFixed(1)+' m to the draft approach area · '
    +scores.distance_to_part_upper_m.toFixed(2)+' m to the part at the upper scale estimate · '+audit.target_at_stop+'/9 clear sight lines';
  film.poster=media+'start.jpg';
  film.src=media+'expert.mp4';
  film.setAttribute('aria-label','First-person robot route in '+entry.title);
  $('poses-link').href=media+'trajectory.json';
  $('audit-link').href=media+'audit.json';
  $('receipt-link').href=media+'run.json';
  const fields=['x0','y0','x1','y1'];
  const fill=()=>fields.forEach((id,i)=>$(id).value=area[i].toFixed(2));
  function projection() {
    const b=close?closeBounds:wideBounds;
    const w=canvas.width,h=canvas.height,pad=28;
    const scale=Math.min((w-2*pad)/(b[2]-b[0]),(h-2*pad)/(b[3]-b[1]));
    const left=(w-scale*(b[2]-b[0]))/2, top=(h-scale*(b[3]-b[1]))/2;
    return {b,scale,left,top,xy:(x,y)=>[left+(x-b[0])*scale,top+(b[3]-y)*scale]};
  }
  function draw() {
    const {b,scale,left,top,xy}=projection();
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.beginPath();
    ctx.rect(left,top,(b[2]-b[0])*scale,(b[3]-b[1])*scale);ctx.clip();
    function rect(r,fill,stroke) {
      if(r[0]>b[2]||r[2]<b[0]||r[1]>b[3]||r[3]<b[1])return;
      const [x,y]=xy(r[0],r[3]),w=(r[2]-r[0])*scale,h=(r[3]-r[1])*scale;
      ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle=stroke;ctx.lineWidth=1.3;ctx.strokeRect(x,y,w,h);
    }
    const gap=close?1:4;
    for(let v=Math.ceil(b[0]/gap)*gap;v<b[2];v+=gap)rect([v,b[1],v,b[3]],'transparent','#d5dfd4');
    for(let v=Math.ceil(b[1]/gap)*gap;v<b[3];v+=gap)rect([b[0],v,b[2],v],'transparent','#d5dfd4');
    rect(route.zone,'#dcead3','#8ba682');
    for(const solid of route.map_solids) rect(solid.rect,'#b1bbb0','#929e94');
    for (const h of hazards) rect(h.rect,'#dc8f7877','#a24738');
    for (const r of proposedBlocks) rect(r,'#cf6e547f','#a42d21');
    rect(route.area,'#82b9a2aa','#266248');
    if(area.some((v,i)=>v!==route.area[i]))rect(area,'#f4ad7788','#a85d2d');
    ctx.lineWidth=5;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle='#296c55';
    ctx.beginPath();points.forEach(([x,y],i)=>{const p=xy(x,y);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.stroke();
    function dot(x,y,r,c){ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);ctx.fill();}
    dot(...xy(...points[0]),7,'#296c55');dot(...xy(...route.stop),7,'#296c55');
    ctx.font='600 23px system-ui';ctx.fillStyle='#263e32';ctx.textAlign='center';
    const callouts=airport&&close?[[-2.56,5.12,'Lottery'],[-1.51,5.12,'USPS'],[-.44,5.12,'FedEx'],[.78,5.12,'UPS']]:
      [[points[0][0],points[0][1]-.55,'Start'],[route.target[0],route.target[1]+.42,'Target']];
    for(const [x,y,label] of callouts){ctx.fillStyle='#263e32';ctx.fillText(label,...xy(x,y));}
    const f=frames[current],p=xy(f[1],f[2]);
    ctx.save();ctx.translate(...p);ctx.rotate(-(f[3]+(selected==='reverse'?180:0))*Math.PI/180);
    ctx.beginPath();ctx.moveTo(17,0);ctx.lineTo(-10,-9);ctx.lineTo(-6,0);ctx.lineTo(-10,9);ctx.closePath();
    ctx.fillStyle='#cd651f';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.fill();ctx.stroke();ctx.restore();
    if(first)dot(...xy(...first),7,'#a25420');ctx.restore();
  }
  function update() {
    $('clock').textContent='Frame '+current+' / '+(frames.length-1)+' · '+(current/route.fps).toFixed(1)+' s';
    draw();
  }
  const frameAt = seconds => Math.min(frames.length-1,Math.max(0,Math.floor(seconds*route.fps+0.0001)));
  function mapDetail(zoom){close=zoom;$('close').setAttribute('aria-pressed',String(close));$('wide').setAttribute('aria-pressed',String(!close));draw();}
  function cancelPick(){picking=null;first=null;for(const id of ['pick','block'])$(id).setAttribute('aria-pressed','false');}
  $('wide').onclick=()=>{cancelPick();mapDetail(false);};$('close').onclick=()=>{cancelPick();mapDetail(true);};
  function select(key){
    selected=key;film.pause();
    document.querySelectorAll('[data-key]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.key===key)));
    const clip=key==='clip';film.hidden=!clip;$('hero').hidden=clip;
    if(clip)current=frameAt(film.currentTime||0);
    else {current=keys[key==='reverse'?'stop':key];$('hero').src=media+key+'.jpg';$('hero').alt=titles[key];}
    $('original').textContent=clip?'Open original video':'Open 4K image';
    $('original').href=clip?media+'expert.mp4':media+key+'.jpg';
    $('caption').textContent=titles[key];$('mode').textContent=clip?'First-person RGB · 1080p':'Native RGB · 3840 × 2160';
    cancelPick();mapDetail(['stop','reverse','approach'].includes(key));update();
  }
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>select(b.dataset.key));
  for(const ev of ['timeupdate','seeked','ended'])film.addEventListener(ev,()=>{
    if(selected==='clip'){current=frameAt(film.currentTime);update();}
  });
  film.addEventListener('error',()=>{$('caption').textContent='The video could not be played. Open the original video or inspect a 4K frame.';});
  function readArea(){
    const r=fields.map(id=>$(id).valueAsNumber);
    if(!r.every(Number.isFinite)||r[0]<closeBounds[0]||r[1]<closeBounds[1]||r[2]>closeBounds[2]||r[3]>closeBounds[3]||r[2]-r[0]<.05||r[3]-r[1]<.05){
      $('mapStatus').textContent='Choose a rectangle inside the stop map with min values below max values.';return null;
    }return r;
  }
  for(const id of ['pick','block']) $(id).onclick=()=>{
    const old=picking;
    cancelPick();
    if(old===id){draw();return;}
    mapDetail(id==='pick');
    picking=id;$(id).setAttribute('aria-pressed','true');
    $('mapStatus').textContent='Choose the first corner on the map.';
  };
  canvas.onclick=e=>{
    if(!picking)return;const {b,scale,left,top}=projection(),r=canvas.getBoundingClientRect();
    const x=b[0]+((e.clientX-r.left)*canvas.width/r.width-left)/scale,y=b[3]-((e.clientY-r.top)*canvas.height/r.height-top)/scale;
    if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return;
    if(!first){first=[x,y];$('mapStatus').textContent='Choose the opposite corner.';draw();return;}
    const rect=[Math.min(first[0],x),Math.min(first[1],y),Math.max(first[0],x),Math.max(first[1],y)].map(v=>+v.toFixed(2));
    if(rect[2]-rect[0]<.05||rect[3]-rect[1]<.05){$('mapStatus').textContent='Choose two distinct corners.';return;}
    if(picking==='block'){proposedBlocks.push(rect);$('mapStatus').textContent='No-stop zone marked.';}
    else {area=rect;fill();$('mapStatus').textContent='Proposed approach area updated.';}
    cancelPick();draw();
  };
  $('restore').onclick=()=>{area=route.area.slice();proposedBlocks=[];cancelPick();fill();mapDetail(true);$('mapStatus').textContent='Original draft restored.';};
  $('apply').onclick=()=>{const r=readArea();if(r){area=r;cancelPick();mapDetail(true);$('mapStatus').textContent='Proposed area updated.';}};
  $('save').onclick=()=>{
    const reviewer=$('who').value.trim(),decision=$('decision').value,notes=$('note').value.trim(),r=readArea();
    if(!reviewer||decision==='pending'){ $('msg').textContent='Enter a reviewer alias and select a decision.';return; }
    if(decision!=='accept'&&!notes){$('msg').textContent='Add a note explaining the decision.';return;}
    if(!r||picking){$('msg').textContent='Complete the rectangle before exporting.';return;}
    const confirmed={target:$('verify-target').checked,approach:$('verify-area').checked,facing:$('verify-face').checked};
    const overlaps=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
    if(decision==='accept'&&(!Object.values(confirmed).every(Boolean)||[...hazards.map(h=>h.rect),...proposedBlocks].some(b=>overlaps(r,b)))){
      $('msg').textContent='Confirm all three checks and keep the approach area clear of no-stop zones before accepting.';return;
    }
    const [sx,sy]=route.stop;
    if(decision==='accept'&&(sx<r[0]||sy<r[1]||sx>r[2]||sy>r[3])){
      $('msg').textContent='The recorded stop is outside your approach area. Export a revision to propose the new area.';return;
    }
    const record={schema:'instride-short-route-review/1',route_id:route.id,case_id:entry.id,scene_sha256:route.scene_sha256,target_part:route.target_part,
      instruction:route.instruction,initial_area:route.area,proposed_area:r,coordinates:'Blender XY, scene units',
      existing_no_stop_zones:hazards,proposed_no_stop_zones:proposedBlocks,confirmed,
      reviewer,decision,notes,view:selected,frame:current,time_utc:new Date().toISOString()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=entry.id+'-stop-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
    $('msg').textContent='Review exported.';
  };
  if('memory' in keys){
    $('memory').hidden=false;
    $('earlier').textContent='Frame '+keys.memory+' · '+audit.visibility[keys.memory][1]+'/9 sight lines reach the lottery machine.';
    $('later').textContent='Frame '+keys.stop+' · '+audit.lottery_at_stop+'/9 sight lines reach it at the final stop.';
  }
  $('checks').textContent=route.states.length+' executed actions, '+frames.length+' camera frames and '+route.clearance_collision_events+' collisions. '
    +audit.floor_hits+' of '+audit.floor_probes+' floor probes found support. A separate forward test into the target barrier was blocked.';
  $('renderInfo').textContent='The route covers '+route.length_u.toFixed(2)+' scene units (estimated '+route.length_m_range.map(n=>n.toFixed(1)).join('–')+
    ' m). At the final stop, '+audit.target_at_stop+'/9 sight lines hit the intended part. Turning 180° at the same spot gives '+audit.target_reversed+
    '/9. Native rendering used '+audit.device+' with Blender Cycles '+audit.backend+'.';
  $('render-source').textContent=(route.scale_basis || 'Airport scale estimated from the reconstruction.')+' '
    +(receipt.render_source || 'Fine signage inherits the resolution of the original capture.');
  fill();select('clip');
}
ready().catch(()=>{$('mapStatus').textContent='Route data could not be loaded. Refresh the page to retry.';});
