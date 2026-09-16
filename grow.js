/* ===== 自分用に育てる：間違いを直す → その場で学習 → この端末に保存 ===== */
const STORE_KEY = "rallycut.personal.v1";
const LAM = 0.1, STEPS = 800, RATE = 0.5;   // 土台からどれだけ動かすか／繰り返す回数／歩幅
const COLS = ["t","n","scale","wrist","elbow","ankle","shoulder","center","all"];

let store = null;          // { coef, intercept, sets:[...], updated }
let fixRanges = {};        // 区間番号 → [[開始,終了],...]（その区間の本当のラリー）
let fixTodo = [], fixAt = 0, fixing = false, holdFrom = null, fixCur = null;

/* ---------- 保存と読み出し ---------- */
function loadStore(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    store = raw ? JSON.parse(raw) : null;
  }catch(e){ store = null; }
}
function saveStore(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; }
  catch(e){
    $("gNote").hidden = false;
    $("gNote").innerHTML = "この端末に保存できませんでした（容量がいっぱいか、保存が許可されていません）。"
      + "「自分用を書き出す」でファイルに残してください。";
    return false;
  }
}
function activeModel(){
  return (store && store.coef) ? Object.assign({}, MODEL, {coef:store.coef, intercept:store.intercept}) : MODEL;
}

/* ---------- 形の変換 ---------- */
const packRows = (F) => F.map(f => COLS.map(k => +(+f[k]).toFixed(4)).concat([f.label]));
const unpackRows = (rows) => rows.map(r => {
  const o = {}; COLS.forEach((k,i) => o[k] = r[i]); o.label = r[COLS.length]; return o;
});

/* ---------- いまの動画の「本当のラリー」を組み立てる ---------- */
function defaultRange(i){
  const b = blocks[i], m = chk.marks[i];
  if(m === 1) return b.kind ? [[b.a, b.b]] : [];   // ちょうどいい＝判定器のとおり
  return null;                                      // 足りない／間違い＝本人に教えてもらう
}
function resolvedRanges(){
  const out = [];
  for(let i = 0; i < blocks.length; i++){
    const d = (fixRanges[i] !== undefined) ? fixRanges[i] : defaultRange(i);
    if(d === null) return null;                     // まだ決まっていない区間がある
    out.push(...d);
  }
  return out;
}
function labelFeatures(ranges){
  return feats.map(f => Object.assign({}, f,
    {label: ranges.some(([a,b]) => f.t >= a && f.t < b) ? 1 : 0}));
}

/* ---------- 画面の状態 ---------- */
function refreshGrow(){
  if(!feats){ $("growCard").hidden = true; return; }
  $("growCard").hidden = false;
  const sets = (store && store.sets) || [];
  const secs = sets.reduce((s,x) => s + (x.rows.length / (x.fps || 4)), 0);
  $("gWhich").textContent = (store && store.coef) ? "自分用" : "土台";
  $("gVideos").textContent = sets.length;
  $("gMin").textContent = fmt(secs);

  const judged = chk.marks.filter(x => x === 0 || x === 0.5 || x === 1).length;
  const need = blocks.map((b,i) => i).filter(i => (chk.marks[i] === 0 || chk.marks[i] === 0.5) && fixRanges[i] === undefined);
  const allJudged = blocks.length > 0 && judged === blocks.length;

  $("fixStart").disabled = need.length === 0;
  $("fixStart").textContent = need.length ? `間違いを直す（${need.length}か所）` : "間違いを直す";
  const ready = allJudged && need.length === 0;
  $("learn").disabled = !ready;

  $("gInfo").textContent =
    !allJudged ? `まず「はじめから確かめる」を最後までやってください（いま ${judged}/${blocks.length}）`
    : need.length ? `直す場所が ${need.length}か所 残っています`
    : "準備ができました。「この動画を覚えさせる」を押してください";
}

