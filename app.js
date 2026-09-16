/* 画面の動き：動画を選ぶ→解析する→ラリーだけ見る→確かめる→感想 */
const $=id=>document.getElementById(id);
const fmt=s=>Math.floor(Math.max(0,s)/60)+":"+String(Math.floor(Math.max(0,s)%60)).padStart(2,"0");
const tick=()=>new Promise(r=>setTimeout(r,0));
const v=$("v"), work=$("work");
let duration=0, fileName="", feats=null, prob=null, times=null;
let segs=[], blocks=[], mode="free", curIdx=-1, stopAt=null;
let chk={on:false,i:0,marks:[]};

/* ---------- 1. 動画 ---------- */
$("file").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  fileName=f.name; $("err").innerHTML="";
  v.src=URL.createObjectURL(f);
  v.onloadedmetadata=()=>{
    duration=v.duration; $("tEnd").textContent=fmt(duration);
    feats=null; prob=null; segs=[]; chk={on:false,i:0,marks:[]};
    $("scanCard").hidden=false;
    $("playCard").hidden=true; $("fbCard").hidden=true; $("tuneCard").hidden=true; $("checkCard").hidden=true; $("outCard").hidden=true;
    const mins=Math.max(1,Math.round(duration/60*0.7));
    $("estTime").textContent=`この動画（${fmt(duration)}）だと、だいたい${mins}分かかります。`;
    $("status").textContent=""; $("fill").style.width="0";
  };
};

/* ---------- 2. 解析 ---------- */
const FPS=4;
const NAME=i=>["nose","left_eye","right_eye","left_ear","right_ear","left_shoulder","right_shoulder",
  "left_elbow","right_elbow","left_wrist","right_wrist","left_hip","right_hip",
  "left_knee","right_knee","left_ankle","right_ankle"][i];

$("run").onclick=async()=>{
  $("run").disabled=true; $("loadBtn").disabled=true;
  let det;
  try{
    $("status").textContent="判定モデルを読み込み中…";
    det=await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,
      {modelType:poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING});
  }catch(err){
    $("err").innerHTML='<div class="err">モデルを読み込めませんでした。ネットにつながった状態で開いてください。<br>'+err.message+'</div>';
    $("run").disabled=false; $("loadBtn").disabled=false; return;
  }
  const W=512; work.width=W; work.height=Math.round(W*v.videoHeight/v.videoWidth);
  const g=work.getContext("2d",{willReadFrequently:true});
  const seek=t=>new Promise(r=>{v.currentTime=Math.min(t,duration-0.05);
    v.addEventListener("seeked",()=>r(),{once:true});});
  v.pause();

  const N=Math.floor(duration*FPS), raw=[], t0=performance.now();
  for(let i=0;i<N;i++){
    const t=i/FPS;
    await seek(t);
    g.drawImage(v,0,0,work.width,work.height);
    const poses=await det.estimatePoses(work);
    const ppl=poses.map(p=>{
      const kp={}; p.keypoints.forEach((k,j)=>{ if(k.score>0.25) kp[NAME(j)]=[k.x,k.y]; });
      const sh=kp.left_shoulder&&kp.right_shoulder
        ? [(kp.left_shoulder[0]+kp.right_shoulder[0])/2,(kp.left_shoulder[1]+kp.right_shoulder[1])/2] : null;
      const hp=kp.left_hip&&kp.right_hip
        ? [(kp.left_hip[0]+kp.right_hip[0])/2,(kp.left_hip[1]+kp.right_hip[1])/2] : null;
      if(!sh||!hp) return null;
      const scale=Math.max(8,Math.hypot(sh[0]-hp[0],sh[1]-hp[1]));
      return {kp,center:[(sh[0]+hp[0])/2,(sh[1]+hp[1])/2],scale};
    }).filter(Boolean)
      .filter(p=>p.center[0]>work.width*0.15&&p.center[0]<work.width*0.85&&p.center[1]>work.height*0.10)
      .sort((a,b)=>b.scale-a.scale).slice(0,2);
    raw.push({t,ppl});
    if(i%4===0){
      const done=(i+1)/N, el=(performance.now()-t0)/1000;
      const left=done>0.02? Math.round(el*(1-done)/done) : null;
      $("status").textContent=`${fmt(t)} / ${fmt(duration)}`+(left!==null?`　のこり約${fmt(left)}`:"");
      $("fill").style.width=Math.round(100*done)+"%"; await tick();
    }
  }

  feats=toFeatures(raw);
  $("status").textContent="完了";
  $("fill").style.width="100%";
  $("run").disabled=false; $("loadBtn").disabled=false;
  finish();
};

