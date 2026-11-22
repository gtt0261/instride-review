const $ = id => document.getElementById(id);
async function json(name) {
  const response = await fetch('run/' + name + '.json');
  if (!response.ok) throw Error(response.statusText);
  return response.json();
}
async function ready() {
  const [route, audit] = await Promise.all([json('trajectory'), json('audit')]);
  const frames = route.frames, keys = audit.keys, film = $('film'), canvas = $('map'), ctx = canvas.getContext('2d');
  const closeBounds = [-4.15,-.9,3.35,5.90];
  const points = route.waypoints;
  const wideBounds = [Math.min(...points.map(p=>p[0]))-4,Math.min(...points.map(p=>p[1]))-2.6,
                      Math.max(...points.map(p=>p[0]))+3.7,Math.max(...points.map(p=>p[1]))+4.5];
  const titles = {clip:'Play the full route to follow the turns and final alignment.', start:'Departure from behind the baggage carousel.',
    turn:'The robot rounds the end of the carousel.', approach:'The parcel counter is ahead, beyond the column.',
    stop:'The robot has stopped facing the FedEx drop slot.',reverse:'Comparison at the same stop with the camera turned 180°. This view is outside the executed route.'};
  let selected = 'clip', current = 0, close = false, picking = false, first = null, area = route.area.slice();
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
    rect(route.area,'#82b9a2aa','#266248');
    if(area.some((v,i)=>v!==route.area[i]))rect(area,'#f4ad7788','#a85d2d');
    ctx.lineWidth=5;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle='#296c55';
    ctx.beginPath();points.forEach(([x,y],i)=>{const p=xy(x,y);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.stroke();
    function dot(x,y,r,c){ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);ctx.fill();}
    dot(...xy(...points[0]),7,'#296c55');dot(...xy(...route.stop),7,'#296c55');
    ctx.font='600 23px system-ui';ctx.fillStyle='#263e32';ctx.textAlign='center';
    const callouts=close?[[-2.56,5.12,'Lottery'],[-1.51,5.12,'USPS'],[-.44,5.12,'FedEx'],[.78,5.12,'UPS']]:
                         [[points[0][0],points[0][1]-.95,'Start'],[-18.9,-12.3,'Carousel'],[route.stop[0]-.1,5.55,'Parcel counter']];
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
  function mapDetail(zoom){close=zoom;$('close').setAttribute('aria-pressed',String(close));$('wide').setAttribute('aria-pressed',String(!close));draw();}
  function cancelPick(){picking=false;first=null;$('pick').setAttribute('aria-pressed','false');}
  $('wide').onclick=()=>{cancelPick();mapDetail(false);};$('close').onclick=()=>mapDetail(true);
  function select(key){
    selected=key;film.pause();
    document.querySelectorAll('[data-key]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.key===key)));
    const clip=key==='clip';film.hidden=!clip;$('hero').hidden=clip;
    if(clip)current=Math.min(frames.length-1,Math.round((film.currentTime||0)*route.fps));
    else {current=keys[key==='reverse'?'stop':key];$('hero').src='run/'+key+'.jpg';$('hero').alt=titles[key];}
    $('original').textContent=clip?'Open original video':'Open 4K image';
    $('original').href=clip?'run/expert.mp4':'run/'+key+'.jpg';
    $('caption').textContent=titles[key];$('mode').textContent=clip?'First-person RGB · 1080p':'Native RGB · 3840 × 2160';
    cancelPick();mapDetail(['stop','reverse','approach'].includes(key));update();
  }
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>select(b.dataset.key));
  for(const ev of ['timeupdate','seeked','ended'])film.addEventListener(ev,()=>{
    if(selected==='clip'){current=Math.min(frames.length-1,Math.round(film.currentTime*route.fps));update();}
  });
  film.addEventListener('error',()=>{$('caption').textContent='The video could not be played. Open the original video or inspect a 4K frame.';});
  function readArea(){
    const r=fields.map(id=>$(id).valueAsNumber);
    if(!r.every(Number.isFinite)||r[0]<closeBounds[0]||r[1]<closeBounds[1]||r[2]>closeBounds[2]||r[3]>closeBounds[3]||r[2]-r[0]<.05||r[3]-r[1]<.05){
      $('mapStatus').textContent='Choose a rectangle inside the stop map with min values below max values.';return null;
    }return r;
  }
  $('pick').onclick=()=>{if(picking){cancelPick();draw();return;}mapDetail(true);picking=true;first=null;$('pick').setAttribute('aria-pressed','true');$('mapStatus').textContent='Choose the first corner on the stop map.';};
  canvas.onclick=e=>{
    if(!picking)return;const {b,scale,left,top}=projection(),r=canvas.getBoundingClientRect();
    const x=b[0]+((e.clientX-r.left)*canvas.width/r.width-left)/scale,y=b[3]-((e.clientY-r.top)*canvas.height/r.height-top)/scale;
    if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return;
    if(!first){first=[x,y];$('mapStatus').textContent='Choose the opposite corner.';draw();return;}
    const rect=[Math.min(first[0],x),Math.min(first[1],y),Math.max(first[0],x),Math.max(first[1],y)].map(v=>+v.toFixed(2));
    if(rect[2]-rect[0]<.05||rect[3]-rect[1]<.05){$('mapStatus').textContent='Choose two distinct corners.';return;}
    area=rect;cancelPick();fill();draw();$('mapStatus').textContent='Proposed area updated.';
  };
  $('restore').onclick=()=>{area=route.area.slice();cancelPick();fill();mapDetail(true);$('mapStatus').textContent='Original draft area restored.';};
  $('apply').onclick=()=>{const r=readArea();if(r){area=r;cancelPick();mapDetail(true);$('mapStatus').textContent='Proposed area updated.';}};
  $('save').onclick=()=>{
    const reviewer=$('who').value.trim(),decision=$('decision').value,notes=$('note').value.trim(),r=readArea();
    if(!reviewer||decision==='pending'){ $('msg').textContent='Enter a reviewer alias and select a decision.';return; }
    if(decision!=='accept'&&!notes){$('msg').textContent='Add a note explaining the decision.';return;}
    if(!r||picking){$('msg').textContent='Complete the rectangle before exporting.';return;}
    const record={schema:'instride-airport-review/2',route_id:route.id,scene_sha256:route.scene_sha256,target_part:route.target_part,
      instruction:route.instruction,initial_area:route.area,proposed_area:r,coordinates:'Blender XY, scene units',
      reviewer,decision,notes,view:selected,frame:current,time_utc:new Date().toISOString()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='airport-stop-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
    $('msg').textContent='Review exported.';
  };
  if('memory' in keys){
    $('memory').hidden=false;
    $('earlier').textContent='Frame '+keys.memory+' · '+audit.visibility[keys.memory][1]+'/9 sight lines reach the lottery machine.';
    $('later').textContent='Frame '+keys.stop+' · '+audit.lottery_at_stop+'/9 sight lines reach it at the final stop.';
  }
  $('checks').textContent=route.states.length+' executed actions, '+frames.length+' camera frames and '+route.clearance_collision_events+' collisions. '
    +audit.floor_hits+' of '+audit.floor_probes+' floor probes found support. The cylinder also stopped on a separate test motion into the cabinet.';
  $('renderInfo').textContent='The route covers '+route.length_u.toFixed(2)+' scene units (estimated '+route.length_m_range.map(n=>n.toFixed(1)).join('–')+
    ' m). At the final stop, '+audit.target_at_stop+'/9 sight lines hit the orange drawer. Turning 180° at the same spot gives '+audit.target_reversed+
    '/9. Native rendering used '+audit.device+' with Blender Cycles '+audit.backend+'.';
  fill();select('clip');
}
ready().catch(()=>{$('mapStatus').textContent='Route data could not be loaded. Refresh the page to retry.';});