/* ---------- 間違いを直す ---------- */
function startFix(){
  fixTodo = blocks.map((b,i) => i).filter(i => (chk.marks[i] === 0 || chk.marks[i] === 0.5) && fixRanges[i] === undefined);
  if(!fixTodo.length) return;
  fixing = true; fixAt = 0;
  $("fixBar").hidden = false; document.body.classList.add("fixing");
  v.scrollIntoView({block:"start", behavior:"smooth"});
  openFix(0);
}
function endFix(){
  fixing = false; holdFrom = null;
  $("fixBar").hidden = true; document.body.classList.remove("fixing");
  $("fixHold").classList.remove("on");
  v.pause(); stopAt = null; mode = "free";
  drawAll(); refreshGrow();
}
function openFix(k){
  if(k >= fixTodo.length){ endFix(); return; }
  fixAt = k; fixCur = [];
  const b = blocks[fixTodo[k]];
  mode = "fix"; stopAt = b.b; v.currentTime = b.a; v.play();
  $("fixNow").innerHTML = (b.kind
      ? '<span class="pill r">ラリーとして残した区間</span>'
      : '<span class="pill c">いらないとして捨てた区間</span>')
    + `　<span class="mono">${fmt(b.a)} – ${fmt(b.b)}（${(b.b-b.a).toFixed(1)}秒）</span>`;
  $("fixProg").textContent = `${k+1} / ${fixTodo.length}`;
  updFixTip();
}
function updFixTip(){
  const n = fixCur ? fixCur.length : 0;
  $("fixTip").innerHTML = n
    ? `つけた印 <span class="badge">${n}個</span>　${fixCur.map(([a,b]) => fmt(a)+"–"+fmt(b)).join("  ")}　<kbd>Z</kbd>で取り消し`
    : "ラリーの間だけ押しっぱなし。何回でも足せます";
}
function holdStart(){
  if(!fixing || holdFrom !== null) return;
  holdFrom = v.currentTime;
  $("fixHold").classList.add("on");
  $("fixHold").textContent = "記録中…";
}
function holdEnd(){
  if(!fixing || holdFrom === null) return;
  const b = blocks[fixTodo[fixAt]];
  const a = Math.max(b.a, holdFrom), z = Math.min(b.b, v.currentTime);
  holdFrom = null;
  $("fixHold").classList.remove("on");
  $("fixHold").textContent = "スペースを押しっぱなし";
  if(z - a >= 0.3) fixCur.push([a, z]);
  updFixTip();
}
$("fixHold").addEventListener("mousedown", e => { e.preventDefault(); holdStart(); });
document.addEventListener("mouseup", () => { if(fixing) holdEnd(); });
$("fixHold").addEventListener("touchstart", e => { e.preventDefault(); holdStart(); }, {passive:false});
document.addEventListener("touchend", () => { if(fixing) holdEnd(); });

$("fixNone").onclick = () => { fixCur = []; commitFix(); };
$("fixNext").onclick = () => commitFix();
$("fixReplay").onclick = () => {
  const b = blocks[fixTodo[fixAt]];
  mode = "fix"; stopAt = b.b; v.currentTime = b.a; v.play();
};
function commitFix(){
  if(holdFrom !== null) holdEnd();
  fixCur.sort((x,y) => x[0] - y[0]);
  const merged = [];
  for(const r of fixCur){
    if(merged.length && r[0] <= merged[merged.length-1][1] + 0.2) merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], r[1]);
    else merged.push(r.slice());
  }
  fixRanges[fixTodo[fixAt]] = merged;
  openFix(fixAt + 1);
}
$("fixStart").onclick = startFix;

/* 直しているあいだはキーを横取りする */
document.addEventListener("keydown", e => {
  if(!fixing || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if(e.code === "Space"){ e.preventDefault(); e.stopImmediatePropagation(); if(!e.repeat) holdStart(); }
  else if(e.key === "Enter"){ e.preventDefault(); e.stopImmediatePropagation(); commitFix(); }
  else if(e.key.toLowerCase() === "z"){ e.preventDefault(); e.stopImmediatePropagation(); fixCur.pop(); updFixTip(); }
  else if(e.key.toLowerCase() === "r"){ e.preventDefault(); e.stopImmediatePropagation(); $("fixReplay").click(); }
  else if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); endFix(); }
}, true);
document.addEventListener("keyup", e => {
  if(fixing && e.code === "Space"){ e.preventDefault(); e.stopImmediatePropagation(); holdEnd(); }
}, true);

