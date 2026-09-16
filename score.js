// ラリー判定器：Pythonで学習した重みを使って、1フレームごとの「ラリー確率」を出す
// features: [{t, n, scale, wrist, elbow, ankle, shoulder, center, all}, ...] 時刻順
// model: model.json の中身
(function (root) {

  function rollStats(a, w) {
    // 中央ぞろえの移動平均・最大・標準偏差（NaNは飛ばす）
    const n = a.length, h = w >> 1;
    const mean = new Float64Array(n), max = new Float64Array(n), std = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1);
      let s = 0, s2 = 0, c = 0, mx = -Infinity;
      for (let j = lo; j < hi; j++) {
        const v = a[j];
        if (!isFinite(v)) continue;
        s += v; s2 += v * v; c++;
        if (v > mx) mx = v;
      }
      if (c === 0) { mean[i] = NaN; max[i] = NaN; std[i] = NaN; }
      else {
        const m = s / c;
        mean[i] = m; max[i] = mx;
        std[i] = Math.sqrt(Math.max(0, s2 / c - m * m));
      }
    }
    return { mean, max, std };
  }

  function buildMatrix(features, model) {
    const BASE = model.base, WIN = model.windows, n = features.length;
    // 生の8列
    const cols = BASE.map(k => {
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = Number(features[i][k]);
      return a;
    });
    // 使えないフレーム（人が写っていない／全部0）
    const bad = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 2; j < BASE.length; j++) s += Math.abs(cols[j][i]);
      bad[i] = (cols[0][i] === 0 || s === 0) ? 1 : 0;
    }
    for (let i = 0; i < n; i++) if (bad[i]) for (let j = 1; j < BASE.length; j++) cols[j][i] = NaN;

    const out = [];
    for (let j = 0; j < BASE.length; j++) {
      out.push(cols[j]);
      for (const w of WIN) {
        const r = rollStats(cols[j], w);
        out.push(r.mean, r.max, r.std);
      }
    }
    out.push(bad);
    out.push(rollStats(bad, 13).mean);
    return out; // 列ごとの配列（82本）
  }

  function predict(features, model) {
    const cols = buildMatrix(features, model);
    const n = features.length, D = model.coef.length;
    if (cols.length !== D) throw new Error("特徴の数が合いません: " + cols.length + " ≠ " + D);
    const prob = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let z = model.intercept;
      for (let j = 0; j < D; j++) {
        let v = cols[j][i];
        if (!isFinite(v)) v = model.median[j];   // 欠けていたら学習時の中央値で埋める
        z += model.coef[j] * ((v - model.mean[j]) / model.scale[j]);
      }
      prob[i] = 1 / (1 + Math.exp(-z));
    }
    return prob;
  }

  // 確率の列 → ラリー区間 [[開始,終了],...]
  function toSegments(prob, times, opt) {
    const o = Object.assign({ smooth: 13, threshold: 0.55, mergeGap: 1.0, minDuration: 1.5 }, opt || {});
    const n = prob.length, h = o.smooth >> 1;
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {           // numpy convolve(mode='same') と同じ＝端は0で埋める
      let s = 0;
      for (let k = -h; k <= h; k++) { const j = i + k; if (j >= 0 && j < n) s += prob[j]; }
      sm[i] = s / o.smooth;
    }
    // 残す割合が指定されていれば、その動画自身の点数の分布からしきい値を決める
    if (o.keepPercent) {
      const sorted = Array.from(sm).sort((a, b) => a - b);
      const q = Math.min(0.999, Math.max(0.001, 1 - o.keepPercent / 100));
      const pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
      o.threshold = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);   // numpyのpercentileと同じ
    }
    const raw = [];
    let i = 0;
    while (i < n) {
      if (sm[i] >= o.threshold) {
        let j = i; while (j < n && sm[j] >= o.threshold) j++;
        raw.push([times[i], times[Math.min(j, n - 1)]]); i = j;
      } else i++;
    }
    const merged = [];
    for (const [a, b] of raw) {
      if (merged.length && a - merged[merged.length - 1][1] < o.mergeGap) merged[merged.length - 1][1] = b;
      else merged.push([a, b]);
    }
    return merged.filter(x => x[1] - x[0] >= o.minDuration);
  }

  const api = { predict, buildMatrix, toSegments };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RallyModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