function toFeatures(raw){
  const F=[];
  const parts={wrist:["left_wrist","right_wrist"],elbow:["left_elbow","right_elbow"],
               ankle:["left_ankle","right_ankle"],shoulder:["left_shoulder","right_shoulder"]};
  for(let i=0;i<raw.length;i++){
    const cur=raw[i].ppl, prev=i?raw[i-1].ppl:[];
    const rec={t:+raw[i].t.toFixed(3), n:cur.length,
      scale:+(cur.reduce((s,p)=>s+p.scale,0)/Math.max(cur.length,1)).toFixed(2)};
    for(const k in parts) rec[k]=0;
    rec.center=0; rec.all=0;
    let cnt=0;
    for(const p of cur){
      let best=null,bd=1e9;
      for(const q of prev){const d=Math.hypot(p.center[0]-q.center[0],p.center[1]-q.center[1]);
        if(d<bd){bd=d;best=q;}}
      if(!best||bd>p.scale*3) continue;
      cnt++;
      rec.center+=bd/p.scale;
      for(const k in parts){
        let s=0,c=0;
        for(const nm of parts[k]) if(p.kp[nm]&&best.kp[nm]){
          s+=Math.hypot(p.kp[nm][0]-best.kp[nm][0],p.kp[nm][1]-best.kp[nm][1])/p.scale; c++; }
        if(c) rec[k]+=s/c;
      }
      let s=0,c=0;
      for(const nm in p.kp) if(best.kp[nm]){
        s+=Math.hypot(p.kp[nm][0]-best.kp[nm][0],p.kp[nm][1]-best.kp[nm][1])/p.scale; c++; }
      if(c) rec.all+=s/c;
    }
    if(cnt){ for(const k of ["center","all",...Object.keys(parts)]) rec[k]=+(rec[k]/cnt).toFixed(4); }
    F.push(rec);
  }
  return F;
}

/* 前回の解析を読み込む */
$("loadBtn").onclick=()=>$("loadFile").click();
$("loadFile").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      if(!d.features) throw new Error("この形式ではありません");
      feats=d.features;
      $("status").textContent="読み込みました（"+(d.video||"")+"）";
      $("fill").style.width="100%";
      finish();
    }catch(err){ $("err").innerHTML='<div class="err">読み込めませんでした：'+err.message+'</div>'; }
  };
  r.readAsText(f);
};

/* ---------- 3. 判定して区間にする ---------- */
function finish(){
  prob=RallyModel.predict(feats,activeModel());
  times=feats.map(f=>f.t);
  $("playCard").hidden=false; $("fbCard").hidden=false;
  $("tuneCard").hidden=false; $("checkCard").hidden=false; $("outCard").hidden=false;
  recompute();
  if(typeof refreshGrow==="function") refreshGrow();
}