/* ---------- 学習する ---------- */
function makeRows(datasets){
  const X = [], y = [];
  for(const d of datasets){
    const F = unpackRows(d.rows);
    const cols = RallyModel.buildMatrix(F, MODEL);
    for(let i = 0; i < F.length; i++){
      const r = new Float64Array(cols.length);
      for(let j = 0; j < cols.length; j++){
        let val = cols[j][i];
        if(!isFinite(val)) val = MODEL.median[j];
        r[j] = (val - MODEL.mean[j]) / MODEL.scale[j];
      }
      X.push(r); y.push(F[i].label);
    }
  }
  return {X, y};
}
function fitFromBase(X, y){
  const D = MODEL.coef.length, n = X.length;
  const w = MODEL.coef.slice(), W0 = MODEL.coef;
  let b = MODEL.intercept;
  const g = new Float64Array(D);
  for(let s = 0; s < STEPS; s++){
    g.fill(0); let gb = 0;
    for(let i = 0; i < n; i++){
      const x = X[i];
      let z = b;
      for(let j = 0; j < D; j++) z += w[j] * x[j];
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for(let j = 0; j < D; j++) g[j] += e * x[j];
      gb += e;
    }
    for(let j = 0; j < D; j++) w[j] -= RATE * (g[j] / n + LAM * (w[j] - W0[j]));
    b -= RATE * (gb / n);
  }
  return {coef: w, intercept: b};
}
$("learn").onclick = () => {
  const ranges = resolvedRanges();
  if(!ranges){ refreshGrow(); return; }
  $("learn").disabled = true; $("learn").textContent = "学習中…";
  setTimeout(() => {
    const mine = {video: fileName, fps: 4, rows: packRows(labelFeatures(ranges))};
    if(!store) store = {sets: [], coef: null, intercept: null};
    store.sets = store.sets.filter(x => x.video !== mine.video);   // 同じ動画は上書き
    store.sets.push(mine);
    while(store.sets.length > 12) store.sets.shift();              // 入れすぎない
    const {X, y} = makeRows(store.sets);
    const fitted = fitFromBase(X, y);
    store.coef = Array.from(fitted.coef);
    store.intercept = fitted.intercept;
    store.updated = new Date().toISOString().slice(0,10);
    const saved = saveStore();
    prob = RallyModel.predict(feats, activeModel());              // すぐ効かせる
    fixRanges = {}; chk.marks = [];
    recompute();
    $("learn").textContent = "この動画を覚えさせる";
    $("gNote").hidden = false;
    $("gNote").innerHTML = `覚えました。学習に使ったコマ数 ${y.length}、ラリー ${y.filter(x=>x===1).length}コマ。`
      + `区切り直したので、もう一度「はじめから確かめる」で良くなったか確かめてください。`
      + (saved ? "" : "<br>※この端末には保存できていません。");
    refreshGrow();
  }, 30);
};

/* ---------- 書き出し・読み込み・やり直し ---------- */
$("gSave").onclick = () => {
  if(!store){ return; }
  const blob = new Blob([JSON.stringify(store)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ラリーカット_自分用.json";
  document.body.appendChild(a); a.click(); a.remove();
};
$("gLoadBtn").onclick = () => $("gLoadFile").click();
$("gLoadFile").onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const d = JSON.parse(r.result);
      if(!d.coef || !Array.isArray(d.sets)) throw new Error("この形式ではありません");
      store = d; saveStore();
      if(feats){ prob = RallyModel.predict(feats, activeModel()); recompute(); }
      $("gNote").hidden = false; $("gNote").textContent = "自分用の判定器を読み込みました。";
      refreshGrow();
    }catch(err){
      $("gNote").hidden = false; $("gNote").textContent = "読み込めませんでした：" + err.message;
    }
  };
  r.readAsText(f);
};
$("gReset").onclick = () => {
  store = null;
  try{ localStorage.removeItem(STORE_KEY); }catch(e){}
  if(feats){ prob = RallyModel.predict(feats, activeModel()); recompute(); }
  $("gNote").hidden = false; $("gNote").textContent = "土台の判定器に戻しました。教えた内容は消えています。";
  refreshGrow();
};

loadStore();
