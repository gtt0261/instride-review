"use strict";
const pack = window.REVIEW_PACK;
const $ = id => document.getElementById(id);
const routes = new Map(pack.routes.map(r => [r.id,r]));
const prefix = "floor5-review.v1." + pack.batch + ".";
const schema = "expert-route-human-review/1";
const labels = {pass:"Pass",fail:"Fail",unknown:"Unsure"};
const resultNames = {pass:"Accepted",fail:"Needs revision",unknown:"Needs evidence"};
const navChecks = [
  ["path","The path was traversable"],["region","The robot entered the requested region"],["target","The robot reached the requested object"],
  ["parking","The full base stopped in an allowed area"],["facing","The final pose faced the operating side"]
];
const memoryChecks = [["fact","The visual evidence supports the reference answer"]];
const checksFor = scope => scope==="route" ? navChecks : memoryChecks;
const records = new Map();
const volatile = new Map();
let reviewer="", route=pack.routes[0], tab="play", scope="route", qa=route.qa[0];
let frame=0, viewIndex=-1, witnessIndex=0, depthMode=false, annotated=false, pendingSeek=null, raf=0, toastTimer;
let form, durable=true, previewMark=null;
let mapClock=0, publicInspect='trajectory';

function node(tag, text, cls) {
  const el=document.createElement(tag);
  if (text!==undefined) el.textContent=text;
  if (cls) el.className=cls;
  return el;
}
function button(text, click, cls) {
  const el=node("button",text,cls);
  el.type="button"; el.addEventListener("click",click); return el;
}
function storageError() {
  durable=false;
  $("storageWarning").hidden=false;
  $("storageWarning").textContent="Device storage is unavailable. Export your saved reviews before closing this page.";
}
function get(key) {
  if (volatile.has(key)) return volatile.get(key);
  try { return localStorage.getItem(prefix+key); } catch { storageError(); return null; }
}
function put(key,val) {
  volatile.set(key,val);
  try { localStorage.setItem(prefix+key,val); } catch { storageError(); }
}
function toast(text) {
  clearTimeout(toastTimer); $("toast").hidden=false; $("toast").textContent=text;
  toastTimer=setTimeout(()=>{$("toast").hidden=true;},4700);
}
function seconds(time) {
  return Math.floor(time/60)+":"+String(Math.floor(time%60)).padStart(2,"0");
}
function id() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join("");
}
function cleanName(s) { return String(s||"").normalize("NFKC").trim(); }
function allHeads(list) {
  const parents=new Set(list.flatMap(r=>r.parents));
  return list.filter(r=>!parents.has(r.id));
}
function entries(r, s, who) {
  return [...records.values()].filter(v=>v.route===r.id && (s===undefined || v.scope===s) && (who===undefined || v.reviewer===who));
}
function outcome(v) {
  const states=Object.values(v.checks);
  return states.includes("fail") ? "fail" : states.includes("unknown") ? "unknown" : "pass";
}
function disagreement(heads) {
  if (heads.length<2) return false;
  return new Set(heads.map(h=>h.reviewer)).size<heads.length ||
         checksFor(heads[0].scope).some(([k])=>new Set(heads.map(h=>h.checks[k])).size>1);
}
function hasDispute(r) {
  return ["route",...r.qa.map(q=>q.id)].some(s=>disagreement(allHeads(entries(r,s))));
}
const markNames={issue:"Issue",stand:"Standing position",face:"Operating face"};
function evidence(r,i,view,mark) {
  const f=r.frames[i], v=r.views.find(a=>a.frame===i);
  if (!Number.isInteger(i)||!f) throw Error("Frame index out of range");
  if (view==='trajectory' && mark===undefined) return {view,frame:i,sim_s:f.s,relative_xy_m:[f.x,f.y],yaw_rad:f.yaw,route_sha256:r.source};
  if (view==='depth_plot' && v?.plot && mark===undefined) return {view,frame:i,sim_s:f.s,asset:v.plot,asset_sha256:pack.publicFiles[v.plot]};
  let asset;
  if (view==="pov") asset="camera.mp4";
  if ((view==="stop"||view==="target") && i===r.frames.length-1) asset=i+".png";
  if (view==="witness" && r.qa.some(q=>q.frames.includes(i))) asset=i+".png";
  if (view==="rgb" && v) asset=v.rgb;
  if (view==="depth" && v) asset=v.depth;
  if (view==="footprint" && v?.footprint) asset=v.rgb;
  if (!asset || !pack.files[r.base+asset]) throw Error("Evidence does not match the route");
  const result={frame:i,sim_s:f.s,view,rgb_sha256:f.sha,asset:r.base+asset,asset_sha256:pack.files[r.base+asset]};
  if(mark!==undefined){
    if(!mark||!Object.hasOwn(markNames,mark.kind)||["pov","witness"].includes(view)||
       !Number.isInteger(mark.u)||mark.u<0||mark.u>=640||!Number.isInteger(mark.v)||mark.v<0||mark.v>=480)throw Error("Marker is outside the original image");
    result.mark={kind:mark.kind,u:mark.u,v:mark.v};
  }
  return result;
}
function activeEvidence() {
  if (tab==="play") return evidence(route,frame,$('movie').hidden?'trajectory':'pov');
  if (tab==="memory") return evidence(route,qa.frames[witnessIndex],$('questionImage').hidden?'trajectory':'witness');
  if (publicInspect) return evidence(route,viewIndex<0?route.frames.length-1:route.views[viewIndex].frame,publicInspect);
  if (viewIndex<0) return evidence(route,route.frames.length-1,annotated?"target":"stop");
  return evidence(route,route.views[viewIndex].frame,depthMode?"depth":annotated?"footprint":"rgb");
}
const viewNames={trajectory:'Recorded pose',depth_plot:'Derived depth',pov:"Replay",stop:"Stop RGB",target:"Target marker",rgb:"RGB",depth:"Depth",footprint:"Base projection",witness:"Question RGB"};
const draftKey=()=> "draft."+JSON.stringify([route.id,scope,reviewer]);
function blank() { return {checks:{},note:"",evidence:[],parents:[]}; }
function loadForm() {
  let draft=null;
  try { const raw=get(draftKey()); if (raw) draft=JSON.parse(raw); } catch { /* An exported submission can still be restored. */ }
  const heads=allHeads(entries(route,scope,reviewer));
  if (draft) form=draft;
  else if (heads.length===1) {
    const h=heads[0]; form={checks:{...h.checks},note:h.note,evidence:[...h.evidence],parents:[h.id]};
  } else { form=blank(); form.parents=heads.map(h=>h.id); }
  $("formMessage").textContent=""; drawForm();
}
function formBadge(){
  const heads=allHeads(entries(route,scope,reviewer));
  const same=heads.length===1 && canonical([heads[0].checks,heads[0].evidence,heads[0].note])===canonical([form.checks,form.evidence,form.note]);
  $("formStatus").textContent=same?"Saved":Object.keys(form.checks).length||form.evidence.length||form.note?"Draft":"Open";
}
function saveDraft() { put(draftKey(),JSON.stringify(form));formBadge(); }
function setReviewer() {
  const next=cleanName($("reviewer").value);
  if (next===reviewer) return;
  const unnamed=!reviewer && form && (form.note||form.evidence.length||Object.keys(form.checks).length);
  const carry=unnamed?form:null;
  reviewer=next; $("reviewer").value=reviewer; put("reviewer",reviewer);
  if (carry && !get(draftKey()) && !entries(route,scope,reviewer).length) saveDraft();
  loadForm(); drawQueue();
}
function drawQueue() {
  const list=$("routeList"); list.replaceChildren();
  const mine=pack.routes.filter(r=>reviewer && entries(r,"route",reviewer).length).length;
  $("progressCount").textContent=mine+" / "+pack.routes.length;
  $("progress").max=pack.routes.length; $("progress").value=mine;
  pack.routes.forEach(r=>{
    const reviewed=reviewer && entries(r,"route",reviewer).length>0;
    const mode=$("filter").value;
    if ((mode==="todo" && reviewed)||(mode==="conflict" && !hasDispute(r))) return;
    const b=button("",()=>selectRoute(r),"route-card"+(route.id===r.id?" active":""));
    b.setAttribute("aria-current",String(route.id===r.id));
    const img=node("img"); img.src=originalAsset(r.base+'start.jpg') || 'plots/'+r.code+'-route.png'; img.alt="";
    const line=node("span"); line.append(node("strong",r.name),node("small",r.distance.toFixed(2)+" m · "+(reviewed?"Saved":"Open")));
    b.append(img,line); list.append(b);
  });
  if (!list.childElementCount) list.append(node("p","No routes match this filter.","muted"));
}
function drawForm() {
  const memory=scope!=="route";
  const heads=allHeads(entries(route,scope,reviewer));
  $("formName").textContent=memory?"Memory review":"Human review";
  formBadge();
  $("rebase").hidden=!heads.length||canonical([...form.parents].sort())===canonical(heads.map(h=>h.id).sort());
  $("formHint").textContent=memory?(route.qa.find(q=>q.id===scope)?.text||""):
    "Assess each item. Choose Unsure if the evidence is insufficient.";
  const holder=$("checks"); holder.replaceChildren();
  for (const [key,title] of checksFor(scope)) {
    const field=node("fieldset",undefined,"criterion"); field.append(node("legend",title));
    const row=node("div",undefined,"choices");
    for (const [val,label] of Object.entries(labels)) {
      const b=button(label,()=>{
        form.checks[key]=val; saveDraft();
        for (const child of row.children) child.setAttribute("aria-pressed",String(child.dataset.val===val));
        $("formMessage").textContent="";
      });
      b.dataset.val=val; b.setAttribute("aria-pressed",String(form.checks[key]===val)); row.append(b);
    }
    field.append(row);holder.append(field);
  }
  $("note").value=form.note||""; drawPins();
}
function drawPins() {
  const ul=$("pins");ul.replaceChildren();
  if (!form.evidence.length) ul.append(node("li","Pin a frame that supports your judgment.","empty"));
  form.evidence.forEach((e,i)=>{
    const li=node("li","#"+e.frame+" · "+(e.mark?markNames[e.mark.kind]+" ("+e.mark.u+", "+e.mark.v+")":viewNames[e.view])+" ");
    const remove=button("×",()=>{form.evidence.splice(i,1);saveDraft();drawPins();if(tab==="stop")drawInspect();});
    remove.setAttribute("aria-label","Remove pinned frame "+e.frame+" reference");li.append(remove);ul.append(li);
  });
}
function switchScope(s) {
  if (s!==scope) { scope=s; loadForm(); }
}
function showTab(name, keepQuestion=false) {
  tab=name;
  if (name!=="play") { $("movie").pause(); stopMapPlayback(); }
  if (!keepQuestion) switchScope(name==="memory"?qa.id:"route");
  for (const b of document.querySelectorAll("[data-tab]")) {
    const on=b.dataset.tab===name;b.classList.toggle("selected",on);b.setAttribute("aria-pressed",String(on));
  }
  for (const n of ["play","stop","memory"]) $(n+"Panel").hidden=n!==name;
  if(name==="stop") drawInspect();
  if(name==="memory") drawQuestion();
  if(name==="play") drawMap();
}
function selectRoute(r) {
  stopMapPlayback();
  $("movie").pause();route=r;qa=r.qa[0];scope="route";frame=0;viewIndex=-1;depthMode=false;annotated=false;witnessIndex=0;pendingSeek=0;resetMark();
  $("context").textContent=r.scene+"  /  "+r.name;
  $("instruction").textContent=r.instruction;
  $("facts").textContent=r.distance.toFixed(2)+" m traveled   ·   "+r.frames.length+" original camera frames   ·   "+seconds(r.duration);
  $("sourceInfo").textContent="Region label: "+r.region+". The region boundary and operating-face normal still require validation. Logged collision frames:  "+r.collisions+" · Distance from the stop camera to the annotated point on the casing: "+r.endDistance.toFixed(2)+" m.";
  const src=originalAsset(r.base+'camera.mp4'),video=$('movie'); $('scrub').max=r.frames.length-1;
  if(src){video.src=src;const poster=originalAsset(r.base+'start.jpg');if(poster)video.poster=poster;else video.removeAttribute('poster');}else{video.removeAttribute('src');video.removeAttribute('poster');}
  video.hidden=!src;$('publicMap').hidden=Boolean(src);video.load();video.playbackRate=Number($('speed').value);
  if(location.protocol.startsWith('http')){const url=new URL(location.href);url.searchParams.set('route',r.code);history.replaceState(null,'',url);}
  const sel=$("viewSelect");sel.replaceChildren(new Option("Final stop",-1));
  r.views.forEach((v,i)=>sel.add(new Option(v.label+" · "+seconds(r.frames[v.frame].s)+" · #"+v.frame,String(i))));
  const qs=$("question");qs.replaceChildren();r.qa.forEach(q=>qs.add(new Option(q.kind+" · "+q.text,q.id)));
  $("answerDetails").open=false; $("stopPanel").querySelectorAll("details").forEach(el=>el.open=false);
  showTab("play");loadForm();drawQueue();drawFrame();
}
function seek(i) {
  stopMapPlayback();
  i=Math.max(0,Math.min(route.frames.length-1,Math.round(i)));
  frame=i;pendingSeek=i;const video=$("movie");video.pause();
  if (!video.hidden && video.readyState>=1) {
    video.currentTime=Math.min((route.frames[i].tick+.25)/24,Math.max(0,video.duration-.001));
    pendingSeek=null;
  }
  drawFrame();
}
function syncPosition() {
  const video=$("movie");
  if (video.hidden||tab!=="play"||video.seeking||pendingSeek!==null) return;
  const tick=Math.floor(video.currentTime*24+.00001);
  let lo=0,hi=route.frames.length;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(route.frames[mid].tick<=tick) lo=mid;else hi=mid;}
  if (lo!==frame) {frame=lo;drawFrame();}
}
function drawFrame() {
  if(!$('publicMap').hidden)publicPlot($('publicMap'),route,frame);
  $("scrub").value=frame;
  $("frameTag").textContent="Frame "+frame+" / "+(route.frames.length-1);
  $("clock").textContent=seconds(route.frames[frame].s)+" / "+seconds(route.duration);
  const f=route.frames[frame];
  $("pose").textContent="X "+f.x.toFixed(1)+"  Y "+f.y.toFixed(1)+" m  ·  "+Math.round((f.yaw*180/Math.PI+360)%360)+"°";
  drawMap();
}
function drawMap() {
  const cv=$("routeMap"), box=cv.getBoundingClientRect(); if (!box.width) return;
  const dpr=Math.min(devicePixelRatio||1,2);cv.width=Math.round(box.width*dpr);cv.height=Math.round(box.height*dpr);
  const ctx=cv.getContext("2d");ctx.scale(dpr,dpr);
  const w=box.width,h=box.height, f=route.frames, mx=f.map(a=>a.x),my=f.map(a=>a.y);
  const minX=Math.min(...mx),maxX=Math.max(...mx),minY=Math.min(...my),maxY=Math.max(...my);
  const s=Math.min((w-20)/(maxX-minX||1),(h-18)/(maxY-minY||1));
  const xy=f.map(p=>[(p.x-(minX+maxX)/2)*s+w/2,h/2-(p.y-(minY+maxY)/2)*s]);
  function stroke(end,color,width) {
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(...xy[0]);
    for(let i=1;i<=end;i++)ctx.lineTo(...xy[i]);ctx.stroke();
  }
  stroke(f.length-1,"#b7c8be",2.2);stroke(frame,"#247453",3);
  ctx.fillStyle="#98682a";ctx.beginPath();ctx.arc(...xy.at(-1),3.5,0,2*Math.PI);ctx.fill();
  ctx.save();ctx.translate(...xy[frame]);ctx.rotate(-f[frame].yaw);ctx.fillStyle="#153e38";ctx.strokeStyle="white";ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,-5);ctx.lineTo(-2,0);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function drawInspect() {
  const isStop=viewIndex<0, v=isStop?null:route.views[viewIndex],i=isStop?route.frames.length-1:v.frame;
  const rgb=originalAsset(route.base+(isStop?i+'.png':v.rgb)),depth=v && originalAsset(route.base+v.depth);
  if (!rgb && depth) depthMode=true;
  const src=(depthMode?depth:rgb) || (!rgb && depth);
  publicInspect=src?'':v?.plot?'depth_plot':'trajectory';
  const img=$('inspectImage'), map=$('stopMap');map.hidden=publicInspect!=='trajectory';img.hidden=!map.hidden;
  $('overlay').hidden=Boolean(publicInspect);$('markTools').hidden=Boolean(publicInspect);
  if(publicInspect){
    $('rgbBtn').disabled=!rgb;$('depthBtn').disabled=!v?.plot&&!depth;$('depthBtn').setAttribute('aria-pressed',String(publicInspect==='depth_plot'));
    $('rgbBtn').setAttribute('aria-pressed','false');$('overlayBtn').disabled=true;$('overlayBtn').setAttribute('aria-pressed','false');$('overlayBtn').textContent='Overlay';
    if(publicInspect==='trajectory') publicPlot(map,route,i); else img.src=v.plot;
    $('inspectCaption').textContent='Frame '+i+' · '+seconds(route.frames[i].s)+' · '+(publicInspect==='trajectory'?'Recorded stop pose. Select a landmark above for a depth diagram.':'Derived camera depth, 0.3–8 m. Yellow is near, blue is far. Purple marks invalid depth.');return;
  }
  $('rgbBtn').disabled=!rgb;
  $("rgbBtn").setAttribute("aria-pressed",String(!depthMode));$("depthBtn").disabled=isStop||(!depth&&!v?.plot);
  $("depthBtn").setAttribute("aria-pressed",String(depthMode));
  $("overlayBtn").disabled=depthMode||!(isStop||v.footprint);
  $("overlayBtn").textContent=isStop?"Mark target point":"Mark stopped base";
  $("overlayBtn").setAttribute("aria-pressed",String(annotated));
  img.src=src;
  $("inspectCaption").textContent="Frame "+i+" · "+seconds(route.frames[i].s)+". "+
    (depthMode?"Depth spans 0.3–8 m. Brighter is closer. Purple marks invalid depth.":
     isStop?"This RGB frame includes a point on the kiosk casing. The operating-face normal still needs validation.":
     v.footprint?"Projected base radius: "+route.radius+" m in this view.":
     v.label==="Escalator entrance"?"The center of the stopped base falls outside this view.":"Original landmark RGB and matching depth.");
  const c=$("overlay").getContext("2d");c.clearRect(0,0,640,480);
  if (annotated&&!depthMode&&(isStop||v.footprint)){
    c.lineWidth=3;c.strokeStyle=isStop?"#ffdb45":"#e83082";c.beginPath();
    if(isStop)c.arc(route.stopPixel[0],route.stopPixel[1],13,0,Math.PI*2);
    else {const poly=v.footprint;c.moveTo(...poly[1]);poly.slice(2).forEach(p=>c.lineTo(...p));c.closePath();c.fillStyle="rgba(220,40,116,.15)";c.fill();}
    c.stroke();
  }
  const marks=(form?.evidence||[]).filter(e=>e.frame===i&&e.mark).map(e=>e.mark);
  if(previewMark)marks.push(previewMark);
  marks.forEach(({u,v})=>{
    c.beginPath();c.arc(u,v,8,0,2*Math.PI);c.moveTo(u-13,v);c.lineTo(u+13,v);c.moveTo(u,v-13);c.lineTo(u,v+13);
    c.lineWidth=4;c.strokeStyle="#fff";c.stroke();c.lineWidth=2;c.strokeStyle="#c14119";c.stroke();
  });
}
function resetMark(){previewMark=null;$("markX").value="";$("markY").value="";}
function setMark(x,y){
  $("markX").value=x;$("markY").value=y;previewMark={kind:$("markKind").value,u:x,v:y};drawInspect();
}
function appendEvidence(e){
  if(form.evidence.some(x=>canonical(x)===canonical(e))){toast("This evidence is already pinned.");return;}
  if(form.evidence.length>=24){toast("This review already has 24 evidence pins.");return;}
  form.evidence.push(e);saveDraft();drawPins();$("formMessage").textContent="";
}
function drawQuestion() {
  $("questionText").textContent=qa.text;$("answerText").textContent=qa.answer;
  const bar=$("witnesses");bar.replaceChildren();
  qa.frames.forEach((i,n)=>{
    const b=button(seconds(route.frames[i].s)+" · #"+i,()=>{witnessIndex=n;drawQuestion();});
    b.setAttribute("aria-pressed",String(n===witnessIndex));bar.append(b);
  });
  const i=qa.frames[witnessIndex],src=originalAsset(route.base+i+'.png');$('questionImage').hidden=!src;$('memoryMap').hidden=Boolean(src);
  if(src)$('questionImage').src=src;else publicPlot($('memoryMap'),route,i);
  $('questionCaption').textContent='Frame '+i+' · '+seconds(route.frames[i].s)+' · '+(src?'Original camera frame for this question.':'Recorded pose at the evidence timestamp. Load the local RGB to verify the visual answer.');
}