function recompute(){
  const th=+$("th").value, sm=+$("sm").value, pad=+$("pad").value, pad2=+$("pad2").value, mn=+$("min").value;
  $("thV").textContent=th+"%"; $("smV").textContent=sm;
  $("padV").textContent=pad.toFixed(1)+"s"; $("pad2V").textContent=pad2.toFixed(1)+"s"; $("minV").textContent=mn.toFixed(1)+"s";
  let r=RallyModel.toSegments(prob,times,{smooth:sm,keepPercent:th,mergeGap:1.0,minDuration:mn});
  // 前後に余裕をつけて、重なったらつなぐ
  r=r.map(([a,b])=>[Math.max(0,a-pad),Math.min(duration,b+pad2)]);
  const m=[];
  for(const s of r){ if(m.length&&s[0]<=m[m.length-1][1]) m[m.length-1][1]=s[1]; else m.push(s); }
  segs=m;
  // ラリーと捨てた区間を交互にならべる（確かめる用）
  blocks=[]; let cur=0;
  for(const [a,b] of segs){
    if(a-cur>=1.6) blocks.push({a:cur,b:a,kind:0});
    blocks.push({a,b,kind:1}); cur=b;
  }
  if(duration-cur>=1.6) blocks.push({a:cur,b:duration,kind:0});
  chk={on:false,i:0,marks:[]};
  if(typeof fixRanges==="object") fixRanges={};
  $("chkBar").hidden=true; document.body.classList.remove("checking");
  $("chkStop").hidden=true; $("chkStart").hidden=false;
  $("chkInfo").textContent="1区間ずつ再生して、合っているか判定していきます";
  $("chkAdvice").innerHTML="";
  marksReady();
  drawAll();
}
["th","sm","pad","pad2","min"].forEach(id=>$(id).oninput=recompute);

function drawAll(){
  const tl=$("tl");
  [...tl.querySelectorAll(".r,.mk")].forEach(e=>e.remove());
  for(const [a,b] of segs){
    const d=document.createElement("div"); d.className="r";
    d.style.left=(100*a/duration)+"%";
    d.style.width=Math.max(0.25,100*(b-a)/duration)+"%";
    tl.appendChild(d);
  }
  chk.marks.forEach((mk,i)=>{
    if(mk===null||mk===undefined) return;
    const bl=blocks[i]; if(!bl) return;
    const d=document.createElement("div"); d.className="mk "+(mk===1?"o":mk===0.5?"p":"x");
    d.style.left=(100*bl.a/duration)+"%";
    d.style.width=Math.max(0.25,100*(bl.b-bl.a)/duration)+"%";
    tl.appendChild(d);
  });
  const keep=segs.reduce((s,[a,b])=>s+(b-a),0);
  $("nSeg").textContent=segs.length;
  $("sKeep").textContent=fmt(keep);
  $("pCut").textContent=duration?Math.round(100-100*keep/duration)+"%":"0%";
  const ul=$("segs"); ul.innerHTML="";
  segs.forEach(([a,b],i)=>{
    const li=document.createElement("li"); li.dataset.i=i;
    li.innerHTML=`<span class="n mono">${i+1}</span>`+
      `<span class="t mono">${fmt(a)} – ${fmt(b)}　<span style="color:var(--ink2)">${(b-a).toFixed(1)}秒</span></span>`;
    const p=document.createElement("button"); p.textContent="見る";
    p.onclick=()=>playSeg(i);
    li.appendChild(p); ul.appendChild(li);
  });
  $("cTot").textContent=blocks.length;
  updateOut();
}

function updateOut(){
  const lines=segs.map(([a,b],i)=>`${String(i+1).padStart(2)}  ${fmt(a)} – ${fmt(b)}  (${(b-a).toFixed(1)}s)`);
  $("out").value=lines.join("\n");
  $("outInfo").textContent=`${segs.length}本 / ${fmt(segs.reduce((s,[a,b])=>s+(b-a),0))}`;
}

/* ---------- 倍速 ---------- */
const SPEEDS=[1,1.5,2,3];
let speed=1;
function buildSpeed(){
  document.querySelectorAll("[data-spd]").forEach(box=>{
    SPEEDS.forEach(x=>{
      const b=document.createElement("button");
      b.textContent=(x===1?"1":String(x))+"x";
      b.dataset.s=x;
      b.onclick=()=>setSpeed(x);
      box.appendChild(b);
    });
  });
  setSpeed(1);
}
function setSpeed(x){
  speed=x; v.playbackRate=x;
  document.querySelectorAll("[data-spd] button").forEach(b=>b.classList.toggle("on",+b.dataset.s===x));
}
function stepSpeed(d){
  const i=SPEEDS.indexOf(speed);
  setSpeed(SPEEDS[Math.min(SPEEDS.length-1,Math.max(0,(i<0?0:i)+d))]);
}
buildSpeed();
v.addEventListener("loadedmetadata",()=>{ v.playbackRate=speed; });  // 動画を替えても速さを保つ
v.addEventListener("ratechange",()=>{                                 // 標準の再生コントロールで変えたときも合わせる
  if(SPEEDS.includes(v.playbackRate)&&v.playbackRate!==speed) setSpeed(v.playbackRate);
});

/* ---------- 再生 ---------- */
function playSeg(i){
  if(i<0||i>=segs.length) return;
  curIdx=i; mode="one"; stopAt=segs[i][1];
  v.currentTime=segs[i][0]; v.play();
  showNow();
}
function playAuto(){
  mode="auto";
  const i=segs.findIndex(([a,b])=>v.currentTime<b);
  curIdx=i<0?0:i;
  stopAt=segs[curIdx][1];
  if(v.currentTime<segs[curIdx][0]) v.currentTime=segs[curIdx][0];
  v.play(); showNow();
}
$("auto").onclick=playAuto;
$("next").onclick=()=>playSeg(Math.min(segs.length-1,curIdx+1));
$("prev").onclick=()=>playSeg(Math.max(0,curIdx-1));

function showNow(){
  const s=segs[curIdx];
  $("nowInfo").innerHTML = s
    ? `<span class="pill r">ラリー ${curIdx+1}/${segs.length}</span>　<span class="mono">${fmt(s[0])} – ${fmt(s[1])}</span>`
    : "—";
  [...$("segs").children].forEach(li=>li.classList.toggle("now",+li.dataset.i===curIdx));
  const li=$("segs").children[curIdx]; if(li) li.scrollIntoView({block:"nearest"});
}

/* 区間の終わりで止める判定。倍速でもずれないよう、毎コマ見張る */
function watch(){
  $("cur").style.left=(100*v.currentTime/duration)+"%";
  if(stopAt!==null&&v.currentTime>=stopAt){
    if(mode==="auto"&&curIdx+1<segs.length){
      curIdx++; stopAt=segs[curIdx][1];
      v.currentTime=segs[curIdx][0]; showNow();
    }else if(mode==="check"){
      v.pause(); stopAt=null;
    }else{
      v.pause(); stopAt=null;
      if(mode==="auto") $("nowInfo").innerHTML='<span class="pill c">最後まで見ました</span>';
    }
  }
  if(!v.paused) requestAnimationFrame(watch);
}
v.addEventListener("play",()=>requestAnimationFrame(watch));
v.addEventListener("timeupdate",watch);
$("tl").onclick=e=>{
  const r=e.currentTarget.getBoundingClientRect();
  v.currentTime=duration*(e.clientX-r.left)/r.width;
  mode="free"; stopAt=null;
};