function canonical(v) {
  if (Array.isArray(v)) return "["+v.map(canonical).join(",")+"]";
  if (v && typeof v==="object") return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  return JSON.stringify(v);
}
function checkRecord(v) {
  const r=routes.get(v?.route);
  if (!r||v.source_sha256!==r.source||!(/^[0-9a-f]{32}$/.test(v.id))||
      (v.scope!=="route"&&!r.qa.some(q=>q.id===v.scope))||typeof v.reviewer!=="string"||
      !v.reviewer||v.reviewer.length>40||cleanName(v.reviewer)!==v.reviewer||
      typeof v.time!=="string"||!Number.isFinite(Date.parse(v.time))) throw Error("Invalid route, reviewer or revision");
  const needed=checksFor(v.scope);
  if(!v.checks||Object.keys(v.checks).length!==needed.length||needed.some(([k])=>!Object.hasOwn(labels,v.checks[k]))) throw Error("Incomplete review criteria");
  if(typeof v.note!=="string"||v.note.length>2000||(outcome(v)!=="pass"&&!v.note.trim())) throw Error("Explain a failed or uncertain judgment");
  if(!Array.isArray(v.parents)||v.parents.some(p=>typeof p!=="string"||p===v.id)||new Set(v.parents).size!==v.parents.length) throw Error("Invalid revision history");
  if(!Array.isArray(v.evidence)||!v.evidence.length||v.evidence.length>24) throw Error("Pin between 1 and 24 items per review");
  for(const e of v.evidence){
    if(canonical(e)!==canonical(evidence(r,e.frame,e.view,e.mark))) throw Error("Evidence frame, time or checksum mismatch");
  }
}
function merge(list, persist=true) {
  const merged=new Map(records), fresh=[];
  for(const v of list){
    checkRecord(v);
    if(merged.has(v.id)) {
      if(canonical(merged.get(v.id))!==canonical(v)) throw Error("Conflicting content for the same record ID");
    } else {merged.set(v.id,v);fresh.push(v);}
  }
  for(const v of fresh) for(const key of v.parents){
    const p=merged.get(key);
    if(!p||p.reviewer!==v.reviewer||p.route!==v.route||p.scope!==v.scope) throw Error("Missing an earlier version of this review");
  }
  const done=new Set(records.keys()), visiting=new Set();
  function visit(v){
    if(done.has(v.id))return;
    if(visiting.has(v.id))throw Error("Cycle in revision history");
    visiting.add(v.id);v.parents.forEach(k=>visit(merged.get(k)));visiting.delete(v.id);done.add(v.id);
  }
  fresh.forEach(visit);
  for(const v of fresh){records.set(v.id,v);if(persist)put("r."+v.id,JSON.stringify(v));}
  return fresh.length;
}
function refreshStorage() {
  let saved=[];
  try {
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k?.startsWith(prefix+"r.")) saved.push(JSON.parse(localStorage.getItem(k)));
    }
  } catch {storageError();return;}
  try {merge(saved,false);} catch(e){toast("Local reviews could not be loaded: "+e.message);}
}
function submitReview() {
  setReviewer();
  const message=$("formMessage");
  if(!reviewer){message.textContent="Enter a reviewer alias at the top of the page.";$("reviewer").focus();return;}
  if(checksFor(scope).some(([k])=>!form.checks[k])){message.textContent="Complete every criterion. Choose Unsure when evidence is missing.";return;}
  if(!form.evidence.length){message.textContent="Pin at least one evidence frame.";$("pin").focus();return;}
  if(scope!=='route'&&form.checks.fact!=='unknown'&&form.evidence.every(e=>e.view==='trajectory')){message.textContent='A recorded pose alone cannot establish a visual answer. Pin image evidence or choose Unsure.';return;}
  if(outcome(form)!=="pass"&&!form.note.trim()){message.textContent="Explain the issue or the missing evidence.";$("note").focus();return;}
  const h=allHeads(entries(route,scope,reviewer));
  if(h.length===1 && canonical([h[0].checks,h[0].evidence,h[0].note])===canonical([form.checks,form.evidence,form.note.trim()])){
    message.textContent="This judgment has already been saved.";return;
  }
  const row={id:id(),route:route.id,source_sha256:route.source,scope,reviewer,time:new Date().toISOString(),
             checks:{...form.checks},evidence:[...form.evidence],note:form.note.trim(),parents:[...form.parents]};
  try {
    merge([row]);form={checks:{...row.checks},evidence:[...row.evidence],note:row.note,parents:[row.id]};
    saveDraft();drawQueue();drawForm();
    message.textContent=durable?"Review saved on this device.":"Review saved for this session. Export it now.";
  } catch(e) {message.textContent=e.message;}
}
function download(all) {
  if(!all)setReviewer();
  const list=[...records.values()].filter(r=>all||r.reviewer===reviewer);
  if(!list.length){toast("There are no saved reviews to export.");return;}
  const payload={schema,batch_id:pack.batch,exported_utc:new Date().toISOString(),records:list};
  const link=node("a");link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  link.download="floor5-review-"+(all?"all":reviewer.replace(/[^\p{L}\p{N}_-]/gu,"_"))+"-"+new Date().toISOString().slice(0,10)+".json";
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1200);
  toast("Exported "+list.length+" records, including revision history.");
}
async function importFiles(files) {
  try {
    const staged=[];
    for(const f of files){
      if(f.size>12*1024*1024)throw Error("A review file exceeds 12 MB");
      const data=JSON.parse(await f.text());
      if(data.schema!==schema||data.batch_id!==pack.batch||!Array.isArray(data.records))throw Error("This file does not match this evidence pack or review format");
      staged.push(...data.records);
    }
    const n=merge(staged);drawQueue();
    if(!form.note&&!form.evidence.length&&!Object.keys(form.checks).length)loadForm();else drawForm();
    if($("summary").open)drawSummary();
    toast("Imported "+n+" new records. Duplicates were skipped.");
  }catch(e){toast("Import failed: "+e.message);}
  finally{$("fileIn").value="";}
}
function drawSummary() {
  const body=$("summaryBody");body.replaceChildren();
  for(const r of pack.routes){
    const section=node("section",undefined,"summary-route");section.append(node("h3",r.name+" · "+r.distance.toFixed(2)+" m"));
    let any=false;
    for(const s of ["route",...r.qa.map(q=>q.id)]){
      const heads=allHeads(entries(r,s));if(!heads.length)continue;
      any=true;
      const det=node("details");
      const clash=disagreement(heads);
      const head=node("summary",(s==="route"?"Route review":r.qa.find(q=>q.id===s).text)+" · "+heads.length+" current reviews"+(clash?" · Disagreement":""));
      if(clash)head.className="conflict";
      det.append(head);det.open=clash||s==="route";
      heads.forEach(v=>{
        const line=node("div",undefined,"summary-entry");
        line.append(node("strong",v.reviewer+" · "+resultNames[outcome(v)]),
          node("p",checksFor(s).map(([k,title])=>title+" ("+labels[v.checks[k]]+")").join("  ")));
        if(v.note)line.append(node("p",v.note));
        v.evidence.forEach(e=>line.append(button("#"+e.frame+" "+(e.mark?markNames[e.mark.kind]+" ("+e.mark.u+", "+e.mark.v+")":viewNames[e.view]),()=>{
          $("summary").close();selectRoute(r);
          if(e.view==="pov"||e.view==='trajectory'){
            if(s!=="route"){qa=r.qa.find(q=>q.id===s);$("question").value=s;switchScope(s);}
            seek(e.frame);return;
          }
          if(e.view==="witness"){
            qa=r.qa.find(q=>q.id===s&&q.frames.includes(e.frame))||r.qa.find(q=>q.frames.includes(e.frame));
            $("question").value=qa.id;witnessIndex=qa.frames.indexOf(e.frame);showTab("memory");return;
          }
          viewIndex=(e.view==="stop"||e.view==="target")?-1:r.views.findIndex(v=>v.frame===e.frame);
          $("viewSelect").value=viewIndex;depthMode=e.view==="depth"||e.view==='depth_plot';annotated=["footprint","target"].includes(e.view);previewMark=e.mark||null;showTab("stop");
        })));det.append(line);
      });
      section.append(det);
    }
    if(!any)section.append(node("p","There are no saved reviews yet.","hint"));body.append(section);
  }
}
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
$("reviewer").addEventListener("change",setReviewer);
$("reviewer").addEventListener("keydown",e=>{if(e.key==="Enter")$("reviewer").blur();});
$("filter").addEventListener("change",drawQueue);
$("note").addEventListener("input",()=>{form.note=$("note").value;saveDraft();$("formMessage").textContent="";});
$("pin").addEventListener("click",()=>appendEvidence(activeEvidence()));
$("submit").addEventListener("click",submitReview);
$("rebase").addEventListener("click",()=>{
  const heads=allHeads(entries(route,scope,reviewer));
  if(heads.length===1){
    const h=heads[0];
    form={checks:{...h.checks},note:h.note,evidence:[...h.evidence],parents:[h.id]};
  } else {form.parents=heads.map(h=>h.id);}
  saveDraft();drawForm();$("formMessage").textContent="Review and save to retain all referenced earlier versions.";
});
$("importBtn").addEventListener("click",()=>$("fileIn").click());
$("fileIn").addEventListener("change",e=>importFiles(e.target.files));
$("exportMine").addEventListener("click",()=>download(false));$("exportAll").addEventListener("click",()=>download(true));
$("openSummary").addEventListener("click",()=>{drawSummary();$("summary").showModal();});
$("closeSummary").addEventListener("click",()=>$("summary").close());
$("prev").addEventListener("click",()=>seek(frame-1));$("next").addEventListener("click",()=>seek(frame+1));
$("scrub").addEventListener("input",()=>seek(Number($("scrub").value)));
$("toStop").addEventListener("click",()=>seek(route.frames.length-1));
$("speed").addEventListener("change",()=>{$("movie").playbackRate=Number($("speed").value);});
$("play").addEventListener("click",async()=>{
  if($('movie').hidden){toggleMapPlayback();return;}
  if(!$("movie").paused){$("movie").pause();return;}
  if(frame===route.frames.length-1)seek(0);
  try{await $("movie").play();}catch{toast("Cannot play this video. Try loading the verified local media folder again.");}
});
$("movie").addEventListener("loadedmetadata",()=>{if(pendingSeek!==null)seek(pendingSeek);});
$("movie").addEventListener("seeked",syncPosition);$("movie").addEventListener("timeupdate",syncPosition);
$("movie").addEventListener("play",()=>{$("play").textContent="Pause";const animate=()=>{syncPosition();if(!$("movie").paused)raf=requestAnimationFrame(animate);};cancelAnimationFrame(raf);raf=requestAnimationFrame(animate);});
$("movie").addEventListener("pause",()=>{$("play").textContent="Play";cancelAnimationFrame(raf);});
$("movie").addEventListener("ended",()=>{frame=route.frames.length-1;drawFrame();});
$("movie").addEventListener("error",()=>{if(!$('movie').hidden)toast('Could not read the local video. Select the verified media folder again.');});
$("viewSelect").addEventListener("change",()=>{viewIndex=Number($("viewSelect").value);depthMode=false;annotated=false;resetMark();drawInspect();});
$("markTools").addEventListener("toggle",()=>$("inspectPhoto").classList.toggle("marking",$("markTools").open));
$("inspectImage").addEventListener("click",event=>{
  if(!$("markTools").open)return;
  const b=event.target.getBoundingClientRect(),s=Math.min(b.width/640,b.height/480);
  const u=Math.floor((event.clientX-b.left-(b.width-640*s)/2)/s),v=Math.floor((event.clientY-b.top-(b.height-480*s)/2)/s);
  if(u>=0&&u<640&&v>=0&&v<480)setMark(u,v);
});
$("markAdd").addEventListener("click",()=>{
  const x=$("markX").valueAsNumber,y=$("markY").valueAsNumber;
  try{
    const here=activeEvidence(), m={kind:$("markKind").value,u:x,v:y};
    const e=evidence(route,here.frame,here.view,m);appendEvidence(e);setMark(x,y);
  }catch{toast("Select a point or enter valid original pixel coordinates.");}
});
$("rgbBtn").addEventListener("click",()=>{depthMode=false;drawInspect();});
$("depthBtn").addEventListener("click",()=>{depthMode=true;annotated=false;drawInspect();});
$("overlayBtn").addEventListener("click",()=>{annotated=!annotated;drawInspect();});
$("question").addEventListener("change",()=>{qa=route.qa.find(q=>q.id===$("question").value);witnessIndex=0;$("answerDetails").open=false;switchScope(qa.id);drawQuestion();});
$("watchContext").addEventListener("click",()=>{showTab("play",true);seek(qa.frames[witnessIndex]);});
window.addEventListener("resize",drawMap);
let refreshTimer;
window.addEventListener("storage",e=>{
  if(e.key?.startsWith(prefix+"r.")){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{refreshStorage();drawQueue();drawForm();if($("summary").open)drawSummary();},100);}
});
refreshStorage();reviewer=get("reviewer")||"";$("reviewer").value=reviewer;$("packTitle").textContent=pack.title;
function stopMapPlayback(){if(mapClock){cancelAnimationFrame(mapClock);mapClock=0;}$('play').textContent='Play';}
function toggleMapPlayback(){
  if(mapClock){stopMapPlayback();return;}if(frame===route.frames.length-1)seek(0);
  let clock=route.frames[frame].s,previous=performance.now();$('play').textContent='Pause';
  function advance(now){clock+=(now-previous)/1000*Number($('speed').value);previous=now;const old=frame;
    while(frame<route.frames.length-1&&route.frames[frame+1].s<=clock)frame++;
    if(old!==frame)drawFrame();if(frame===route.frames.length-1){stopMapPlayback();return;}mapClock=requestAnimationFrame(advance);
  }mapClock=requestAnimationFrame(advance);
}
$('chooseFolder').onclick=()=>$('folder').click();
$('folder').addEventListener('change',async e=>{const input=e.target;input.disabled=true;try{const count=await readLocalFolder(input.files);selectRoute(route);$('folderStatus').textContent=count+' verified local files are ready.';}catch(err){$('folderStatus').textContent=err.message;}finally{input.value='';input.disabled=false;}});
const wanted=new URL(location.href).searchParams.get('route');selectRoute(pack.routes.find(r=>r.code===wanted)||route);