/* ---------- 5. 確かめる ---------- */
function endCheck(){
  chk.on=false;
  $("chkBar").hidden=true; document.body.classList.remove("checking");
  $("chkStop").hidden=true; $("chkStart").hidden=false;
  v.pause(); stopAt=null; mode="free";
}
$("chkStart").onclick=()=>{
  chk={on:true,i:0,marks:[]};
  $("chkBar").hidden=false; document.body.classList.add("checking");
  $("chkStop").hidden=false; $("chkStart").hidden=true;
  v.scrollIntoView({block:"start",behavior:"smooth"});   // 動画を画面の上に出す
  playBlock(0);
};
$("chkStop").onclick=endCheck;
function playBlock(i){
  if(i>=blocks.length){
    const done=chk.marks.filter(x=>x===0||x===0.5||x===1).length;
    const ok=chk.marks.filter(x=>x===1).length;
    endCheck();
    $("chkInfo").innerHTML=`全部見ました。ちょうどいい <b>${Math.round(100*ok/Math.max(done,1))}%</b>（${ok}/${done}）`;
    advise();
    $("checkCard").scrollIntoView({block:"center",behavior:"smooth"});
    return;
  }
  chk.i=i;
  const b=blocks[i];
  mode="check"; stopAt=b.b;
  v.currentTime=b.a; v.play();
  $("chkNow").innerHTML=
    (b.kind? '<span class="pill r">ラリーとして残した</span>':'<span class="pill c">いらないとして捨てた</span>')+
    `　<span class="mono">${fmt(b.a)} – ${fmt(b.b)}（${(b.b-b.a).toFixed(1)}秒）</span>`;
  $("chkProg").textContent=`${i+1} / ${blocks.length}`;
  $("chkTip").textContent = b.kind
    ? "ラリーが最初から最後まで入っていれば 1。ラリーだけど頭かお尻が切れていれば 2。ラリーじゃなければ 3。"
    : "捨ててよかったなら 1。ここにラリーが含まれていたなら 3。";
  refreshChk();
}
function mark(val){
  if(!chk.on) return;
  chk.marks[chk.i]=val;
  drawAll(); refreshChk();
  playBlock(chk.i+1);
}
function refreshChk(){
  const n=v=>chk.marks.filter(x=>x===v).length;
  const ok=n(1), part=n(0.5), ng=n(0), done=ok+part+ng;
  $("cDone").textContent=done; $("cOk").textContent=ok;
  $("cPart").textContent=part; $("cNg").textContent=ng;
  if(chk.on) $("chkInfo").textContent=`${done}/${blocks.length}区間を判定しました`;
  marksReady(); advise();
}
/* 押した内容から、どのつまみを動かせばいいか教える */
function advise(){
  const n=v=>chk.marks.filter(x=>x===v).length;
  const ok=n(1), part=n(0.5), ng=n(0), done=ok+part+ng;
  const box=$("chkAdvice");
  if(done<3){ box.innerHTML=""; return; }
  const msg=[];
  if(part/done>=0.25) msg.push('<b>「足りない」が多いです。</b>まず「終わりの余裕」を 1.5〜2.0 に上げてみてください。頭が切れているなら「前の余裕」も上げます。それでも途中が抜けるなら「なめらかさ」を上げます。');
  if(ng/done>=0.15) msg.push('<b>「間違い」があります。</b>残った区間が3秒以下の短いものなら「最短の長さ」を上げるのが一番効きます。ラリーじゃない長い区間が残っているなら「残す割合」を下げ、逆にラリーが捨てられているなら「残す割合」を上げてください。');
  if(!msg.length&&done>=6) msg.push('いまの設定でうまくいっています。このまま使えます。');
  box.innerHTML = msg.length? '<div class="note">'+msg.join("<br><br>")+'</div>' : "";
}
$("ok").onclick=()=>mark(1);
$("part").onclick=()=>mark(0.5);
$("ng").onclick=()=>mark(0);
$("replay").onclick=()=>{ const b=blocks[chk.i]; if(!b) return; mode="check"; stopAt=b.b; v.currentTime=b.a; v.play(); };

/* ---------- キー ---------- */
document.addEventListener("keydown",e=>{
  if(/INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if(e.code==="Space"){ e.preventDefault(); v.paused?v.play():v.pause(); }
  else if(e.key==="ArrowRight"){ e.preventDefault(); playSeg(Math.min(segs.length-1,curIdx+1)); }
  else if(e.key==="ArrowLeft"){ e.preventDefault(); playSeg(Math.max(0,curIdx-1)); }
  else if(chk.on&&e.key==="1") mark(1);
  else if(chk.on&&e.key==="2") mark(0.5);
  else if(chk.on&&e.key==="3") mark(0);
  else if(chk.on&&e.key.toLowerCase()==="r") $("replay").click();
  else if(chk.on&&e.key==="Escape") endCheck();
  else if(e.key===","){ e.preventDefault(); stepSpeed(-1); }
  else if(e.key==="."){ e.preventDefault(); stepSpeed(1); }
});

/* ---------- 4. 感想 ---------- */
const fbPick={};
document.querySelectorAll(".fb .pick").forEach(box=>{
  box.querySelectorAll("button").forEach(b=>b.onclick=()=>{
    box.querySelectorAll("button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); fbPick[box.dataset.q]=b.textContent;
  });
});
$("fbCopy").onclick=()=>{
  const keep=segs.reduce((s,[a,b])=>s+(b-a),0);
  const n=v=>chk.marks.filter(x=>x===v).length;
  const done=n(0)+n(0.5)+n(1);
  const lines=[
    "■ ラリーカット 使用報告",
    `切り取りは合っていたか： ${fbPick.q1||"（未回答）"}`,
    `また使いたいか： ${fbPick.q2||"（未回答）"}`,
    `困ったこと： ${$("fbFree").value.trim()||"（なし）"}`,
    "",
    `動画の長さ： ${fmt(duration)}`,
    `見つけたラリー： ${segs.length}本 / 残り ${fmt(keep)} / カット率 ${duration?Math.round(100-100*keep/duration):0}%`,
    `設定： 残す割合${$("th").value}% なめらかさ${$("sm").value} 最短${$("min").value}秒 前${$("pad").value}秒 終わり${$("pad2").value}秒`,
    `判定器： ${(typeof store!=="undefined"&&store&&store.coef)?"自分用":"土台"}`,
    done? `確かめた結果： ${done}区間中 ちょうどいい${n(1)} 足りない${n(0.5)} 間違い${n(0)}` : "確かめた結果： まだ確かめていません"
  ];
  const text=lines.join("\n");
  $("fbOut").hidden=false; $("fbOut").value=text;
  navigator.clipboard.writeText(text)
    .then(()=>$("fbInfo").textContent="コピーしました。LINEなどに貼り付けて送ってください")
    .catch(()=>$("fbInfo").textContent="下の枠を選んでコピーしてください");
};

/* ---------- 6. 書き出し ---------- */
$("saveScan").onclick=()=>{
  const data={video:fileName,duration:+duration.toFixed(2),fps:FPS,features:feats};
  const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=(fileName.replace(/\.[^.]+$/,""))+"_解析.json";
  document.body.appendChild(a); a.click(); a.remove();
};
/* 確かめた判定を書き出す（どこを間違えたか調べるため） */
function marksReady(){
  if(typeof refreshGrow==="function") refreshGrow();
  const n=chk.marks.filter(x=>x===0||x===0.5||x===1).length;
  $("saveMarks").disabled = n===0;
  $("saveMarks").textContent = n? `判定を書き出す（${n}件）` : "判定を書き出す";
}
$("saveMarks").onclick=()=>{
  const data={
    video:fileName, duration:+duration.toFixed(2),
    settings:{残す割合:+$("th").value, なめらかさ:+$("sm").value,
              最短の長さ:+$("min").value, 前の余裕:+$("pad").value, 終わりの余裕:+$("pad2").value},
    判定の意味:{1:"ちょうどいい",0.5:"足りない",0:"間違い"},
    blocks: blocks.map((b,i)=>({
      番号:i+1, 種類:b.kind?"ラリー":"捨てた",
      開始:+b.a.toFixed(2), 終了:+b.b.toFixed(2), 長さ:+(b.b-b.a).toFixed(2),
      判定: (chk.marks[i]===0||chk.marks[i]===0.5||chk.marks[i]===1)? chk.marks[i] : null }))
  };
  const blob=new Blob([JSON.stringify(data,null,1)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=(fileName.replace(/\.[^.]+$/,""))+"_判定.json";
  document.body.appendChild(a); a.click(); a.remove();
};
$("copyList").onclick=()=>navigator.clipboard.writeText($("out").value)
  .then(()=>$("outInfo").textContent="コピーしました");
