const {
  useState,
  useEffect,
  useRef
} = React;

// ═══════════════════════════════════════════════════════
//  薬液調合ノート v8
//  ・圃場マスタ(永続)+ 日付ごとの作業リスト
//  ・圃場の検索/編集/並べ替え/合計表示
//  ・まとめ散布(複数圃場を1件の実績として記録)
//  ・薬剤マスタ(自動登録・呼び出し)
//  ・チームコードによる端末間データ共有
// ═══════════════════════════════════════════════════════

// 表示用のアプリ版数。更新を配布するときは sw.js の CACHE_VERSION も同じ番号に上げる
// (キャッシュが切り替わらないと、画面の版数だけ新しくなって中身が古いままになる)
const APP_VERSION = "v8.63";
// GASのウェブアプリURLの形。ここから外れた先へ送ると、防除記録(圃場名・作物・
// 薬剤・記録者名・圃場の緯度経度)が第三者のサーバーへ渡ってしまう。
// ただし一致しないURLの保存を止めることはしない。Googleが将来URLの形を変えたとき、
// 正しいURLを保存できずアプリが使えなくなるほうが害が大きいため、警告に留める。
const GAS_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
// 地図ラベル(LeafletのTooltipはHTML文字列として解釈されるため、
// 圃場名・作物名に記号が含まれてもタグとして実行されないようエスケープする)
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[ch]);
}
// 薬剤マスタに上限が登録されていないときに使う、農薬使用回数の既定上限
const CHEM_LIMIT_DEFAULT = 3;
const SWATCHES = ["#C74E36", "#B78A1F", "#6A5ACD", "#2E7D4F", "#A34D7C", "#3B7EA1", "#7A6A4F", "#4F7A6A"];
const FORMS = [{
  key: "wp",
  label: "水和剤",
  order: 2
}, {
  key: "wg",
  label: "顆粒水和剤(DF)",
  order: 3
}, {
  key: "sc",
  label: "フロアブル(ゾル)",
  order: 4
}, {
  key: "sp",
  label: "水溶剤",
  order: 5
}, {
  key: "sg",
  label: "顆粒水溶剤",
  order: 6
}, {
  key: "ec",
  label: "乳剤",
  order: 7
}, {
  key: "ew",
  label: "EW(エマルション)",
  order: 8
}, {
  key: "me",
  label: "マイクロエマルション",
  order: 9
}, {
  key: "sl",
  label: "液剤",
  order: 10
}, {
  key: "oil",
  label: "油剤",
  order: 11
}, {
  key: "gr",
  label: "粒剤",
  order: 12
}, {
  key: "dl",
  label: "粉剤(DL)",
  order: 13
}, {
  key: "jumbo",
  label: "豆つぶ・ジャンボ剤",
  order: 14
}, {
  key: "paste",
  label: "ペースト剤",
  order: 15
}, {
  key: "sti",
  label: "展着剤",
  order: 16
}, {
  key: "etc",
  label: "その他",
  order: 17
}];
const formLabel = k => (FORMS.find(f => f.key === k) || {}).label || "その他";
const formOrder = k => (FORMS.find(f => f.key === k) || {}).order || 17;

// 用途(農薬の種類)
const USES = [{
  key: "fungicide",
  label: "殺菌剤"
}, {
  key: "insecticide",
  label: "殺虫剤"
}, {
  key: "fung_insect",
  label: "殺虫殺菌剤"
}, {
  key: "herbicide",
  label: "除草剤"
}, {
  key: "growth",
  label: "植物成長調整剤"
}, {
  key: "spreader",
  label: "展着剤"
}, {
  key: "fertilizer",
  label: "葉面散布肥料"
}, {
  key: "other",
  label: "その他"
}];
const useLabel = k => (USES.find(u => u.key === k) || {}).label || "";
const fmt = (n, d = 1) => !isFinite(n) ? "—" : n % 1 === 0 ? n.toLocaleString("ja-JP") : n.toLocaleString("ja-JP", {
  maximumFractionDigits: d
});
// mL を L にして表示する。共有データから来た作業には水量が入っていないことが
// あり、そのまま割ると画面に「水 NaN L」と出てしまうので fmt と同じ扱いにする。
const fmtL = ml => {
  const l = ml / 1000;
  return !isFinite(l) ? "—" : l.toLocaleString("ja-JP", {
    maximumFractionDigits: 3
  });
};

// ── 単位系 ──
// 内部データは常に a(面積)・L(液量)で保持し、表示時のみ変換する
const AREA_UNITS = [{
  key: "a",
  label: "a(アール)",
  perA: 1,
  digits: 2
}, {
  key: "ha",
  label: "ha(ヘクタール)",
  perA: 0.01,
  digits: 3
}, {
  key: "tan",
  label: "反",
  perA: 0.1,
  digits: 2
}, {
  key: "cho",
  label: "町",
  perA: 0.01,
  digits: 3
}];
const VOL_UNITS = [{
  key: "L",
  label: "L(リットル)",
  perL: 1,
  digits: 2
}, {
  key: "mL",
  label: "mL(ミリリットル)",
  perL: 1000,
  digits: 0
}, {
  key: "kg",
  label: "kg(キログラム)",
  perL: 1,
  digits: 2
}, {
  key: "g",
  label: "g(グラム)",
  perL: 1000,
  digits: 0
}];
const areaUnit = k => AREA_UNITS.find(u => u.key === k) || AREA_UNITS[0];
const volUnit = k => VOL_UNITS.find(u => u.key === k) || VOL_UNITS[0];
// a値 → 表示文字列(単位記号なし)
const dispArea = (aVal, unitKey) => {
  const u = areaUnit(unitKey);
  const v = (parseFloat(aVal) || 0) * u.perA;
  return fmt(v, u.digits);
};
const areaSuffix = unitKey => ({
  a: "a",
  ha: "ha",
  tan: "反",
  cho: "町"
})[unitKey] || "a";
// ポリゴン(緯度経度[[lat,lng],...])の測地線面積を計算してa(アール)で返す
const polygonAreaA = latlngs => {
  if (!Array.isArray(latlngs) || latlngs.length < 3) return 0;
  const R = 6378137; // 地球半径(m)
  const toRad = d => d * Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    sum += toRad(p2[1] - p1[1]) * (2 + Math.sin(toRad(p1[0])) + Math.sin(toRad(p2[0])));
  }
  const areaM2 = Math.abs(sum * R * R / 2);
  return areaM2 / 100; // 1a = 100㎡
};
// 2つの線分が交わるか(端点で触れているだけは交差とみなさない)。
// 緯度経度をそのまま平面座標として扱う。1枚の圃場程度の範囲では歪みより
// 「交差しているか否か」の判定が変わることはない。
const segIntersects = (a1, a2, b1, b2) => {
  const cross = (o, p1, p2) => (p1[1] - o[1]) * (p2[0] - o[0]) - (p1[0] - o[0]) * (p2[1] - o[1]);
  const d1 = cross(b1, b2, a1),
    d2 = cross(b1, b2, a2),
    d3 = cross(a1, a2, b1),
    d4 = cross(a1, a2, b2);
  return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
};
// ポリゴンの辺どうしが交差しているか(蝶ネクタイ形などのねじれ)。
// polygonAreaA は符号付き面積の合計なので、ねじれた図形では正負が打ち消し合い、
// 実際よりはるかに小さい値(交点が中央なら 0)を返す。その面積は
// 予定薬液量(面積/10 x 散布量)や AgriNote 転記にそのまま流れるため、
// 登録前にここで検出して止める。
const polygonSelfIntersects = pts => {
  if (!Array.isArray(pts) || pts.length < 4) return false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 隣り合う辺は端点を共有するので除外する(最後の辺と最初の辺も隣同士)
      if (j === i + 1 || i === 0 && j === n - 1) continue;
      if (segIntersects(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
};
// ポリゴンの重心(中心座標)
const polygonCenter = latlngs => {
  if (!Array.isArray(latlngs) || latlngs.length === 0) return null;
  let lat = 0,
    lng = 0;
  // 数値に直してから足す。文字列のまま + すると連結されてしまい、
  // 中心が実在しない場所になって「ナビ」が見当違いの所へ案内する。
  // polygonAreaA は引き算なので自動で数値化されており、そちらと挙動を揃える。
  latlngs.forEach(p => {
    lat += Number(p[0]);
    lng += Number(p[1]);
  });
  return [lat / latlngs.length, lng / latlngs.length];
};
// ねじれ(蝶ネクタイ形)を、頂点の並べ替えだけで直す。座標そのものは1つも動かさない。
//
// ねじれる原因は回り方(時計回り/反時計回り)ではなく、外周をたどる順に打っていない
// ことにある。実測で、同じ四角形を時計回り・反時計回りのどちらで打っても
// polygonSelfIntersects の判定は false で一致する。交差するのは、たとえば
// 左 → 右上 → 左下 → 右 のように、周を一周せず行き来する順で打ったとき。
//
// 重心から見た角度の順に並べ直すと、その並びは必ず一周する順になる。
//
// ただし万能ではない。大きくへこんだ(凹んだ)圃場では、角度順が本人の意図した
// 形と変わることがある。そのため自動では適用せず、ボタンを押したときだけ実行し、
// 履歴に積んで「↩ 1つ戻す」で戻せるようにしている。
// 直しきれなかった場合(並べ替えてもまだ交差する)は呼び出し側で断ること。
const untwistPts = pts => {
  if (!Array.isArray(pts) || pts.length < 4) return pts;
  const c = polygonCenter(pts);
  if (!c) return pts;
  // 経度は緯度が上がるほど実距離が縮む。cos で補正しないと、南北に細長い圃場で
  // 角度が歪んで並び順を間違える
  const k = Math.cos(c[0] * Math.PI / 180) || 1;
  return pts.map((pt, i) => ({
    pt,
    i,
    a: Math.atan2(pt[0] - c[0], (pt[1] - c[1]) * k)
  })).sort((x, y) => x.a - y.a || x.i - y.i) // 同じ角度なら元の順を保つ(並びが毎回変わらないように)
  .map(x => x.pt);
};


// 緯度経度を小数第9位に丸める。
// 地図から受け取る座標は倍精度のままなので 35.68123456789012 のような
// 17桁になり、1頂点で39文字前後を食う。圃場を数十枚登録すると、それだけで
// チーム共有データがスプレッドシート1セルの上限(5万文字)を超えてしまい、
// 「データが大きすぎます」で保存できなくなる。
//
// 桁数は面積のずれから決めている(現実的な圃場3,000枚で実測):
//   7桁 … 最大 0.0147a ずれ、26.3% の圃場で 0.01a 単位の表示が変わる
//   8桁 … 最大 0.0018a ずれ、 3.3%
//   9桁 … 最大 0.0002a ずれ、 0.3%
// 面積は散布量の計算とアグリノート転記に流れる数値なので、
// 丸めのせいで動いてよい値ではない。容量(削減率26%)より、ずれないことを優先する。
const GEO_DIGITS = 1e9;
const roundGeo = n => Math.round(Number(n) * GEO_DIGITS) / GEO_DIGITS;
const roundPts = pts => Array.isArray(pts) ? pts.map(p => [roundGeo(p[0]), roundGeo(p[1])]) : pts;
// 地図に出す面積の文字列。
// 「圃場に登録された面積」を使う。散布量の計算・作業タブ・アグリノート転記で
// 使われるのはこの値なので、地図だけポリゴンから計算し直した別の数字を出すと、
// 同じ圃場に2つの面積が見えることになる(データベースで面積を手直しすると必ずずれた)。
// 単位設定(a/ha/反/町)も他の画面と揃える。以前は "a" 固定で、
// 反や町に設定していても地図だけアール表示のままだった。
// 名前の末尾にある数字を読む。「嘉島①」も「嘉兒52」も同じやり方で扱えるよう、
// 先に NFKC を通す(丸数字①はNFKCで "1" になる)。数字がなければ null。
const nameNumber = name => {
  const m = String(name || "").normalize("NFKC").match(/(\d+)\D*$/);
  return m ? parseInt(m[1], 10) : null;
};
// 地区の名前から、連番の接頭辞の初期値を探す。
// 全件の共通部分を取ると、別の名前が1件混ざっているだけで空になる。
// 末尾の数字を落とした形で数えて、一番多いものを使う。
const commonNamePrefix = names => {
  const count = new Map();
  (names || []).forEach(n => {
    const base = String(n || "").normalize("NFKC").replace(/[\d\s\-_.]+\D*$/, "").trim();
    if (!base) return;
    count.set(base, (count.get(base) || 0) + 1);
  });
  let best = "",
    n = 0;
  count.forEach((v, k) => {
    if (v > n) {
      n = v;
      best = k;
    }
  });
  return best;
};

const fieldAreaText = (f, unitKey) => {
  const a = f && f.areaA;
  if (a === "" || a == null || !(parseFloat(a) > 0)) return "面積未設定";
  return dispArea(a, unitKey) + " " + areaSuffix(unitKey);
};
// 登録面積と、囲んだ形から計算した面積が食い違っているか。
// 地図が登録面積を出すようになったぶん、ずれが黙って隠れないよう一覧で知らせる。
// 食い違う理由は「データベースで面積だけ手で直した」場合がほとんど。
const measuredAreaIfOff = f => {
  const a = parseFloat(f && f.areaA);
  if (!(a > 0) || !Array.isArray(f.polygon) || f.polygon.length < 3) return null;
  const m = polygonAreaA(f.polygon);
  if (!(m > 0)) return null;
  return Math.abs(m - a) / a >= 0.01 ? m : null; // 1%以上のずれだけ出す
};
// 圃場1件ぶんの座標をまとめて丸める(ポリゴンと中心座標)
const compactField = f => {
  if (!f || !Array.isArray(f.polygon)) return f;
  return {
    ...f,
    polygon: roundPts(f.polygon),
    center: Array.isArray(f.center) ? [roundGeo(f.center[0]), roundGeo(f.center[1])] : f.center
  };
};
// ---- 作図中の頂点編集ヘルパ(地図ライブラリに依存しない純関数) ----
// Google版・Leaflet版の両方から同じロジックを使うため、ここに切り出してある
const DRAW_HISTORY_MAX = 50; // 作図中しか持たない履歴。際限なく溜めない
// i番目の頂点を動かした配列を返す
const ptsMove = (pts, i, lat, lng) => pts.map((q, qi) => qi === i ? [lat, lng] : q);
// i番目の頂点を消した配列を返す
const ptsRemove = (pts, i) => pts.filter((q, qi) => qi !== i);
// 辺edgeIndex(頂点edgeIndexと次の頂点の間)に頂点を差し込む。
// 末尾の辺は「最後→最初」なので splice(length,...) となり結果的に末尾追加になる
const ptsInsert = (pts, edgeIndex, lat, lng) => {
  const next = pts.slice();
  next.splice(edgeIndex + 1, 0, [lat, lng]);
  return next;
};
// 各辺の中点。2点のときは辺が1本だけ、3点以上は「最後→最初」の辺も含める。
// 0〜1点のときは辺が無いので空配列
const drawMidpoints = pts => {
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const edges = pts.length === 2 ? 1 : pts.length;
  const out = [];
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const lat = (parseFloat(a[0]) + parseFloat(b[0])) / 2;
    const lng = (parseFloat(a[1]) + parseFloat(b[1])) / 2;
    if (!isFinite(lat) || !isFinite(lng)) continue; // 壊れた座標では中点を出さない
    out.push({
      edge: i,
      lat,
      lng
    });
  }
  return out;
};
// 履歴に1手積む。上限を超えたら古いものから捨てる
const pushDrawHistory = (stack, pts) => {
  const next = stack.concat([pts]);
  return next.length > DRAW_HISTORY_MAX ? next.slice(next.length - DRAW_HISTORY_MAX) : next;
};
// スマホの地図アプリでナビを開くURL(現在地→目的地)
const naviUrl = center => center ? "https://www.google.com/maps/dir/?api=1&destination=" + center[0] + "," + center[1] + "&travelmode=driving" : "#";
// 圃場から目的地の座標を得る。center が未設定でもポリゴンがあれば重心を使う
// (作業タブは resolveWork が圃場マスタの実体を返すため、そのまま渡せる)
const fieldCenter = f => f ? f.center || polygonCenter(f.polygon) : null;
// ナビボタン。座標が無い圃場でもボタン自体は出して登録方法を案内する。
// href="#" だと画面が飛んでしまうので、座標が無いときは a ではなく button にする
const naviLink = (center, style, label) => center ? /*#__PURE__*/React.createElement("a", {
  href: naviUrl(center),
  target: "_blank",
  rel: "noopener noreferrer",
  style: style
}, label) : /*#__PURE__*/React.createElement("button", {
  type: "button",
  onClick: () => alert("この圃場はまだ地図に登録されていません。地図タブの「✏ 圃場を囲む」で位置を登録するとナビが使えます。"),
  style: {
    ...style,
    border: "none",
    cursor: "pointer",
    opacity: .45
  }
}, label);
// L値 → 表示文字列(単位記号なし)
const dispVol = (lVal, unitKey) => {
  const u = volUnit(unitKey);
  const v = (parseFloat(lVal) || 0) * u.perL;
  return fmt(v, u.digits);
};
const volSuffix = unitKey => ({
  L: "L",
  mL: "mL",
  kg: "kg",
  g: "g"
})[unitKey] || "L";
// 散布車のタンク1杯で回れる圃場を割り出す純関数。
// works には「その日の未実施の圃場」を回る順番どおりに渡す(実績入力済みは散布も補給も
// 済んでいる前提なので数えない)。戻り値は work.id をキーにした辞書:
//   { planned, cum, tankNo, over, refill }
//   cum    … その杯の中での累計(この圃場ぶんを含む)
//   over   … その圃場1つだけでタンク容量を超える
//   refill … この圃場の手前に補給の区切りを出す場合だけ {tankNo, usedL, capL}
// 結果を state に持たず描画のたびに呼ぶ想定。並べ替え・追加削除・実績入力に自動追従する。
function planTankRefills(works, capacityL) {
  const cap = parseFloat(capacityL);
  // 空欄・0・負数・数値でない入力のときはタンク容量の機能を使わない(累計だけ出す)
  const useCap = isFinite(cap) && cap > 0;
  const info = {};
  let cum = 0;
  let tankNo = 1;
  (works || []).forEach(w => {
    const v = parseFloat(w.plannedL);
    // 投下量が未計算の圃場は 0 として扱う(未入力の警告は既存のバナーが担当する)
    const planned = isFinite(v) && v > 0 ? v : 0;
    // cum が 0 のときは区切らない。1圃場だけで容量を超える場合でも必ず前へ進むので無限ループにならない
    const needsRefill = useCap && planned > 0 && cum > 0 && cum + planned > cap;
    let refill = null;
    if (needsRefill) {
      refill = {
        tankNo: tankNo,
        usedL: cum,
        capL: cap
      };
      tankNo += 1;
      cum = 0;
    }
    cum += planned;
    info[w.id] = {
      planned: planned,
      cum: cum,
      tankNo: tankNo,
      over: useCap && planned > cap,
      refill: refill
    };
  });
  return info;
}
const today = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
// 受け取った日付を "yyyy-MM-dd" に揃える。
// スプレッドシートは "2026-08-26" をセルに入れた時点で日付として解釈するため、
// 版によっては "Wed Aug 26 2026 ..." や ISO 文字列で返ってくることがある。
// そのまま作業に入れると「その日の作業(workDate === 選んでいる日)」に
// 一致せず、本日の圃場が一覧から消える。ここで必ず通す。
const ymd = v => {
  const t = String(v == null ? "" : v).trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const shiftDate = (dateStr, days) => {
  const parts = dateStr.split("-").map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
};
const dateLabel = dateStr => {
  const parts = dateStr.split("-").map(Number);
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
  return parts[1] + "月" + parts[2] + "日(" + w + ")";
};
let uid = 100;
const newChem = () => ({
  id: uid++,
  name: "",
  form: "sc",
  use: "fungicide",
  ratio: ""
});
const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
};

// ── 端末ID ──
// 「どの端末が書いたか」を残すための識別子。記録者名は同じ名前を複数台に
// 入れられるうえ後から変えられるので、送信元の区別には使えない。
// 認証ではないので乱数の質は問わない(認証は合言葉が担う)。
const deviceId = (() => {
  let v = "";
  try {
    v = localStorage.getItem("tankmix:deviceid") || "";
    if (!v) {
      v = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("tankmix:deviceid", v);
    }
  } catch (e) {
    // プライベートブラウズ等で localStorage が使えない端末。
    // その場で作った値を使う(起動のたびに変わるが、送信自体は通る)
    v = "d-tmp-" + Math.random().toString(36).slice(2, 8);
  }
  return v;
})();

// 同期の時刻はすべて ISO8601 の文字列で持つ。文字列にしておくと辞書順の比較が
// そのまま時刻の比較になり、サーバー側(GAS)と同じ判定が書ける。
const nowIso = () => new Date().toISOString();

// ── 変わったレコードにだけ updatedAt を打つ ──
// 保存のたびに配列全体へ現在時刻を入れると、触っていないレコードまで
// 「自分のほうが新しい」と主張してしまい、他の端末の変更を踏み潰す。
// 前の配列と中身を比べ、実際に変わったものだけに時刻を入れる。
// updatedAt / pushedAt は比較から除く(これ自体が変わったことを変更と数えると
// 保存のたびに時刻が進み続けて止まらない)。
const SYNC_META = ["updatedAt", "pushedAt"];
const syncFingerprint = o => {
  const c = {};
  Object.keys(o).sort().forEach(k => {
    if (SYNC_META.indexOf(k) < 0) c[k] = o[k];
  });
  return JSON.stringify(c);
};
const stampUpdated = (next, prev) => {
  const before = new Map((prev || []).map(x => [x.id, x]));
  const at = nowIso();
  return next.map(x => {
    const old = before.get(x.id);
    if (old && syncFingerprint(old) === syncFingerprint(x)) {
      // 中身が同じなら時刻は動かさない。ただし「動かさない」は
      // 「渡された値をそのまま使う」ではない。古い配列を元に保存されると
      // updatedAt が過去へ戻り、pushedAt のほうが新しいという状態ができる。
      // そうなると一度送信した時点で updatedAt === pushedAt になってしまい、
      // 中身が違うのに送信済みと判定されて、サーバーとの食い違いが永久に固まる。
      // 保存されている側の時刻を正とする。
      return {
        ...x,
        updatedAt: old.updatedAt || x.updatedAt || at,
        pushedAt: old.pushedAt
      };
    }
    return {
      ...x,
      updatedAt: at
    };
  });
};

// ── 削除の墓標(トゥームストーン) ──
// 端末Aで消しただけでは、端末Bは「自分が持っている＝まだある」としか判断できず、
// 次の同期で消したはずのものが復活する。消したという事実そのものを送るために、
// IDと時刻だけを残す。実データは消えるので容量は増えない。
// 薬剤のIDは「名前を正規化した文字列」。薬剤はもともと名前が主キーで、
// 別の端末で同じ薬剤を登録しても同じIDになる必要がある。
// 連番や乱数を使うと、同じ薬剤が2件に分裂して戻らなくなる。
const chemIdOf = c => normalizeChemName(c.name || "");
// 旧バージョンで登録した薬剤にIDと時刻を付ける(起動時に1度だけ)。
// 付けないと pendingOf に拾われず、一度も共有されないままになる。
const migrateChems = list => (Array.isArray(list) ? list : []).map(c => c.id && c.updatedAt ? c : {
  ...c,
  id: c.id || chemIdOf(c),
  updatedAt: c.updatedAt || nowIso()
});

// 自動取得の間隔として選べる値(秒)。0は「自動で取らない」。
const PULL_SEC_CHOICES = [0, 10, 15, 30, 60, 180];
const PULL_SEC_LABELS = {
  0: "自動で取らない(手動だけ)",
  10: "10秒ごと",
  15: "15秒ごと",
  30: "30秒ごと",
  60: "1分ごと",
  180: "3分ごと"
};

const TOMB_KEY = "tankmix:tombs";
const TOMB_MAX = 500; // 古い墓標から捨てる。復活は「同期していない端末が残っていた」時だけ起きる
const loadTombs = () => {
  const t = load(TOMB_KEY, {
    fields: [],
    works: [],
    chems: []
  });
  return {
    fields: Array.isArray(t.fields) ? t.fields : [],
    works: Array.isArray(t.works) ? t.works : [],
    chems: Array.isArray(t.chems) ? t.chems : []
  };
};
const addTomb = (kind, ids) => {
  const t = loadTombs();
  const at = nowIso();
  const seen = new Set(t[kind].map(x => String(x.id)));
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    if (seen.has(String(id))) return;
    seen.add(String(id));
    t[kind].push({
      id,
      updatedAt: at,
      deleted: true
    });
  });
  if (t[kind].length > TOMB_MAX) t[kind] = t[kind].slice(t[kind].length - TOMB_MAX);
  save(TOMB_KEY, t);
};

// 一意なID発行。Date.now()+乱数だと、地区からの一括投入のように同じミリ秒で
// 複数まとめて作るときIDが衝突し、別の圃場を書き換えてしまう事故が起きるため、
// 必ず前回より大きい値を返すカウンタ方式にしている。
let __lastId = 0;
const newId = () => {
  const t = Date.now();
  __lastId = t > __lastId ? t : __lastId + 1;
  return __lastId;
};

// v7以前のデータ移行(records → fields + works)
const migrate = () => {
  if (localStorage.getItem("tankmix:works") || !localStorage.getItem("tankmix:records")) return;
  try {
    const old = JSON.parse(localStorage.getItem("tankmix:records")) || [];
    const fields = [];
    const works = [];
    old.forEach(r => {
      let f = fields.find(x => x.name === r.field);
      if (!f) {
        f = {
          id: newId(),
          name: r.field || "(未入力)",
          crop: r.crop || "",
          areaA: r.areaA || ""
        };
        fields.push(f);
      }
      works.push({
        id: r.id,
        workDate: r.date || today(),
        fieldId: f.id,
        snapshot: {
          name: f.name,
          crop: f.crop,
          areaA: f.areaA
        },
        plannedL: 0,
        chems: r.chems || [],
        totalL: r.totalL || 0,
        waterMl: r.waterMl || 0,
        memo: r.memo || "",
        reported: !!r.reported,
        sprayedL: r.sprayedL || 0,
        reportAreaA: r.reportAreaA || "",
        reportMemo: r.reportMemo || "",
        reportDate: r.reportDate || "",
        synced: !!r.synced,
        reportSynced: !!r.reportSynced
      });
    });
    save("tankmix:fields", fields);
    save("tankmix:works", works);
  } catch (e) {
    console.error("migrate failed", e);
  }
};
migrate();

// v8.51 への移行:同期のために updatedAt を持たせる。
// 持っていないレコードは「この端末で、いまこの形になった」とみなす。
// これをやらないと、既にある圃場・作業が「変わっていない」と判定されて
// 一度も送られず、進捗マップにも出ない。
const migrateSync = () => {
  if (localStorage.getItem("tankmix:syncmigrated")) return;
  localStorage.setItem("tankmix:syncmigrated", "1");
  const at = nowIso();
  ["tankmix:fields", "tankmix:works"].forEach(k => {
    const list = load(k, []);
    if (!Array.isArray(list) || list.length === 0) return;
    save(k, list.map(x => x && x.updatedAt ? x : {
      ...x,
      updatedAt: at
    }));
  });
};
migrateSync();

// ═══════════════════ メイン ═══════════════════
function App() {
  const [tab, setTab] = useState("calc");
  // navigator.onLine が無い環境(古いWebView)ではオンライン扱いにする。
  // 分からないときに「オフライン」と出すと、実際には送れているのに
  // 送れていないと思わせることになる。
  // 自動取得の間隔(秒)。短いほど手元に早く出るが、GASの実行回数は増える。
  // 公式の上限(2026-08確認)は 1回の実行=最長6分 / 同時実行=1ユーザー30。
  // 「90分/日・6時間/日」はトリガーの合計実行時間であって、ウェブアプリの
  // 呼び出しには当たらない。ウェブアプリの1日の呼び出し回数の上限は公式の表には
  // 載っていないが、無制限という根拠もないので既定は30秒にしてある。
  const [pullSec, setPullSecState] = useState(() => {
    const v = parseInt(localStorage.getItem("tankmix:pullsec") || "", 10);
    return PULL_SEC_CHOICES.indexOf(v) >= 0 ? v : 30;
  });
  const setPullSec = v => {
    const n = PULL_SEC_CHOICES.indexOf(Number(v)) >= 0 ? Number(v) : 30;
    setPullSecState(n);
    localStorage.setItem("tankmix:pullsec", String(n));
  };
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  // 地図タブは一度開いたら、他のタブへ移っても display:none で残しておく。
  // Googleマップは地図を作り直すたびに課金対象(Map load)になるため、タブを
  // 行き来するだけで回数が増えないようにする。無料地図でも再読み込みが減る。
  // 一度も開いていないうちは作らない(開かない人に地図を読み込ませないため)。
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    if (tab === "map") setMapMounted(true);
  }, [tab]);
  // 進捗マップは作業タブの中(一覧/地図の切替)に入れた。タブを分けていたときは
  // 「今日の作業」を見るのに2つのタブを行き来することになり、現場で見づらかった。
  // 作業タブから離れると地図は作り直されるが、タイルはブラウザのキャッシュから
  // 出るのと、取得内容は localStorage に残しているので、取り直しは起きない。
  const [toast, setToast] = useState("");
  const [mode, setMode] = useState("direct");
  const [totalL, setTotalL] = useState("10");
  const [areaA, setAreaA] = useState("30");
  const [ratePer10a, setRatePer10a] = useState("10");
  const [chems, setChems] = useState([{
    id: 1,
    name: "",
    form: "sc",
    use: "fungicide",
    ratio: ""
  }]);
  const [fields, setFields] = useState(() => load("tankmix:fields", []));
  const [works, setWorks] = useState(() => {
    // 既に日付が化けた状態で保存されている端末を直す。
    // ここを通さないと、直した版を入れても「本日の作業が消えたまま」になる。
    const cur = load("tankmix:works", []);
    let fixed = 0;
    const next = (Array.isArray(cur) ? cur : []).map(w => {
      const d = ymd(w.workDate);
      const r = ymd(w.reportDate);
      if (d === (w.workDate || "") && r === (w.reportDate || "")) return w;
      fixed++;
      return {
        ...w,
        workDate: d,
        reportDate: r
      };
    });
    if (fixed) save("tankmix:works", next);
    return next;
  });
  const [chemMaster, setChemMaster] = useState(() => {
    const cur = load("tankmix:chemmaster", []);
    const next = migrateChems(cur);
    // 端末に保存されている側にも書き戻す。送信の判定(pendingOf)は
    // 保存済みの内容を見るので、画面の中だけIDを付けても共有に乗らない。
    if (next.some((c, i) => c !== cur[i])) save("tankmix:chemmaster", next);
    return next;
  });
  const [lastMix, setLastMix] = useState(() => load("tankmix:lastmix", null));
  const [presets, setPresets] = useState(() => load("tankmix:presets", []));
  const [crops, setCrops] = useState(() => load("tankmix:crops", []));
  const [workDate, setWorkDate] = useState(today());
  // 作業タブで入力する「この日に使用した薬剤」。{date, chems:[{id,name,form,use,ratio}]}
  // タブを切り替えても消えないようApp側で持ち、localStorageにも保存する。
  const [dayMix, setDayMix] = useState(() => load("tankmix:daymix", null));
  const [gasUrl, setGasUrlState] = useState(() => localStorage.getItem("tankmix:gasurl") || "");
  const [recorder, setRecorderState] = useState(() => localStorage.getItem("tankmix:recorder") || "");
  const [teamCode, setTeamCodeState] = useState(() => localStorage.getItem("tankmix:teamcode") || "");
  const [syncing, setSyncing] = useState(false);
  // 農薬データ(IndexedDB)の状態。null = 未取り込み、{count, savedAt} = 取り込み済み
  const [chemDbInfo, setChemDbInfo] = useState(null);
  const [chemDbBusy, setChemDbBusy] = useState(false); // 取り込み中(ボタンの二重押し防止)
  const [chemDbProgress, setChemDbProgress] = useState(""); // 例: "3/4 パート"
  const syncingRef = useRef(false);
  const abortRef = useRef(false);
  const [syncProgress, setSyncProgress] = useState({
    done: 0,
    total: 0
  });
  const [areaUnitKey, setAreaUnitKeyState] = useState(() => localStorage.getItem("tankmix:areaunit") || "a");
  const [volUnitKey, setVolUnitKeyState] = useState(() => localStorage.getItem("tankmix:volunit") || "L");
  // 散布車の水タンク容量(L)。空欄にできるよう入力値は文字列のまま持ち、使う側で parseFloat する
  const [tankCapacityL, setTankCapacityLState] = useState(() => {
    const v = localStorage.getItem("tankmix:tankcap");
    return v === null ? "200" : v;
  });
  // 作期の開始日。この日以降の実績だけを農薬使用回数としてカウントする
  const [seasonStart, setSeasonStartState] = useState(() => localStorage.getItem("tankmix:seasonstart") || new Date().getFullYear() + "-01-01");
  const [mapEngine, setMapEngineState] = useState(() => localStorage.getItem("tankmix:mapengine") || "leaflet");
  // 共有パスワード。GAS側のスクリプトプロパティ SHARED_SECRET と同じ文字列を入れる。
  // これが合わないとGASが記録を受け付けない(GAS側が未設定なら従来どおり通る)
  const [authKey, setAuthKeyState] = useState(() => localStorage.getItem("tankmix:authkey") || "");
  const gasUrlWarnRef = useRef(null); // 送信先URLの形の警告を、入力が止まってから出すためのタイマー
  const authErrRef = useRef(false); // 共有パスワード違いを検出したか(後続の一般的な失敗メッセージで上書きしないため)
  const setAuthKey = v => {
    setAuthKeyState(v);
    localStorage.setItem("tankmix:authkey", v.trim());
  };
  const [gmapKey, setGmapKeyState] = useState(() => localStorage.getItem("tankmix:gmapkey") || "");
  const [gmapKeyInput, setGmapKeyInput] = useState(() => localStorage.getItem("tankmix:gmapkey") || "");
  const setMapEngine = v => {
    setMapEngineState(v);
    localStorage.setItem("tankmix:mapengine", v);
  };
  const saveGmapKey = v => {
    const trimmed = (v || "").trim();
    setGmapKeyState(trimmed);
    setGmapKeyInput(trimmed);
    localStorage.setItem("tankmix:gmapkey", trimmed);
    flash(trimmed ? "APIキーを保存しました" : "APIキーを削除しました");
  };
  // アプリを最新版に強制更新する。キャッシュとService Workerを破棄して読み直すため、
  // 「更新したのにスマホだけ古い画面のまま」という状態を確実に解消できる。
  // localStorage(圃場・作業記録・設定)には一切触らないのでデータは残る。
  const forceUpdate = async () => {
    if (!confirm("アプリを最新版に更新します。\n保存されているデータ(圃場・作業記録・設定)は消えません。\n\n電波のある場所で実行してください。よろしいですか？")) return;
    flash("最新版を確認しています…");
    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) {
      console.error(e);
    }
    if (typeof location !== "undefined" && location.reload) location.reload();
  };
  // 端末のtankmix:データをすべて消去(端末譲渡・売却前などに使用)。
  // 誤タップで即実行されないよう、確認ダイアログに加えて「消去」と入力させる二段階の確認にしている
  const eraseAllData = () => {
    if (!confirm("この端末に保存されているデータ(圃場・作業記録・APIキー・共有パスワードなど)をすべて消去します。\n送信済みの記録はスプレッドシート側に残ります。\nこの操作は取り消せません。よろしいですか？")) return;
    const input = prompt("最終確認です。よろしければ下の欄に「消去」と入力してください。");
    if (input === null) return;
    if (input.trim() !== "消去") {
      flash("入力が一致しなかったため、消去を中止しました");
      return;
    }
    Object.keys(localStorage).filter(k => k.startsWith("tankmix:")).forEach(k => localStorage.removeItem(k));
    if (typeof location !== "undefined" && location.reload) location.reload();
  };
  const setAreaUnitKey = v => {
    setAreaUnitKeyState(v);
    localStorage.setItem("tankmix:areaunit", v);
  };
  const setSeasonStart = v => {
    setSeasonStartState(v);
    localStorage.setItem("tankmix:seasonstart", v);
  };
  const setVolUnitKey = v => {
    setVolUnitKeyState(v);
    localStorage.setItem("tankmix:volunit", v);
  };
  const setTankCapacityL = v => {
    const s = String(v == null ? "" : v);
    setTankCapacityLState(s);
    localStorage.setItem("tankmix:tankcap", s);
  };
  const setGasUrl = v => {
    const t = v.trim();
    setGasUrlState(v);
    localStorage.setItem("tankmix:gasurl", t);
    // 打っている途中の文字列は当然一致しないので、入力が止まってから判定する
    if (gasUrlWarnRef.current) clearTimeout(gasUrlWarnRef.current);
    gasUrlWarnRef.current = setTimeout(() => {
      if (t && !GAS_URL_RE.test(t)) flash("⚠ Apps ScriptのURLの形ではありません。送信先を確認してください(誤ったURLだと記録が第三者のサーバーへ送られます)");
    }, 1200);
  };
  const setRecorder = v => {
    setRecorderState(v);
    localStorage.setItem("tankmix:recorder", v.trim());
  };
  const setTeamCode = v => {
    setTeamCodeState(v);
    localStorage.setItem("tankmix:teamcode", v.trim());
  };
  const flash = msg => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };
  // ── Raw と Save の使い分け ──
  // Save … 人がこの端末で編集したとき。変わったレコードに updatedAt を打つ
  // Raw  … 同期で受け取った内容を入れるとき、および送信済みフラグの書き戻し。
  //        ここで時刻を打つと、他の端末が入れた変更を自分の編集として
  //        主張し直すことになり、往復のたびに勝ち負けが入れ替わる
  const setFieldsRaw = next => {
    setFields(next);
    save("tankmix:fields", next);
  };
  const setWorksRaw = next => {
    setWorks(next);
    save("tankmix:works", next);
  };
  const setFieldsSave = next => setFieldsRaw(stampUpdated(next, fields));
  // ── 圃場を変えたら、その場で共有へ送る ──
  // v8.54までは設定タブの「🔁 圃場を同期」を押したときだけ送っていた。
  // 作図した本人は登録できたつもりでいるのに、押し忘れると他の端末には
  // 何も出ない。現場で気づけないので、進捗(散布済チェック)と同じく
  // 変えた時点で送る。圏外・未設定のときは黙って諦める。未送信のまま
  // 残るので、電波が戻ってから「🔁 圃場を同期」で送り直せる。
  //
  // 少し待ってから送るのは、全画面の連続作図で何枚も続けて登録されるため。
  // 1枚ごとにPOSTするとGASの実行回数が枚数ぶん増える。pushFieldsSync は
  // 未送信ぶんを全部まとめて送るので、待っている間の追加も同じ1回に乗る。
  const autoPushRef = useRef(null);
  const autoPushFields = () => {
    if (!syncReady()) return;
    if (autoPushRef.current) clearTimeout(autoPushRef.current);
    autoPushRef.current = setTimeout(async () => {
      autoPushRef.current = null;
      const ok = await pushFieldsSync({
        quiet: true
      });
      // 送った直後に取り直す。登録した端末でも、他の端末が
      // 入れた分がその場で揃う(次の拍子を待たない)。
      if (ok) {
        autoPullAtRef.current = 0;
        autoPullShared();
      }
    }, 1500);
  };
  // ── 受け取り側の自動取得 ──
  // 送る側が自動で送っても、受け取る側が取りに行かなければ画面には出ない。
  // 起動時に1回と、地図タブを開いたときに取りに行く。前回から60秒たって
  // いなければ省く(連打・タブの行き来でGASの実行回数を増やさない)。
  // 常時取りに行かないのは同じ理由。手で確かめたいときは設定タブの
  // 「🔁 圃場を同期」がこれまでどおり使える。
  const autoPushChemRef = useRef(null);
  const autoPushChems = () => {
    if (!syncReady()) return;
    if (autoPushChemRef.current) clearTimeout(autoPushChemRef.current);
    autoPushChemRef.current = setTimeout(() => {
      autoPushChemRef.current = null;
      pushChemsSync({
        quiet: true
      });
    }, 1500);
  };
  const autoPullAtRef = useRef(0);
  const autoPullShared = opt => {
    if (!syncReady()) return;
    // 間隔を0にしても、タブを開いたときの1回は取りに行く。
    // 開いても古いままだと、手動で押す場所を探すことになる。
    const wait = (opt && opt.tick ? pullSec : Math.min(pullSec || 30, 30)) * 1000;
    const now = Date.now();
    if (now - autoPullAtRef.current < wait) return;
    autoPullAtRef.current = now;
    pullSharedSync({
      quiet: true
    });
  };
  useEffect(() => {
    autoPullShared();
  }, []);
  useEffect(() => {
    // 作業タブでも取りに行く。他の端末が組んだその日の予定は、
    // 開いたときに入っていないと意味がない
    if (tab === "map" || tab === "work") autoPullShared();
  }, [tab]);
  // 作業日を切り替えたときも取り直す(明日の予定を見に行く場合)
  useEffect(() => {
    autoPullShared();
  }, [workDate]);
  // 開いている間は繰り返し取りに行く。v8.58までは「タブを開いた瞬間に1回」
  // だけだったので、作業タブを開きっぱなしにしていると、他の端末が
  // 入れた予定はタブを往復するまで出なかった。
  // 裏に回っている間は取りに行かない(ポケットの中で回し続けないため)。
  useEffect(() => {
    if (!pullSec) return;
    if (tab !== "work" && tab !== "map") return;
    // 入力の途中に割り込まない。投下量や薬剤を入れている間に
    // 受信が走ると、一覧の並びや中身が目の前で入れ替わる。
    // 見送っても次の拍子で取りに行くので、取りこぼしにはならない。
    const busy = () => {
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
      // ポップアップ(実績入力・圃場の編集など)を開いている間も待つ
      return !!document.querySelector("[data-modal]");
    };
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (busy()) return;
      autoPullShared({
        tick: true
      });
    };
    const id = setInterval(tick, pullSec * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tab, pullSec, workDate]);
  // 作業が変わったら自動で送る。v8.57までは「散布済」の入れ外しと
  // 実績の保存のときだけ送っていたため、作業リストへ圃場を入れても
  // 他の端末には何も出なかった。入れても・薬剤を当てても・外しても送る。
  const autoPushWorkRef = useRef(null);
  const autoPushWorks = () => {
    if (!syncReady()) return;
    if (autoPushWorkRef.current) clearTimeout(autoPushWorkRef.current);
    autoPushWorkRef.current = setTimeout(() => {
      autoPushWorkRef.current = null;
      pushProgress({
        quiet: true
      });
    }, 1500);
  };
  // 作業を触った経路は多い(追加・削除・並べ替え・薬剤の適用・実績)。
  // 呼び出しを全部に入れて回ると必ず入れ忘れるので、保存された
  // 結果を見て一ヶ所で送る。送るものが無ければ pushProgress は
  // 通信せずに戻るので、この形でもGASの実行回数は増えない。
  useEffect(() => {
    autoPushWorks();
  }, [works]);
  // その日の中で何番目かを作業自体に持たせる。
  // 送信のときに並びを数えるだけだと、入れ替えても作業の中身は
  // 変わらないので stampUpdated が時刻を進めず、未送信として拾われない。
  // stampUpdated より先に呼ぶこと。あとから書き込むと、時刻が進まないまま
  // 並びだけが変わって、この端末にしか反映されない。
  const withSeq = list => {
    const n = {};
    return list.map(w => {
      const d = w.workDate || "";
      const i = n[d] || 0;
      n[d] = i + 1;
      return w.seq === i ? w : {
        ...w,
        seq: i
      };
    });
  };
  const setWorksSave = next => setWorksRaw(stampUpdated(withSeq(next), works));
  // 描画時に閉じ込めた works は、再描画を待たずに続けて操作されると古くなる。
  // 古い配列を元に保存すると直前の変更が巻き戻る。チェックを続けて2つ入れると
  // 1つしか残らない、外したはずの実績が戻る、といった形で表に出る。
  // 進捗のように連打されうる操作は、必ず保存済みの内容から読み直す。
  const updateWorks = fn => {
    const cur = load("tankmix:works", []);
    setWorksRaw(stampUpdated(withSeq(fn(cur)), cur));
  };
  const setChemMasterSave = next => {
    // 圃場・作業と同じ仕組みに乗せる。変わったものだけ送るために
    // 編集時刻が要る(中身が同じなら stampUpdated が時刻を進めない)。
    const stamped = stampUpdated(next.map(c => ({
      ...c,
      id: c.id || chemIdOf(c)
    })), load("tankmix:chemmaster", []));
    setChemMaster(stamped);
    save("tankmix:chemmaster", stamped);
  };
  const setPresetsSave = next => {
    setPresets(next);
    save("tankmix:presets", next);
  };
  const setCropsSave = next => {
    setCrops(next);
    save("tankmix:crops", next);
  };
  const addCrop = name => {
    const n = (name || "").trim();
    if (!n || crops.includes(n)) return;
    setCropsSave([...crops, n]);
  };
  const deleteCrop = name => setCropsSave(crops.filter(c => c !== name));
  // 作業行の表示用の圃場情報。マスタが残っていればマスタを優先し(名前・面積の変更が
  // 作業タブへ即反映される)、マスタが消えている場合だけ登録時のスナップショットを使う。
  const resolveWork = w => {
    const f = fields.find(x => x.id === w.fieldId);
    return f || w.snapshot || {
      name: "(不明)",
      crop: "",
      areaA: ""
    };
  };
  const upsertField = (data, id) => {
    if (id) {
      setFieldsSave(fields.map(f => f.id === id ? {
        ...f,
        ...data
      } : f));
      // スナップショットも全作業(実績入力済みを含む)を追従させる。
      // マスタを消したときに古い名前へ戻ってしまうのを防ぐため。
      setWorksSave(works.map(w => w.fieldId === id ? {
        ...w,
        snapshot: {
          ...w.snapshot,
          ...data
        }
      } : w));
      flash("圃場情報を更新しました");
      autoPushFields();
      return id;
    }
    const f = {
      id: newId(),
      name: data.name,
      crop: data.crop || "",
      area: (data.area || "").trim(),
      areaA: data.areaA
    };
    setFieldsSave([...fields, f]);
    autoPushFields();
    return f.id;
  };
  const deleteField = id => {
    addTomb("fields", id); // 消したことを他の端末へ伝えるための墓標
    setFieldsSave(fields.filter(f => f.id !== id));
    flash("圃場をマスタから削除しました(過去の記録は残ります)");
    autoPushFields();
  };
  // 地区ごとの連番振り直し。1件ずつ upsertField を呼ぶと、古い fields を元に
  // 上書きし合って最後の1件しか残らないので、必ずまとめて処理する。
  const renameFields = pairs => {
    const list = (pairs || []).filter(x => x && x.id != null && x.name);
    if (!list.length) return 0;
    const byId = new Map(list.map(x => [x.id, x.name]));
    // 名前を振り直したら、一覧の並びもその番号順にする。
    // 名前だけ変えて並びを放置すると、番号が飛び飛びに並んで見づらい。
    // 対象外の圃場は位置を動かさない(対象のあった位置に、新しい順で入れ直す)。
    const slots = [];
    fields.forEach((f, i) => {
      if (byId.has(f.id)) slots.push(i);
    });
    const seq = list.map(x => fields.find(f => f.id === x.id)).filter(Boolean);
    const next = fields.slice();
    slots.forEach((slot, k) => {
      const f = seq[k];
      if (f) next[slot] = {
        ...f,
        name: byId.get(f.id)
      };
    });
    setFieldsSave(next);
    // 作業側の控え(snapshot)も追従させる。ここを放置すると、
    // 過去の作業だけ古い名前のままになる。
    setWorksSave(works.map(w => byId.has(w.fieldId) ? {
      ...w,
      snapshot: {
        ...w.snapshot,
        name: byId.get(w.fieldId)
      }
    } : w));
    flash(list.length + "圃場の名前を付け直しました");
    autoPushFields();
    return list.length;
  };
  // 地図で囲んだ圃場(ポリゴン・中心座標つき)を登録
  const addFieldWithPolygon = data => {
    setFieldsSave([...fields, {
      id: newId(),
      name: data.name,
      crop: data.crop || "",
      area: (data.area || "").trim(),
      areaA: data.areaA,
      polygon: data.polygon,
      center: data.center
    }]);
    flash("圃場「" + data.name + "」を地図に登録しました(" + fmt(data.areaA, 2) + "a)");
    autoPushFields();
  };
  const makeWork = f => ({
    id: newId(),
    workDate,
    fieldId: f.id,
    snapshot: {
      name: f.name,
      crop: f.crop || "",
      areaA: f.areaA
    },
    // 予定薬液量はマスタに持たせず、その日の「本日の投下量」計算からのみ入る(日をまたいで古い値を引きずらない)
    plannedL: 0,
    chems: [],
    totalL: 0,
    waterMl: 0,
    memo: "",
    reported: false,
    sprayedL: 0,
    reportAreaA: "",
    reportMemo: "",
    reportDate: "",
    synced: false,
    reportSynced: false
  });
  // 地区の一覧は圃場から作る。別マスタにすると圃場と食い違って
  // 陳腐化するため持たない(廃止したコースがそうだった)
  const areas = React.useMemo(() => {
    const set = new Set();
    fields.forEach(f => {
      const a = (f.area || "").trim();
      if (a) set.add(a);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [fields]);
  // v8.31: コース(routes)を廃止し、そのまとまりを圃場の「地区」へ一度だけ引き継ぐ。
  // routes のデータ自体は消さず localStorage に残す(戻せるように)。
  // 既に地区が入っている圃場は上書きしない。
  React.useEffect(() => {
    if (localStorage.getItem("tankmix:areamigrated")) return;
    localStorage.setItem("tankmix:areamigrated", "1");
    const rs = load("tankmix:routes", []);
    if (!Array.isArray(rs) || rs.length === 0) return;
    const byField = new Map();
    rs.forEach(r => (r.fieldIds || []).forEach(fid => {
      // 複数のコースに入っていた圃場は、先に出たコース名を採る
      if (r.name && !byField.has(fid)) byField.set(fid, r.name);
    }));
    let n = 0;
    const next = fields.map(f => {
      if ((f.area || "").trim() || !byField.has(f.id)) return f;
      n++;
      return {
        ...f,
        area: byField.get(f.id)
      };
    });
    if (n > 0) {
      setFieldsSave(next);
      flash("コースを地区として引き継ぎました(" + n + "圃場)");
    }
  }, []);
  const addWork = fieldId => {
    const f = fields.find(x => x.id === fieldId);
    if (!f) return;
    if (works.some(w => w.workDate === workDate && w.fieldId === fieldId && !w.reported)) {
      flash("この圃場は既にこの日のリストにあります");
      return;
    }
    setWorksSave([...works, makeWork(f)]);
    flash("「" + f.name + "」を" + dateLabel(workDate) + "のリストに追加しました");
  };
  // 地区などから複数の圃場をまとめてこの日のリストへ入れる。
  // 1件ずつ addWork を呼ぶと古い works を元に上書きし合って1件しか入らないため、必ずまとめて処理する。
  const addWorks = fieldIds => {
    const exists = new Set(works.filter(w => w.workDate === workDate && !w.reported).map(w => w.fieldId));
    const add = [];
    (fieldIds || []).forEach(id => {
      if (exists.has(id)) return;
      const f = fields.find(x => x.id === id);
      if (!f) return;
      exists.add(id);
      add.push(makeWork(f));
    });
    if (add.length === 0) {
      flash("追加できる圃場がありません(すべてこの日のリストにあります)");
      return;
    }
    setWorksSave([...works, ...add]);
    flash(add.length + "圃場を" + dateLabel(workDate) + "のリストに追加しました");
  };
  const removeWork = id => {
    addTomb("works", id);
    setWorksSave(works.filter(w => w.id !== id));
    // 墓標を積むだけでは、他の端末の進捗マップはその圃場を実績済のまま出し続ける。
    // 送るところまでやって初めて色が戻る
    pushProgress({
      quiet: true
    });
  };
  // 複数の作業をまとめて外す(選択削除・一括削除用)。
  // 1件ずつremoveWorkを呼ぶと古いworksを元に上書きし合って1件しか消えないため、必ずまとめて処理する。
  const removeWorks = ids => {
    const set = new Set(ids);
    if (set.size === 0) return;
    setWorksSave(works.filter(w => !set.has(w.id)));
    flash(set.size + "件をこの日のリストから外しました");
  };

  // 1圃場ぶんの薬量 = 予定薬液量 ÷ 希釈倍率
  const scaleChem = (c, perMl) => {
    const r = parseFloat(c.ratio) || 0;
    return {
      name: c.name || "(無名)",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio,
      ml: r > 0 ? perMl / r : 0
    };
  };
  // 表示中の作業日の薬剤。日付が変われば空から始める
  const dayChems = dayMix && dayMix.date === workDate ? dayMix.chems : [];
  const setDayChems = list => {
    const next = {
      date: workDate,
      chems: list
    };
    setDayMix(next);
    save("tankmix:daymix", next);
  };
  const addDayChem = (c) => setDayChems([...dayChems, {
    id: newId(),
    name: (c && c.name) || "",
    form: (c && c.form) || "sc",
    use: (c && c.use) || "fungicide",
    ratio: c && c.ratio != null ? String(c.ratio) : ""
  }]);
  const updateDayChem = (id, k, v) => setDayChems(dayChems.map(c => c.id === id ? {
    ...c,
    [k]: v
  } : c));
  // 薬剤名を登録済みマスタから選んだときは種類・剤型も引き継ぐ
  const setDayChemName = (id, name) => {
    // 名前の照合は正規化してから。半角カナで打った名前が全角カナで登録された
    // マスタに当たらず、剤型・種類が引き継がれない取りこぼしを防ぐ
    const m = chemMaster.find(x => normalizeChemName(x.name) === normalizeChemName(name));
    setDayChems(dayChems.map(c => c.id === id ? m ? {
      ...c,
      name,
      form: m.form,
      use: m.use || c.use
    } : {
      ...c,
      name
    } : c));
  };
  const removeDayChem = id => setDayChems(dayChems.filter(c => c.id !== id));
  const clearDayChems = () => setDayChems([]);
  // プリセットや前回薬液から、この日の薬剤欄をまとめて埋める
  const fillDayChems = list => {
    if (!list || list.length === 0) return;
    setDayChems(list.map(c => ({
      id: newId(),
      name: c.name || "",
      form: c.form || "sc",
      use: c.use || "other",
      ratio: c.ratio != null ? String(c.ratio) : ""
    })));
    flash("この日の薬剤に読み込みました");
  };
  // 倍率が入っている薬剤だけを適用対象にする
  const validDayChems = dayChems.filter(c => c.name.trim() && parseFloat(c.ratio) > 0);
  // 圃場に薬剤を適用したら、その内容を「前回薬液」として自動で控える。
  // (以前は調合タブの「この薬液を控える」を押す必要があったが、押し忘れが起きるため自動化した)
  const rememberMix = chemList => {
    const snap = chemList.map(c => ({
      name: c.name || "",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio
    }));
    setLastMix(snap);
    save("tankmix:lastmix", snap);
  };
  // 薬剤(プリセット/前回薬液)を指定した圃場すべてに適用。各圃場の薬液量で薬量を自動計算
  const applyChemsToWorks = (workIds, chemList) => {
    if (!chemList || chemList.length === 0) {
      flash("薬剤が選ばれていません");
      return;
    }
    const ids = (workIds || []).filter(id => id != null);
    if (ids.length === 0) {
      flash("圃場が選ばれていません");
      return;
    }
    setWorksSave(works.map(w => {
      if (!ids.includes(w.id)) return w;
      // 実績入力済みの圃場は、実際に散布した量を基準に薬量を計算する
      const base = w.reported && parseFloat(w.sprayedL) > 0 ? parseFloat(w.sprayedL) : parseFloat(w.plannedL);
      const per = base > 0 ? base : 0;
      const perMl = per * 1000;
      const scaled = chemList.map(c => scaleChem(c, perMl));
      const chemMlSum = scaled.reduce((s, c) => s + c.ml, 0);
      return {
        ...w,
        chems: scaled,
        totalL: per,
        waterMl: perMl - chemMlSum,
        synced: false
      };
    }));
    upsertChemMaster(chemList.map(c => ({
      name: c.name || "(無名)",
      form: c.form,
      use: c.use || "other"
    })));
    rememberMix(chemList);
    flash(ids.length === 1 ? "薬剤を適用しました" : ids.length + "圃場に薬剤を適用しました");
  };
  // 本日の散布投下量(10aあたりL)から、その日の全圃場の予定薬液量を面積に応じて一括計算
  const applyRatePerDay = ratePer10a => {
    const rate = parseFloat(ratePer10a);
    if (!(rate > 0)) {
      flash("10aあたりの量を入力してください");
      return;
    }
    const dayWorks = works.filter(w => w.workDate === workDate && !w.reported);
    if (dayWorks.length === 0) {
      flash("この日の作業リストが空です");
      return;
    }
    let updated = 0;
    let noArea = 0;
    // 予定薬液量はマスタには書き込まず、その日の作業(works)にだけ反映する(翌日以降に古い値を残さない)
    setWorksSave(works.map(w => {
      if (w.workDate !== workDate || w.reported) return w;
      const f = resolveWork(w);
      const area = parseFloat(f.areaA) || 0;
      if (area <= 0) {
        noArea++;
        return w;
      }
      const planned = plannedLFromArea(area, rate);
      updated++;
      return {
        ...w,
        plannedL: planned
      };
    }));
    flash(updated + "圃場の予定薬液量を計算しました" + (noArea > 0 ? "(面積未入力 " + noArea + "件は対象外)" : ""));
  };
  // ── 散布済チェックの切り替え ──
  // 進捗マップの色は work.reported を見ている。ここを入り口にすることで、
  // 「散布量を入力する」と「終わったことにする」を分けられる。
  // 散布中は片手でチェックだけ入れ、量は後から「投下量から実績を一括入力」で埋める。
  //
  // 外したときは実績の値も消す。reported だけ false に戻すと、散布量が残ったまま
  // 未実施の圃場ができ、集計と地図が食い違う。
  const toggleDone = id => {
    const w = load("tankmix:works", []).find(x => x.id === id);
    if (!w) return;
    const f = resolveWork(w);
    updateWorks(cur => cur.map(x => {
      if (x.id !== id) return x;
      if (x.reported) {
        return {
          ...x,
          reported: false,
          sprayedL: 0,
          flights: [],
          reportAreaA: "",
          reportMemo: "",
          reportDate: "",
          reportSynced: false,
          // 既にシートへ「散布済」で送ってあるなら、取り消しも送らないと
          // アプリは未実施・シートは散布済という食い違いが黙って残る
          unreportPending: x.reportSynced ? true : x.unreportPending
        };
      }
      return {
        ...x,
        reported: true,
        reportSynced: false,
        unreportPending: false,
        // 散布量はここでは入れない。0のままでも「終わった」ことは伝わる
        sprayedL: parseFloat(x.sprayedL) || 0,
        reportAreaA: parseFloat(f.areaA) || "",
        reportDate: today()
      };
    }));
    // 進捗マップの色をその場で他の端末へ届ける。圏外なら未送信のまま残る
    pushProgress({
      quiet: true
    });
  };

  // ── 投下量から実績をまとめて入れる ──
  // 対象は「散布済にしたが、まだ実散布量が入っていない圃場」だけ。
  // 既に量を入れた圃場を上書きしない(手で入れた実測値を計算値で潰さないため)。
  // チェックしていない圃場は対象にしない。撒いていない圃場に実績が入ってしまう。
  const bulkReportFromRate = ratePer10a => {
    const rate = parseFloat(ratePer10a);
    if (!(rate > 0)) {
      flash("10aあたりの量を入力してください");
      return;
    }
    let updated = 0;
    let noArea = 0;
    const cur = load("tankmix:works", []);
    const next = cur.map(w => {
      if (w.workDate !== workDate || !w.reported) return w;
      if (parseFloat(w.sprayedL) > 0) return w; // 入力済みは触らない
      const area = parseFloat(resolveWork(w).areaA) || 0;
      if (area <= 0) {
        noArea++;
        return w;
      }
      updated++;
      return {
        ...w,
        sprayedL: plannedLFromArea(area, rate),
        reportAreaA: area,
        reportDate: w.reportDate || today(),
        reportSynced: false
      };
    });
    if (updated === 0) {
      flash(noArea > 0 ? "面積が入っていないため計算できませんでした(" + noArea + "圃場)" : "対象がありません(散布済にした圃場のうち、実散布量が空のものが対象です)");
      return;
    }
    setWorksRaw(stampUpdated(withSeq(next), cur));
    flash(updated + "圃場に実績を入れました" + (noArea > 0 ? "(面積未入力 " + noArea + "件は対象外)" : "") + "。送信は「☁ 全データを送信」から");
    pushProgress({
      quiet: true
    });
  };

  // ドラッグ&ドロップ:この日の可視リスト内で、fromの圃場をtoの位置へ移動
  const reorderWork = (fromId, toId) => {
    if (fromId === toId) return;
    const dayW = works.filter(w => w.workDate === workDate && !w.reported);
    const fromIdx = dayW.findIndex(w => w.id === fromId);
    const toIdx = dayW.findIndex(w => w.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...dayW];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // 元の並びで「この日の可視作業」があった位置に、並べ替え後の列を差し込む
    const result = [];
    let ri = 0;
    works.forEach(w => {
      if (w.workDate === workDate && !w.reported) {
        result.push(reordered[ri++]);
      } else result.push(w);
    });
    setWorksSave(result);
  };
  // 面積から計算するときは作業タブの一括計算と同じ端数処理を通す(0.01L単位)
  const effTotalL = mode === "direct" ? parseFloat(totalL) || 0 : plannedLFromArea(areaA, ratePer10a);
  const totalMl = effTotalL * 1000;
  const calc = chems.map((c, i) => {
    const ratio = parseFloat(c.ratio);
    const valid = ratio > 0;
    return {
      ...c,
      valid,
      ml: valid ? totalMl / ratio : 0,
      color: SWATCHES[i % SWATCHES.length]
    };
  });
  const chemMl = calc.reduce((s, c) => s + c.ml, 0);
  const waterMl = totalMl - chemMl;
  const over = totalMl > 0 && waterMl < 0;
  const ready = totalMl > 0 && calc.some(c => c.valid) && !over;
  const mixOrder = calc.filter(c => c.valid).slice().sort((a, b) => formOrder(a.form) - formOrder(b.form));
  const update = (id, k, v) => setChems(chems.map(c => c.id === id ? {
    ...c,
    [k]: v
  } : c));
  const updateChemName = (id, name) => {
    // 名前の照合は正規化してから。半角カナで打った名前が全角カナで登録された
    // マスタに当たらず、剤型・種類が引き継がれない取りこぼしを防ぐ
    const m = chemMaster.find(x => normalizeChemName(x.name) === normalizeChemName(name));
    setChems(chems.map(c => c.id === id ? m ? {
      ...c,
      name,
      form: m.form,
      use: m.use || c.use
    } : {
      ...c,
      name
    } : c));
  };
  const addChem = () => setChems([...chems, newChem()]);
  const removeChem = id => setChems(chems.filter(c => c.id !== id));

  // 薬剤マスタは「薬剤名・種類・剤型・総使用回数の上限」だけを持つ単純な名前帳。
  // 希釈倍率はその日の散布水量で変わるため、マスタには持たせず作業タブで当日入力する。
  const upsertChemMaster = list => {
    let next = [...chemMaster];
    list.forEach(c => {
      if (!c.name || c.name === "(無名)") return;
      // 同上。半角カナ違いで同じ薬剤が二重登録されるのを防ぐ
      const i = next.findIndex(x => normalizeChemName(x.name) === normalizeChemName(c.name));
      const item = {
        name: c.name,
        form: c.form,
        use: c.use || "other"
      };
      // 上限は指定がなければ既存の登録値を引き継ぐ(自動登録で消えないように)
      const prevMax = i >= 0 ? next[i].maxUse : undefined;
      const mu = c.maxUse !== undefined && c.maxUse !== "" ? parseFloat(c.maxUse) || 0 : prevMax;
      if (mu) item.maxUse = mu;
      if (i >= 0) next[i] = item;else next.push(item);
    });
    setChemMasterSave(next);
    autoPushChems();
  };
  const addChemMaster = data => {
    const name = (data.name || "").trim();
    if (!name) return false;
    const exists = chemMaster.some(c => normalizeChemName(c.name) === normalizeChemName(name));
    upsertChemMaster([{
      name,
      form: data.form,
      use: data.use,
      maxUse: data.maxUse
    }]);
    flash(exists ? "「" + name + "」の登録内容を更新しました" : "薬剤「" + name + "」を登録しました");
    return true;
  };
  // 登録済み薬剤を調合タブの薬剤欄に呼び出す(倍率は登録値が入り、その場で変更できる)
  const applyChemMaster = (id, m) => setChems(chems.map(c => c.id === id ? {
    ...c,
    name: m.name,
    form: m.form,
    use: m.use || c.use
  } : c));
  // 登録済み薬剤を新しい行として追加する
  const addChemFromMaster = m => setChems([...chems, {
    ...newChem(),
    name: m.name,
    form: m.form,
    use: m.use || "other"
  }]);
  const submitReport = (id, rep) => {
    const flights = Array.isArray(rep.flights) ? rep.flights.filter(f => f > 0) : [];
    const next = works.map(w => w.id === id ? {
      ...w,
      reported: true,
      reportSynced: false,
      sprayedL: parseFloat(rep.sprayedL) || 0,
      flights: flights,
      // 散布面積は圃場マスタの面積をそのまま記録する(実績入力では面積を入力させない)
      reportAreaA: parseFloat(resolveWork(w).areaA) || "",
      reportMemo: rep.memo || "",
      reportDate: today()
    } : w);
    setWorksSave(next);
    flash("実績を保存しました。作業終了後に一括送信してください");
    // 進捗マップ用の送信だけは、その場で自動で試みる。圏外なら失敗するが
    // 未送信のまま残るので、電波が戻ってから手動または次の保存時に送られる
    pushProgress({
      quiet: true
    });
  };

  // まとめ散布(複数圃場):フライト実績総量を面積比で各圃場に按分し、
  // それぞれ独立した散布実績として記録する
  const submitGroupReport = (ids, rep) => {
    const members = works.filter(w => ids.includes(w.id));
    if (members.length < 2) return;
    const groupId = "G" + Date.now();
    const totalSprayed = parseFloat(rep.sprayedL) || 0;

    // 各圃場の面積(未入力は0扱い)。面積合計が0なら均等割り
    const areas = members.map(w => parseFloat(resolveWork(w).areaA) || 0);
    const areaSum = areas.reduce((s, a) => s + a, 0);
    const useEqual = areaSum <= 0;
    const groupSize = members.length;

    // 端数が合計とズレないよう、最後の圃場で調整
    let allocated = 0;
    const shares = members.map((w, i) => {
      let share;
      if (i === groupSize - 1) {
        share = Math.round((totalSprayed - allocated) * 100) / 100;
      } else {
        const ratio = useEqual ? 1 / groupSize : areas[i] / areaSum;
        share = Math.round(totalSprayed * ratio * 100) / 100;
        allocated += share;
      }
      return share;
    });
    const names = members.map(w => resolveWork(w).name).join("＋");
    // 按分値は members(= works の並び順)の添字で計算している。書き戻しも同じ
    // 基準で引くこと。タップした順の ids で引くと、一覧と違う順に選んだときに
    // 圃場と按分値の対応がズレる(プレビューと保存値が食い違う)
    const shareById = new Map(members.map((w, i) => [w.id, shares[i]]));
    const next = works.map(w => {
      if (!shareById.has(w.id)) return w;
      const f = resolveWork(w);
      return {
        ...w,
        reported: true,
        reportSynced: false,
        sprayedL: shareById.get(w.id),
        // まとめ散布に圃場ごとのフライト内訳は無い。個別入力していた記録を
        // まとめ散布で上書きしたとき、古い内訳が実散布量と食い違って残るのを防ぐ
        flights: [],
        reportAreaA: parseFloat(f.areaA) || "",
        reportMemo: (rep.memo ? rep.memo + " " : "") + "【連続散布 " + names + " 合計" + fmt(totalSprayed, 2) + "L を面積比按分】",
        reportDate: today(),
        flightGroupId: groupId
      };
    });
    setWorksSave(next);
    flash(members.length + "圃場に面積比で按分して記録しました(合計" + fmt(totalSprayed, 2) + "L)");
    pushProgress({
      quiet: true
    });
  };
  const deleteWork = id => {
    addTomb("works", id);
    setWorksSave(works.filter(w => w.id !== id));
    pushProgress({
      quiet: true
    });
  };
  const buildPayload = w => {
    const f = resolveWork(w);
    return {
      id: w.id,
      date: w.workDate,
      field: f.name,
      crop: f.crop || "",
      areaA: f.areaA || "",
      reportAreaA: w.reportAreaA || "",
      totalL: w.totalL,
      waterMl: w.waterMl,
      memo: w.memo || "",
      sprayedL: w.sprayedL,
      reportDate: w.reportDate,
      reportMemo: w.reportMemo,
      flights: w.flights || [],
      flightCount: (w.flights || []).length,
      chems: w.chems.map(c => ({
        ...c,
        formName: formLabel(c.form),
        useName: useLabel(c.use)
      }))
    };
  };
  const post = async (body, retries = 2) => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url) return null;
    // 共有パスワードは全ての送信に乗せる。GAS側で SHARED_SECRET が未設定なら
    // 空文字でも従来どおり通るので、設定していない人の運用は変わらない
    const withAuth = {
      ...body,
      auth: (localStorage.getItem("tankmix:authkey") || "").trim()
    };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(withAuth)
        });
        const j = await res.json();
        // パスワード違いは何度送っても同じなので、リトライせずその場で知らせる
        if (j && j.error === "auth") {
          authErrRef.current = true;
          flash("共有パスワードが違います。設定タブの「共有パスワード」を確認してください");
          return j;
        }
        if (j) return j;
      } catch (e) {/* リトライへ */}
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
    return null;
  };
  const syncPending = async startFromId => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url || syncingRef.current) return;
    syncingRef.current = true;
    abortRef.current = false;
    authErrRef.current = false;
    setSyncing(true);
    let current = load("tankmix:works", []);
    // 送信対象は「作業日で選んでいる日」の未送信ぶんだけ。
    // 以前は全期間の未送信をまとめて送っていたため、意図しない日の記録まで一斉に送られていた。
    const pendingList = current.filter(w => w.workDate === workDate && (!w.synced || w.reported && !w.reportSynced || w.unreportPending));
    // 開始圃場が指定されていれば、その位置から
    let startIdx = 0;
    if (startFromId) {
      const i = pendingList.findIndex(w => w.id === startFromId);
      if (i >= 0) startIdx = i;
    }
    const targets = pendingList.slice(startIdx);
    setSyncProgress({
      done: 0,
      total: targets.length
    });
    let sent = 0;
    let failed = false;
    let aborted = false;
    for (let ti = 0; ti < targets.length; ti++) {
      if (abortRef.current) {
        aborted = true;
        break;
      }
      const w = targets[ti];
      if (!w.synced) {
        const j = await post({
          type: "record",
          recorder: (localStorage.getItem("tankmix:recorder") || "").trim(),
          record: buildPayload(w)
        });
        if (!j || !j.ok) {
          failed = true;
          break;
        }
        current = current.map(x => x.id === w.id ? {
          ...x,
          synced: true
        } : x);
        setWorks(current);
        save("tankmix:works", current);
        sent++;
      }
      if (abortRef.current) {
        aborted = true;
        break;
      }
      let cur = current.find(x => x.id === w.id);
      // 実績の取り消しを先に送る。報告より後に送ると、同じ回で
      // 「取り消し → 再報告」が起きたとき順序が入れ替わって取り消しが勝つ
      if (cur && cur.unreportPending && cur.synced) {
        const j = await post({
          type: "unreport",
          recorder: (localStorage.getItem("tankmix:recorder") || "").trim(),
          record: buildPayload(cur)
        });
        if (!j || !j.ok) {
          failed = true;
          break;
        }
        current = current.map(x => x.id === w.id ? {
          ...x,
          unreportPending: false
        } : x);
        setWorks(current);
        save("tankmix:works", current);
        cur = current.find(x => x.id === w.id);
        sent++;
      }
      if (cur && cur.reported && cur.synced && !cur.reportSynced) {
        const j = await post({
          type: "report",
          recorder: (localStorage.getItem("tankmix:recorder") || "").trim(),
          record: buildPayload(cur)
        });
        if (!j || !j.ok) {
          failed = true;
          break;
        }
        current = current.map(x => x.id === w.id ? {
          ...x,
          reportSynced: true
        } : x);
        setWorks(current);
        save("tankmix:works", current);
        sent++;
      }
      setSyncProgress({
        done: ti + 1,
        total: targets.length
      });
    }
    syncingRef.current = false;
    abortRef.current = false;
    setSyncing(false);
    setSyncProgress({
      done: 0,
      total: 0
    });
    // パスワード違いは post() が既に案内済み。ここで一般的な失敗文言に上書きしない
    if (authErrRef.current) {/* 何も出さない */} else if (aborted) flash(sent + "件送信して中止しました。残りは後で送信できます");else if (sent > 0) flash(sent + "件を送信しました" + (failed ? "(一部失敗・再試行してください)" : ""));else if (failed) flash("送信に失敗しました。電波とURLを確認してください");
  };
  const abortSync = () => {
    abortRef.current = true;
  };
  const testConnection = async () => {
    const url = gasUrl.trim();
    if (!url) {
      flash("URLを入力してください");
      return;
    }
    // つながったかどうかとは別に、送信先がGASのURLの形かどうかも伝える。
    // 形が違えばGoogle以外のサーバーへ記録を送っている可能性がある
    const urlWarn = GAS_URL_RE.test(url) ? "" : "／⚠ Apps ScriptのURLの形ではありません。送信先を確認してください";
    flash("接続を確認中…");
    try {
      const res = await fetch(url);
      const j = await res.json();
      // GASのdoGetが返す secured で、共有パスワードが設定済みかどうかが分かる。
      // 未設定だとURLを知っている人は誰でも書き込めてしまうので、そこまで伝える
      // doGet の features に、そのGASが対応している種類が入っている。
      // Code.gs を貼り替えただけでデプロイし直していないと、ウェブアプリは
      // 古い版を返し続ける(貼った内容は反映されない)。ここで見分けられるようにする。
      const feats = j && Array.isArray(j.features) ? j.features : [];
      // 目安にする印は、その時点で一番新しい機能の名前。
      // v8.57 で薬剤の共有(pushChems)を足したので、これが無ければ
      // 進捗地図は動いても薬剤だけ共有されない状態になる。
      const oldGas = j && j.ok && feats.indexOf("pushChems") < 0;
      if (oldGas) flash("⚠ つながりましたが、動いているのは古い版のスクリプトです。Apps Scriptで「デプロイ」→「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」で更新してください" + urlWarn);else if (j && j.ok && j.secured === false) flash("✅ 接続OK(ただし共有パスワード未設定：URLを知る人は誰でも記録を書き込めます)" + urlWarn);else flash((j && j.ok ? "✅ 接続OK！" : "応答が不正です。URLを確認してください") + urlWarn);
    } catch {
      flash("❌ 接続できません。URLとデプロイ設定を確認してください");
    }
  };
  const cloudSave = async () => {
    if (!teamCode.trim()) {
      flash("チームコードを設定してください");
      return;
    }
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url) {
      flash("先に送信先URLを設定してください");
      return;
    }
    if (!confirm("この端末のデータ(圃場・薬剤・作業リスト)を共有データとして保存します。\n既存の共有データは上書きされます。よろしいですか？")) return;
    setSyncing(true);
    // 以前のバージョンで登録した圃場は座標が倍精度のまま入っている。
    // 送る前に丸めないと、過去に囲んだ圃場だけで上限に達し続ける。
    // 端末に保存されている元データには手を触れない(勝手に書き換えない)。
    const payload = JSON.stringify({
      fields: fields.map(compactField),
      works,
      chemMaster,
      presets,
      // コース機能は廃止したが、旧データを共有の往復で消さないようそのまま乗せる
      routes: load("tankmix:routes", []),
      crops,
      savedAt: new Date().toISOString(),
      by: recorder
    });
    const j = await post({
      type: "cloudSave",
      team: teamCode.trim(),
      payload
    }, 2);
    setSyncing(false);
    if (j && j.error === "auth") {/* post() が案内済み */} else if (j && j.ok) flash("☁ 共有データを保存しました(" + fields.length + "圃場)");else if (j && j.error) {
      // 「大きすぎます」はGASの版とは関係がない。更新を促すと的外れな案内になり、
      // 実際に何度もGASを貼り直しても直らない。今の文字数と上限を出して原因を示す。
      if (String(j.error).indexOf("大きすぎ") >= 0) {
        flash("保存失敗:共有データが大きすぎます(" + payload.length.toLocaleString() + "文字／上限45,000文字)。圃場の数を減らすか、頂点の少ない形で囲み直してください");
      } else {
        flash("保存失敗:" + j.error + "。GASを最新版に更新してください");
      }
    } else flash("保存に失敗しました。URLとGASの更新・デプロイを確認してください");
  };
  const cloudLoad = async () => {
    if (!teamCode.trim()) {
      flash("チームコードを設定してください");
      return;
    }
    if (!confirm("共有データをこの端末に読み込みます。\nこの端末の圃場・薬剤・作業リストは置き換えられます。よろしいですか？")) return;
    setSyncing(true);
    const j = await post({
      type: "cloudLoad",
      team: teamCode.trim()
    }, 1);
    setSyncing(false);
    if (j && j.ok && j.payload) {
      try {
        const data = JSON.parse(j.payload);
        // 受け取った中身は配列である前提のコードが多い。壊れた形のまま入れると
        // 以後アプリ全体が落ちるので、配列になっているものだけ差し替える
        const arr = v => Array.isArray(v);
        // 受け取った内容をそのまま入れる。ここで updatedAt を打ち直すと、
        // 他の人が入れた変更を自分の編集として主張することになる
        if (arr(data.fields)) setFieldsRaw(data.fields);
        if (arr(data.works)) setWorksRaw(data.works);
        if (arr(data.chemMaster)) setChemMasterSave(data.chemMaster);
        if (arr(data.presets)) setPresetsSave(data.presets);
        if (arr(data.routes)) save("tankmix:routes", data.routes);
        if (arr(data.crops)) setCropsSave(data.crops);
        flash("☁ 読み込みました(" + (data.by || "?") + " が " + (data.savedAt || "").slice(0, 16).replace("T", " ") + " に保存)");
      } catch {
        flash("データの解釈に失敗しました");
      }
    } else if (j && j.ok) {
      flash("このチームコードの共有データはまだありません");
    } else if (!(j && j.error === "auth")) {
      // パスワード違いは post() が案内済み
      flash("読み込みに失敗しました");
    }
  };
  // ══════════ 進捗共有(レコード単位) ══════════
  // 従来の cloudSave / cloudLoad は「1チーム=1セルを丸ごと置き換える」方式で、
  // 誰かの保存が他の人の実績を消していた。ここから下は、変わったレコードだけを
  // 送る/受け取る経路。旧方式も残してあり、しばらくは両方使える。
  //
  // 役割を分けている:
  //   進捗(works)  … 送るだけ。他の端末の作業内容は取り込まない。
  //                   サーバーには進捗マップに要る要約(状態・実績量・記録者)しか
  //                   置いておらず、薬剤の明細まで戻せないため
  //   圃場(fields) … 双方向。ポリゴンを含む完全な内容をサーバーに置ける
  const SYNC_CHUNK = 200; // GAS側の PUSH_MAX(300)より小さくしておく

  // 未送信 = updatedAt が pushedAt と食い違うもの
  const pendingOf = list => list.filter(x => x.updatedAt && x.updatedAt !== x.pushedAt);
  const syncReady = () => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    return !!url && !!teamCode.trim();
  };
  const fieldToItem = f => {
    const c = compactField(f);
    return {
      id: c.id,
      name: c.name || "",
      crop: c.crop || "",
      area: c.area || "",
      areaA: c.areaA,
      center: c.center || null,
      polygon: c.polygon || [],
      updatedAt: c.updatedAt || "",
      by: recorder,
      deviceId
    };
  };
  const itemToField = it => ({
    id: it.id,
    name: it.name || "",
    crop: it.crop || "",
    area: it.area || "",
    areaA: it.areaA,
    center: it.center || null,
    polygon: it.polygon || [],
    updatedAt: it.updatedAt || "",
    // 受け取った時点で「送信済み」にしておく。そうしないと次の送信で
    // 受け取ったばかりの内容をそのまま送り返し、往復が終わらない
    pushedAt: it.updatedAt || ""
  });
  const workStatus = w => w.reported ? "done" : (w.chems || []).length > 0 ? "mixed" : "planned";
  const workToItem = (w, seq) => {
    const f = resolveWork(w);
    return {
      id: w.id,
      workDate: w.workDate || "",
      fieldId: w.fieldId,
      fieldName: f.name || "",
      status: workStatus(w),
      plannedL: parseFloat(w.plannedL) || 0,
      sprayedL: w.reported ? parseFloat(w.sprayedL) || 0 : 0,
      reportAreaA: w.reportAreaA || "",
      chemCount: (w.chems || []).length,
      chemText: (w.chems || []).map(c => (c.name || "(無名)") + "(" + (c.ratio || "?") + "倍)").join(" / "),
      by: recorder,
      deviceId,
      reportedAt: w.reported ? w.reportDate || "" : "",
      updatedAt: w.updatedAt || "",
      // ここからは v8.58。受け取った端末が予定を組み直せるだけの中身。
      // 要約(薬剤数・薬剤内容の文字列)だけだと、希釈倍率も量も戻せない。
      crop: f.crop || "",
      areaA: f.areaA === "" || f.areaA === undefined ? "" : Number(f.areaA) || "",
      chems: w.chems || [],
      totalL: parseFloat(w.totalL) || 0,
      waterMl: parseFloat(w.waterMl) || 0,
      memo: w.memo || "",
      seq: seq === undefined || seq === null ? "" : seq
    };
  };
  // 受け取った1件 → この端末の作業
  const itemToWork = it => ({
    id: it.id,
    workDate: ymd(it.workDate),
    fieldId: it.fieldId,
    snapshot: {
      name: it.fieldName || "",
      crop: it.crop || "",
      areaA: it.areaA === "" || it.areaA === undefined ? "" : it.areaA
    },
    plannedL: it.plannedL || 0,
    chems: Array.isArray(it.chems) ? it.chems : [],
    totalL: it.totalL || 0,
    waterMl: it.waterMl || 0,
    memo: it.memo || "",
    reported: it.status === "done",
    sprayedL: it.sprayedL || 0,
    reportAreaA: it.reportAreaA || "",
    reportMemo: "",
    reportDate: ymd(it.reportedAt),
    seq: it.seq === "" || it.seq === undefined ? "" : Number(it.seq),
    // 台帳(「防除記録」シート)へ送るのは、その作業をした端末の役目とする。
    // 受け取っただけの端末でも未送信扱いにすると、全員の画面に
    // 「未送信 38件」が出て、誰が送るべきか分からなくなる。
    // この端末で「散布済」を押し直せば reportSynced は false に戻り、
    // その時点でこの端末からも台帳へ送られる。
    synced: true,
    reportSynced: true,
    // 他の端末から受け取った印と、その記録者名。
    // これがないと、自分で送ったものと見分けがつかず
    // 「✓送信済」と出て、送った覚えのない行に見える。
    fromTeam: true,
    by: it.by || "",
    updatedAt: it.updatedAt || "",
    pushedAt: it.updatedAt || ""
  });

  // 件数で分割して送る。1回で送りきれる件数はGAS側の上限で決まる
  const pushItems = async (type, items) => {
    let sent = 0;
    for (let i = 0; i < items.length; i += SYNC_CHUNK) {
      const part = items.slice(i, i + SYNC_CHUNK);
      const j = await post({
        type,
        team: teamCode.trim(),
        items: part
      }, 2);
      if (!j || !j.ok) return {
        ok: false,
        sent,
        error: j && j.error
      };
      sent += part.length;
    }
    return {
      ok: true,
      sent
    };
  };

  // ── 進捗を送る ──
  // quiet:true のときは画面に何も出さない(実績保存の直後に自動で呼ぶため)。
  // 圏外や未設定なら黙って諦める。未送信のまま残るので、あとから手で送れる。
  const pushProgress = async opt => {
    const quiet = opt && opt.quiet;
    if (!syncReady()) {
      if (!quiet) flash("送信先URLとチームコードを設定してください");
      return false;
    }
    const cur = load("tankmix:works", []);
    const pend = pendingOf(cur);
    const tombs = loadTombs().works;
    if (pend.length === 0 && tombs.length === 0) {
      if (!quiet) flash("送っていない進捗はありません");
      return true;
    }
    const items = pend.map(w => workToItem(w, w.seq)).concat(tombs.map(t => ({
      id: t.id,
      fieldId: 0,
      workDate: "",
      status: "planned",
      deleted: true,
      updatedAt: t.updatedAt,
      by: recorder,
      deviceId
    })));
    const r = await pushItems("pushWorks", items);
    if (!r.ok) {
      if (!quiet && r.error !== "auth") flash("進捗の送信に失敗しました" + (r.error ? "(" + r.error + ")" : ""));
      return false;
    }
    // 送れたものだけ pushedAt を進める。送信中に編集された行は updatedAt が
    // 先へ進んでいるので、次回もう一度送られる
    const done = new Map(pend.map(w => [w.id, w.updatedAt]));
    setWorksRaw(load("tankmix:works", []).map(w => done.has(w.id) ? {
      ...w,
      pushedAt: done.get(w.id)
    } : w));
    const t = loadTombs();
    t.works = [];
    save(TOMB_KEY, t);
    if (!quiet) flash("進捗を送信しました(" + items.length + "件)");
    return true;
  };

  // ── 圃場マスタを送る ──
  const pushFieldsSync = async opt => {
    const quiet = opt && opt.quiet;
    if (!syncReady()) {
      if (!quiet) flash("送信先URLとチームコードを設定してください");
      return false;
    }
    const cur = load("tankmix:fields", []);
    const pend = pendingOf(cur);
    const tombs = loadTombs().fields;
    if (pend.length === 0 && tombs.length === 0) {
      if (!quiet) flash("送っていない圃場はありません");
      return true;
    }
    const items = pend.map(fieldToItem).concat(tombs.map(t => ({
      id: t.id,
      deleted: true,
      updatedAt: t.updatedAt,
      by: recorder,
      deviceId
    })));
    const r = await pushItems("pushFields", items);
    if (!r.ok) {
      if (!quiet && r.error !== "auth") flash("圃場の送信に失敗しました" + (r.error ? "(" + r.error + ")" : ""));
      return false;
    }
    const done = new Map(pend.map(f => [f.id, f.updatedAt]));
    setFieldsRaw(load("tankmix:fields", []).map(f => done.has(f.id) ? {
      ...f,
      pushedAt: done.get(f.id)
    } : f));
    const t = loadTombs();
    t.fields = [];
    save(TOMB_KEY, t);
    if (!quiet) flash("圃場を送信しました(" + items.length + "件)");
    return true;
  };

  // ── 薬剤マスタを送る ──
  const chemToItem = c => ({
    id: c.id || chemIdOf(c),
    name: c.name || "",
    use: c.use || "",
    form: c.form || "",
    maxUse: c.maxUse || "",
    updatedAt: c.updatedAt || "",
    by: recorder,
    deviceId
  });
  const itemToChem = it => {
    const o = {
      id: it.id,
      name: it.name || "",
      use: it.use || "other",
      form: it.form || "",
      updatedAt: it.updatedAt || "",
      // 受け取った時点で「送信済み」にしておく(圃場と同じ理由)
      pushedAt: it.updatedAt || ""
    };
    if (it.maxUse) o.maxUse = Number(it.maxUse);
    return o;
  };
  const pushChemsSync = async opt => {
    const quiet = opt && opt.quiet;
    if (!syncReady()) {
      if (!quiet) flash("送信先URLとチームコードを設定してください");
      return false;
    }
    const cur = load("tankmix:chemmaster", []);
    const pend = pendingOf(cur);
    const tombs = loadTombs().chems;
    if (pend.length === 0 && tombs.length === 0) return true;
    const items = pend.map(chemToItem).concat(tombs.map(t => ({
      id: t.id,
      name: "",
      deleted: true,
      updatedAt: t.updatedAt,
      by: recorder,
      deviceId
    })));
    const r = await pushItems("pushChems", items);
    if (!r.ok) {
      if (!quiet && r.error !== "auth") flash("薬剤の送信に失敗しました" + (r.error ? "(" + r.error + ")" : ""));
      return false;
    }
    // 送れたものだけ pushedAt を進める。送信中に編集された行は次回もう一度送られる
    const done = new Map(pend.map(c => [c.id, c.updatedAt]));
    const nextC = load("tankmix:chemmaster", []).map(c => done.has(c.id) ? {
      ...c,
      pushedAt: done.get(c.id)
    } : c);
    setChemMaster(nextC);
    save("tankmix:chemmaster", nextC);
    const t = loadTombs();
    t.chems = [];
    save(TOMB_KEY, t);
    if (!quiet) flash("薬剤を送信しました(" + items.length + "件)");
    return true;
  };

  // ── 圃場マスタを受け取る(差分) ──
  const pullSharedSync = async opt => {
    const quiet = opt && opt.quiet;
    if (!syncReady()) {
      if (!quiet) flash("送信先URLとチームコードを設定してください");
      return false;
    }
    const since = localStorage.getItem("tankmix:pullat") || "";
    const j = await post({
      type: "pull",
      team: teamCode.trim(),
      since
    }, 1);
    if (!j || !j.ok) {
      if (!quiet && !(j && j.error === "auth")) flash("受信に失敗しました" + (j && j.error ? "(" + j.error + ")" : ""));
      return false;
    }
    const cur = load("tankmix:fields", []);
    const byId = new Map(cur.map(f => [String(f.id), f]));
    let added = 0,
      updated = 0,
      removed = 0;
    (j.fields || []).forEach(inc => {
      const key = String(inc.id);
      const old = byId.get(key);
      if (inc.deleted) {
        if (old) {
          byId.delete(key);
          removed++;
        }
        return;
      }
      if (!old) {
        byId.set(key, itemToField(inc));
        added++;
        return;
      }
      // この端末に、まだ送っていない新しい編集があるなら残す。
      // 受け取った側で上書きすると、目の前で直したばかりの形が戻る
      if (String(old.updatedAt || "") > String(inc.updatedAt || "")) return;
      byId.set(key, {
        ...old,
        ...itemToField(inc)
      });
      updated++;
    });
    if (added || updated || removed) setFieldsRaw(Array.from(byId.values()));
    // 作業(その日の予定)。v8.57までは送るだけで、受け取っていなかった。
    // サーバーに進捗マップ用の要約しか置いていなかったためで、
    // v8.58 で薬剤の中身・作物・面積・並び順を足して配れるようにした。
    // 古いGASはこれらの列を持たないので、空の予定が入ってくる。
    // workPlan の印がないGASからは取り込まない。
    if (j.plan === true && Array.isArray(j.works) && j.works.length) {
      const curW = load("tankmix:works", []);
      const byW = new Map(curW.map(w => [String(w.id), w]));
      let wChanged = 0;
      j.works.forEach(inc => {
        const key = String(inc.id);
        const old = byW.get(key);
        if (inc.deleted) {
          if (old) {
            byW.delete(key);
            wChanged++;
          }
          return;
        }
        if (!inc.workDate) return; // 壊れた行は入れない
        if (old && String(old.updatedAt || "") > String(inc.updatedAt || "")) return;
        byW.set(key, old ? {
          ...old,
          ...itemToWork(inc),
          // 台帳への送信状態はこの端末の事情。受信で上書きしない
          synced: old.synced,
          reportSynced: old.reportSynced,
          unreportPending: old.unreportPending
        } : itemToWork(inc));
        wChanged++;
      });
      if (wChanged) {
        // 新しく入った作業が末尾に積まれると順番がめちゃくちゃになる。
        // 日ごとにまとめ、送ってきた並び順で並べ直す。
        const nextW = Array.from(byW.values());
        const order = new Map();
        nextW.forEach((w, i) => order.set(w.id, i));
        nextW.sort((a, b) => {
          const da = String(a.workDate || ""),
            db = String(b.workDate || "");
          if (da !== db) return da < db ? -1 : 1;
          const sa = a.seq === "" || a.seq === undefined ? order.get(a.id) : a.seq;
          const sb = b.seq === "" || b.seq === undefined ? order.get(b.id) : b.seq;
          if (sa !== sb) return sa - sb;
          return order.get(a.id) - order.get(b.id);
        });
        setWorksRaw(nextW);
      }
    }
    // 薬剤も同じ応答で配られる。古いGASは chems を返さないので、
    // 無いときは何もしない(ここで空配列として扱うと全件消えることになる)
    if (Array.isArray(j.chems) && j.chems.length) {
      const curC = load("tankmix:chemmaster", []);
      const byC = new Map(curC.map(c => [String(c.id || chemIdOf(c)), c]));
      let cChanged = 0;
      j.chems.forEach(inc => {
        const key = String(inc.id);
        const old = byC.get(key);
        if (inc.deleted) {
          if (old) {
            byC.delete(key);
            cChanged++;
          }
          return;
        }
        if (old && String(old.updatedAt || "") > String(inc.updatedAt || "")) return;
        byC.set(key, old ? {
          ...old,
          ...itemToChem(inc)
        } : itemToChem(inc));
        cChanged++;
      });
      if (cChanged) {
        const nextC = Array.from(byC.values());
        setChemMaster(nextC);
        save("tankmix:chemmaster", nextC);
      }
    }
    // serverTime は応答が含む範囲の終わり。次回はここから先だけを受け取る
    if (j.serverTime) localStorage.setItem("tankmix:pullat", j.serverTime);
    if (!quiet) flash("受信しました(追加" + added + "・更新" + updated + "・削除" + removed + ")");
    return true;
  };

  // 送ってから受け取る。順番が逆だと、自分の未送信の変更が
  // 受け取った内容で埋もれたまま送られない
  const syncShared = async () => {
    if (!syncReady()) {
      flash("送信先URLとチームコードを設定してください");
      return;
    }
    setSyncing(true);
    const okPush = await pushFieldsSync({
      quiet: true
    });
    const okChem = await pushChemsSync({
      quiet: true
    });
    const okPull = await pullSharedSync({
      quiet: true
    });
    setSyncing(false);
    if (okPush && okChem && okPull) flash("☁ 圃場と薬剤を同期しました");else flash("同期に失敗しました。電波とGASの版数を確認してください");
  };

  // ── 進捗マップ用の読み取り ──
  // 失敗の理由を区別して返す。「設定していない」「電波がない」「GASが古い」で
  // 案内すべきことが違うのに、まとめて「取得できません」と出すと直しようがない
  const fetchProgress = async (from, to) => {
    if (!syncReady()) return {
      error: "設定"
    };
    const j = await post({
      type: "progress",
      team: teamCode.trim(),
      from,
      to
    }, 1);
    if (!j) return {
      error: "通信"
    };
    if (!j.ok) return {
      error: j.error === "unknown type" ? "GAS" : j.error || "不明"
    };
    return j;
  };

  // ── 農薬データの取り込み(GAS経由・分割受信) ──
  // 起動時に、取り込み済みかどうかだけ確認して設定タブの表示に使う
  useEffect(() => {
    let alive = true;
    chemDbMeta().then(m => {
      if (alive) setChemDbInfo(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  const importChemDb = async () => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url) {
      flash("先に「送信・共有設定」で送信先URLを設定してください");
      return;
    }
    if (chemDbBusy) return; // 二重押し防止(ボタン側でも disabled にしている)
    setChemDbBusy(true);
    setChemDbProgress("接続中…");
    try {
      // part 0 から順に受け取って連結する。総パート数は最初の応答で分かる。
      let text = "";
      let part = 0;
      let total = 1;
      while (part < total) {
        const j = await post({
          type: "chemdbLoad",
          part,
          size: 250000
        }, 2);
        if (!j) throw new Error("送信先につながりません");
        if (j.error === "auth") return; // 案内は post() が出している
        if (!j.ok) throw new Error(j.error === "chemdb not found" ? "Googleドライブに chemdb.json が見つかりません。スクリプトプロパティ CHEMDB_FILE_ID を確認してください" : j.error || "取得に失敗しました");
        total = Math.max(1, Number(j.total) || 1);
        text += String(j.chunk || "");
        part++;
        setChemDbProgress(part + "/" + total + " パート");
        // 万一 total が壊れた値で返っても、無限に取りに行かないようにする
        if (part > 100) throw new Error("パート数が多すぎます。GASを最新のCode.gsに更新してください");
      }
      // 全部そろってから解釈する。途中まで保存すると、次回「取り込み済み」の顔をして
      // 中身が欠けたデータで検索することになる
      const data = JSON.parse(text);
      if (!Array.isArray(data) || data.length === 0) throw new Error("データの形式が違います");
      const rec = {
        data,
        savedAt: new Date().toISOString(),
        count: data.length
      };
      await chemDbPutRecord(rec);
      resetChemDbCache();
      setChemDbInfo({
        count: rec.count,
        savedAt: rec.savedAt
      });
      flash("農薬データを取り込みました(" + rec.count.toLocaleString() + "件)");
    } catch (e) {
      flash("取り込みに失敗しました:" + (e && e.message ? e.message : e));
    } finally {
      setChemDbBusy(false);
      setChemDbProgress("");
    }
  };
  const deleteChemDb = async () => {
    if (!confirm("この端末に取り込んだ農薬データを削除します。\n農薬の検索ができなくなります(取り込み直せば戻ります)。よろしいですか？")) return;
    try {
      await chemDbDeleteRecord();
      resetChemDbCache();
      setChemDbInfo(null);
      flash("農薬データを削除しました");
    } catch (e) {
      flash("削除に失敗しました");
    }
  };
  const savePreset = () => {
    // 倍率が入っている薬剤だけを保存する(空欄の行が「(無名)」として混ざるのを防ぐ)
    const valid = calc.filter(c => c.valid);
    if (valid.length === 0) {
      flash("薬剤名と希釈倍率を入力してください");
      return;
    }
    const input = prompt("プリセット名を入力してください", "調合セット");
    if (input === null) return;
    const name = input.trim();
    if (!name) {
      flash("プリセット名を入力してください");
      return;
    }
    const chemList = valid.map(c => ({
      name: c.name || "(無名)",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio
    }));
    // 同名のプリセットがあるときは、増やさずに上書きするか確認する
    const exists = presets.find(p => p.name === name);
    if (exists) {
      if (!confirm("「" + name + "」は既にあります。内容を上書きしますか？")) return;
      setPresetsSave(presets.map(p => p.name === name ? {
        ...p,
        chems: chemList
      } : p));
      flash("プリセット「" + name + "」を更新しました");
      return;
    }
    setPresetsSave([{
      id: newId(),
      name,
      chems: chemList
    }, ...presets]);
    flash("プリセット「" + name + "」を保存しました");
  };
  const loadPreset = p => {
    setChems(p.chems.map(c => ({
      ...c,
      id: uid++
    })));
    setTab("calc");
    flash("「" + p.name + "」を読み込みました");
  };
  const loadLastMix = () => {
    if (!lastMix || lastMix.length === 0) {
      flash("前回の調合がありません");
      return;
    }
    setChems(lastMix.map(c => ({
      ...c,
      id: uid++
    })));
    flash("前回と同じ薬液を読み込みました");
  };
  const deletePreset = id => setPresetsSave(presets.filter(p => p.id !== id));
  const deleteChemMaster = name => {
    // 消したこと自体を送らないと、他の端末から次の同期で復活する
    const gone = chemMaster.filter(c => c.name === name);
    if (gone.length) addTomb("chems", gone.map(c => c.id || chemIdOf(c)));
    setChemMasterSave(chemMaster.filter(c => c.name !== name));
    autoPushChems();
  };
  const editChemMaster = (name, data) => {
    setChemMasterSave(chemMaster.map(c => c.name === name ? {
      ...c,
      ...data
    } : c));
    autoPushChems();
  };
  const exportCSV = () => {
    // 末尾のゼロ落としは stripTrailingZeros に任せる。以前は小数点の有無を見ずに
    // 削っていたため、桁数0で呼ぶと "100" が "1" になる取り違えが起きえた。
    const plain = (n, d = 2) => isFinite(n) && n !== "" ? stripTrailingZeros(Number(n).toFixed(d)) : "";
    // 圃場名や備考にカンマ・改行・引用符が入っても列がずれないよう、CSV の
    // 決まりどおり二重引用符で囲む。以前は備考だけカンマを空白に潰していたため、
    // 圃場名に「A圃場,西」のような名前を付けると列が1つ増えて崩れていた
    // 圃場名や備考が「=」「+」などで始まると、Excelがそれを数式として計算してしまう
    // (=1+1 が 2 になるだけでなく、外部を呼び出す式を書かれると危ない)。
    // 先頭にアポストロフィを足すと Excel は文字列として扱うので、必ず前置する
    const csvCell = v => {
      let t = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r\n]/.test(t)) t = "'" + t;
      return /["\r\n,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const head = "散布日,圃場,作物,面積(a),薬剤数,薬剤内容,総量(L),水量(L),実散布量(L),フライト数,フライト内訳,状態,報告日,備考\n";
    const body = works.map(w => {
      const f = resolveWork(w);
      const chems = w.chems || []; // 移行データや共有データには薬剤欄が無いことがある
      const chemsStr = chems.map(c => c.name + "(" + useLabel(c.use) + "・" + formLabel(c.form) + "・" + c.ratio + "倍・" + (isFinite(c.ml) ? Math.round(c.ml) : 0) + "mL)").join(" / ");
      const flights = w.flights || [];
      const flightStr = flights.length > 1 ? flights.map(fl => plain(fl, 1) + "L").join(" + ") : "";
      return [w.workDate, f.name, f.crop || "", plain(parseFloat(w.reportAreaA || f.areaA), 2), chems.length, chemsStr, plain(w.totalL), plain(w.waterMl / 1000, 3), w.reported ? plain(w.sprayedL) : "", w.reported ? flights.length || 1 : "", flightStr, w.reported ? "散布済" : "調合のみ", w.reportDate || "", w.reportMemo || w.memo || ""].map(csvCell).join(",");
    }).join("\n");
    const blob = new Blob(["\uFEFF" + head + body], {
      type: "text/csv;charset=utf-8"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "散布記録_" + today() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    flash("CSVを出力しました");
  };

  // 農薬使用回数警告(同圃場×同農薬の使用回数をカウント、デフォルト上限3回)
  const chemWarnings = React.useMemo(() => {
    const counts = new Map();
    // 作期開始日より前の記録は数えない(作期ごとに使用回数がリセットされるため)。
    // 判定は散布した日(workDate)で行う。reportDate は「実績を入力した日」なので、
    // 後日まとめて入力すると作期の内外を取り違える
    works.filter(w => w.reported).filter(w => {
      if (!seasonStart) return true;
      const d = w.workDate || w.reportDate || "";
      return d >= seasonStart;
    }).forEach(w => {
      const f = resolveWork(w);
      // 圃場は id で数える(圃場名を変えてもカウントが分裂しないように)
      const fieldKey = w.fieldId != null ? "id:" + w.fieldId : "name:" + f.name;
      (w.chems || []).forEach(c => {
        // 薬剤名は他の集計と同じ NFKC 正規化を通す。半角カナで入力した薬剤が
        // 別物として数えられ、上限の警告が出ないのを防ぐ
        const chemName = normalizeChemName(c.name);
        if (!chemName) return; // 名前のない薬剤は上限を照合できないので数えない
        const key = fieldKey + "||" + chemName;
        const hit = counts.get(key);
        if (hit) hit.count += 1;else counts.set(key, {
          fieldName: f.name,
          chemName,
          count: 1
        });
      });
    });
    const warnings = [];
    counts.forEach(entry => {
      // 薬剤マスタに登録された総使用回数の上限を使う(未設定なら既定値)。
      // マスタ側の名前も正規化して突き合わせる
      const m = chemMaster.find(x => normalizeChemName(x.name) === entry.chemName);
      const limit = m && parseFloat(m.maxUse) > 0 ? parseFloat(m.maxUse) : CHEM_LIMIT_DEFAULT;
      if (entry.count >= limit - 1) {
        warnings.push({
          fieldName: entry.fieldName,
          chemName: entry.chemName,
          count: entry.count,
          limit
        });
      }
    });
    return warnings.sort((a, b) => b.count - a.count);
  }, [works, fields, chemMaster, seasonStart]);
  const isPending = w => !w.synced || w.reported && !w.reportSynced || !!w.unreportPending;
  // 未送信の件数は「選んでいる作業日」ぶんだけを数える
  const pendingCount = works.filter(w => w.workDate === workDate && isPending(w)).length;
  // 他の日に残っている未送信の件数(日付を切り替えてもらうための案内に使う)
  const pendingOtherDays = works.filter(w => w.workDate !== workDate && isPending(w)).length;

  // 電波が戻ったら自動で送信を試みる(その日の未送信があるときだけ)
  useEffect(() => {
    const onOnline = () => {
      const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
      const pend = load("tankmix:works", []).filter(w => w.workDate === workDate && isPending(w)).length;
      if (url && pend > 0) syncPending();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [workDate]);

  // 見た目の表示用。上の効果は「戻ったときに送る」ためのもので、
  // 役割が違うので別に持つ。
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    style: S.page
  }, /*#__PURE__*/React.createElement("header", {
    style: S.header,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: S.eyebrow
  }, "TANK MIX NOTE"), /*#__PURE__*/React.createElement("h1", {
    style: S.title
  }, "農薬散布防除記録")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.versionTag
  }, APP_VERSION))), /*#__PURE__*/React.createElement("div", {
    // 接続状態とチームは見出しの下に1行で置く。バージョンの隣に積むと
    // 右の列が広がって、タイトルが3行に折れる(実測 見出し128px)
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      columnGap: 6,
      rowGap: 4,
      flexWrap: "wrap",
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    // 電波の有無。圏外でもアプリは動くが、共有は止まる。
    // 「送ったつもりで届いていない」を先に気づけるように常に出す。
    // navigator.onLine は「網に繋がっているか」であって、
    // 送信先に届くかどうかまでは分からない。
    style: {
      ...S.hdrChip,
      background: online ? "#E6F2EA" : "#F6E4E0",
      color: online ? "#1F6B43" : "#9A3B26",
      borderColor: online ? "#BFDDCB" : "#E7C3BA"
    },
    title: online ? "電波あり。共有できます" : "圏外です。記録は端末に残り、電波が戻ってから送られます"
  }, online ? "● オンライン" : "○ オフライン"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setTab("settings"),
    style: {
      ...S.hdrChip,
      background: teamCode.trim() ? "#EAF1F6" : "#F4F1E2",
      color: teamCode.trim() ? "#2A5F80" : "#7A6414",
      borderColor: teamCode.trim() ? "#C6DAE7" : "#E2D8A9",
      cursor: "pointer",
      maxWidth: 140,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    title: teamCode.trim() ? "この端末はチーム「" + teamCode.trim() + "」と共有しています" : "チームコードが未設定です。押すと設定を開きます"
  }, teamCode.trim() ? "👥 " + teamCode.trim() : "👥 チーム未設定"), pendingCount > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTab("work");
      syncPending();
    },
    style: S.headerBadge
  }, syncing ? "送信中…" : "☁ " + dateLabel(workDate) + " 未送信 " + pendingCount + "件"))), chemWarnings.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.warnBand,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", {
    style: S.warnIcon
  }, "⚠"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, chemWarnings.slice(0, 2).map((w, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      marginRight: 12,
      fontSize: 13,
      fontWeight: 700
    }
  }, w.fieldName, " × ", w.chemName, "：", w.count, "回", w.count >= w.limit ? " 🚫超過" : " (上限" + w.limit + "回)")), chemWarnings.length > 2 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "#8a2f1c"
    }
  }, "他", chemWarnings.length - 2, "件"))), toast && /*#__PURE__*/React.createElement("div", {
    style: S.toast
  }, toast), /*#__PURE__*/React.createElement("main", {
    style: tab === "map" ? S.mainFull : S.main
  }, tab === "calc" && /*#__PURE__*/React.createElement(CalcTab, {
    mode,
    setMode,
    totalL,
    setTotalL,
    areaA,
    setAreaA,
    ratePer10a,
    setRatePer10a,
    calc,
    chems,
    update,
    updateChemName,
    addChem,
    removeChem,
    applyChemMaster,
    addChemFromMaster,
    effTotalL,
    totalMl,
    waterMl,
    over,
    ready,
    mixOrder,
    savePreset,
    chemMaster,
    lastMix,
    loadLastMix,
    // 調合タブの「🧪 薬剤」側で使う(旧データベースタブの中身)
    addChemMaster,
    deleteChemMaster,
    editChemMaster,
    presets,
    loadPreset,
    deletePreset
  }), tab === "work" && /*#__PURE__*/React.createElement(WorkTab, {
    works,
    fields,
    workDate,
    setWorkDate,
    resolveWork,
    addWork,
    removeWork,
    removeWorks,
    reorderWork,
    upsertField,
    areas,
    addWorks,
    applyRatePerDay,
    toggleDone,
    bulkReportFromRate,
    submitReport,
    submitGroupReport,
    deleteWork,
    syncPending,
    syncing,
    pendingOtherDays,
    exportCSV,
    syncProgress,
    abortSync,
    gasUrl,
    presets,
    lastMix,
    chemMaster,
    dayChems,
    validDayChems,
    addDayChem,
    updateDayChem,
    setDayChemName,
    removeDayChem,
    clearDayChems,
    fillDayChems,
    applyChemsToWorks,
    crops,
    addCrop,
    areaUnitKey,
    volUnitKey,
    tankCapacityL,
    flash,
    // 進捗地図(作業タブの「🚦 進捗地図」表示)に渡す
    recorder,
    fetchProgress,
    mapEngine,
    gmapKey,
    pullSec
  }), mapMounted && /*#__PURE__*/React.createElement("div", {
    style: tab === "map" ? undefined : {
      display: "none"
    }
  }, /*#__PURE__*/React.createElement(MapTabRouter, {
    fields,
    addFieldWithPolygon,
    upsertField,
    // 「📋 一覧」を圃場マスタにしたため、削除と連番振り直しもここで行う
    deleteField,
    renameFields,
    areaUnitKey,
    areas,
    crops,
    addCrop,
    flash,
    mapEngine,
    gmapKey,
    setTab,
    // 表示中かどうか。隠れている間は大きさを測れないので採寸を止め、
    // 戻ってきたときに測り直させる
    active: tab === "map"
  })), tab === "settings" &&/*#__PURE__*/React.createElement(SettingsTab, {
    areaUnitKey,
    setAreaUnitKey,
    volUnitKey,
    setVolUnitKey,
    tankCapacityL,
    setTankCapacityL,
    gasUrl,
    setGasUrl,
    recorder,
    setRecorder,
    teamCode,
    setTeamCode,
    pullSec,
    setPullSec,
    authKey,
    setAuthKey,
    testConnection,
    cloudSave,
    cloudLoad,
    syncShared,
    pushProgress,
    syncing,
    chemDbInfo,
    chemDbBusy,
    chemDbProgress,
    importChemDb,
    deleteChemDb,
    crops,
    addCrop,
    deleteCrop,
    mapEngine,
    setMapEngine,
    gmapKey,
    gmapKeyInput,
    setGmapKeyInput,
    saveGmapKey,
    seasonStart,
    setSeasonStart,
    eraseAllData,
    forceUpdate
  })), /*#__PURE__*/React.createElement("nav", {
    style: S.tabbar,
    className: "no-print"
  }, [["calc", "🧮", "薬剤登録・希釈計算"], ["work", "🚁", "作業予定・進捗確認"], ["map", "🗺", "圃場登録・圃場一覧"], ["settings", "⚙", "設定"]].map(t =>/*#__PURE__*/React.createElement("button", {
    key: t[0],
    onClick: () => setTab(t[0]),
    style: {
      ...S.tabBtn,
      ...(tab === t[0] ? S.tabBtnActive : {})
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20
    }
  }, t[1]), /*#__PURE__*/React.createElement("span", {
    // 1行で出す。スマホ幅だと1タブ 90px 前後しかないので、
    // 8文字が入るように字を小さくしてある。
    style: {
      // 1タブの幅は画面幅÷4。375pxの端末で 95px、320px なら 80px しかない。
      // 8文字を入れるには字を画面幅に合わせて縮める必要がある。
      // 上限を 9.5px にしてあるので、幅のある端末で大きくなりすぎない。
      fontSize: "clamp(8px, 2.55vw, 9.5px)",
      fontWeight: 700,
      lineHeight: 1.3,
      whiteSpace: "nowrap",
      textAlign: "center",
      letterSpacing: "-0.02em",
      maxWidth: "100%",
      overflow: "hidden"
    },
    className: "tab-label"
  }, t[2])))));
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  // 登録薬剤の呼び出し先。薬剤行のID、または新しい行として追加する場合は "new"
  const [pickFor, setPickFor] = useState(null);
  // v8.57 でデータベースタブを畳んだ。薬剤マスタはここの「🧪 薬剤」側。
  // 選んだ側を覚えておく。登録作業を続けている途中で他のタブへ
  // 行って戻ると、毎回電卓に戻されるのを防ぐため。
  const [calcView, setCalcView] = useState(() => load("tankmix:calcview", "calc") === "chem" ? "chem" : "calc");
  const chooseView = v => {
    setCalcView(v);
    save("tankmix:calcview", v);
  };
  const onPick = m => {
    if (pickFor === "new") p.addChemFromMaster(m);else p.applyChemMaster(pickFor, m);
    setPickFor(null);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.segWrap,
    className: "no-print"
  }, [["calc", "🧮 調合電卓"], ["chem", "🧪 薬剤・プリセット"]].map(v => /*#__PURE__*/React.createElement("button", {
    key: v[0],
    onClick: () => chooseView(v[0]),
    style: {
      ...S.seg,
      ...(calcView === v[0] ? S.segOn : {})
    }
  }, v[1]))), calcView === "chem" ? /*#__PURE__*/React.createElement(ChemMasterPanel, {
    chemMaster: p.chemMaster,
    addChemMaster: p.addChemMaster,
    deleteChemMaster: p.deleteChemMaster,
    editChemMaster: p.editChemMaster,
    presets: p.presets,
    loadPreset: p.loadPreset,
    deletePreset: p.deletePreset,
    volUnitKey: p.volUnitKey
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, pickFor !== null && /*#__PURE__*/React.createElement(ChemPickModal, {
    chemMaster: p.chemMaster,
    onPick: onPick,
    onCancel: () => setPickFor(null)
  }), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "薬液の調合計算"), /*#__PURE__*/React.createElement("div", {
    style: S.segWrap
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setMode("direct"),
    style: {
      ...S.seg,
      ...(p.mode === "direct" ? S.segOn : {})
    }
  }, "総量を直接入力"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setMode("area"),
    style: {
      ...S.seg,
      ...(p.mode === "area" ? S.segOn : {})
    }
  }, "面積から計算")), p.mode === "direct" ? /*#__PURE__*/React.createElement("div", {
    style: S.totalRow
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    step: "0.5",
    value: p.totalL,
    onChange: e => p.setTotalL(e.target.value),
    style: S.totalInput,
    className: "num",
    "aria-label": "総量(L)"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.totalUnit
  }, "L")) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: S.areaGrid
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "散布面積"), /*#__PURE__*/React.createElement("div", {
    style: S.inline
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: p.areaA,
    onChange: e => p.setAreaA(e.target.value),
    style: S.midInput,
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "a"))), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "10aあたり散布量"), /*#__PURE__*/React.createElement("div", {
    style: S.inline
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: p.ratePer10a,
    onChange: e => p.setRatePer10a(e.target.value),
    style: S.midInput,
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "L")))), /*#__PURE__*/React.createElement("div", {
    style: S.derived
  }, "必要総量 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 28
    },
    className: "num"
  }, fmt(p.effTotalL, 2)), " L"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.cardLabel,
      marginBottom: 0
    }
  }, "薬剤(名前・剤型・希釈倍率)"), p.lastMix && p.lastMix.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: p.loadLastMix,
    style: S.recallBtn
  }, "↩ 前回と同じ薬液")), /*#__PURE__*/React.createElement("datalist", {
    id: "chemlist"
  }, p.chemMaster.map(m => /*#__PURE__*/React.createElement("option", {
    key: m.name,
    value: m.name
  }))), p.calc.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: S.chemBlock
  }, /*#__PURE__*/React.createElement("div", {
    style: S.chemTop
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...S.dot,
      background: c.color
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: c.name,
    placeholder: "薬剤名(登録済みは候補表示)",
    list: "chemlist",
    onChange: e => p.updateChemName(c.id, e.target.value),
    style: S.nameInput
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setPickFor(c.id),
    style: S.chemPickBtn,
    title: "登録済みの薬剤から選ぶ",
    "aria-label": "登録薬剤から選ぶ"
  }, "📋"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.removeChem(c.id),
    style: S.removeBtn,
    disabled: p.chems.length <= 1,
    "aria-label": "削除"
  }, "✕")), /*#__PURE__*/React.createElement("div", {
    style: S.chemSelectRow
  }, /*#__PURE__*/React.createElement("select", {
    value: c.use || "fungicide",
    onChange: e => p.update(c.id, "use", e.target.value),
    style: {
      ...S.formSelect,
      flex: 1
    }
  }, USES.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.key,
    value: u.key
  }, u.label))), /*#__PURE__*/React.createElement("select", {
    value: c.form,
    onChange: e => p.update(c.id, "form", e.target.value),
    style: {
      ...S.formSelect,
      flex: 1
    }
  }, FORMS.map(f => /*#__PURE__*/React.createElement("option", {
    key: f.key,
    value: f.key
  }, f.label)))), /*#__PURE__*/React.createElement("div", {
    style: S.chemBottom
  }, /*#__PURE__*/React.createElement("div", {
    style: S.inline
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "1",
    placeholder: "倍率",
    value: c.ratio,
    onChange: e => p.update(c.id, "ratio", e.target.value),
    style: S.ratioInput,
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "倍")), /*#__PURE__*/React.createElement("div", {
    style: S.chemResult,
    className: "num"
  }, c.valid && p.totalMl > 0 ? /*#__PURE__*/React.createElement("span", null, "→ ", /*#__PURE__*/React.createElement("strong", null, fmt(c.ml)), " mL") : /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#aab5ac"
    }
  }, "—"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.addChem,
    style: {
      ...S.addBtn,
      marginTop: 0
    }
  }, "＋ 薬剤を追加"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setPickFor("new"),
    style: {
      ...S.addBtn,
      marginTop: 0
    }
  }, "📋 登録薬剤から追加"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "調合結果"), p.over && /*#__PURE__*/React.createElement("div", {
    style: S.alert
  }, "⚠ 薬剤の合計がタンク総量を超えています。倍率か総量を見直してください。"), /*#__PURE__*/React.createElement("div", {
    style: S.waterBox
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: "#2b5a7a"
    }
  }, "水の量"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 38,
      fontWeight: 800,
      lineHeight: 1.1
    },
    className: "num"
  }, p.over || p.totalMl <= 0 ? "—" : fmtL(p.waterMl), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 17
    }
  }, " L")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "#4a6a80"
    },
    className: "num"
  }, p.over || p.totalMl <= 0 ? "" : "（" + fmt(p.waterMl) + " mL）")), /*#__PURE__*/React.createElement(TankViz, {
    calc: p.calc,
    waterMl: p.waterMl,
    totalMl: p.totalMl,
    over: p.over
  })), /*#__PURE__*/React.createElement("table", {
    style: S.table
  }, /*#__PURE__*/React.createElement("tbody", null, p.calc.filter(c => c.valid).map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.id,
    style: S.tr
  }, /*#__PURE__*/React.createElement("td", {
    style: S.tdName
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...S.dot,
      background: c.color
    }
  }), c.name || "(無名)", /*#__PURE__*/React.createElement("span", {
    style: S.tdSub
  }, useLabel(c.use), "・", formLabel(c.form), "・", fmt(parseFloat(c.ratio)), "倍")), /*#__PURE__*/React.createElement("td", {
    style: S.tdMl,
    className: "num"
  }, fmt(c.ml), /*#__PURE__*/React.createElement("small", {
    style: S.unit
  }, " mL")))))), p.mixOrder.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.orderBox
  }, /*#__PURE__*/React.createElement("div", {
    style: S.orderTitle
  }, "推奨の混和順序"), /*#__PURE__*/React.createElement("ol", {
    style: S.orderList
  }, /*#__PURE__*/React.createElement("li", {
    style: S.orderItem
  }, /*#__PURE__*/React.createElement("span", {
    style: S.orderStep
  }, "1"), "タンクに水を半量ほど入れる"), p.mixOrder.map((c, i) => /*#__PURE__*/React.createElement("li", {
    key: c.id,
    style: S.orderItem
  }, /*#__PURE__*/React.createElement("span", {
    style: S.orderStep
  }, i + 2), /*#__PURE__*/React.createElement("span", {
    style: {
      ...S.dot,
      background: c.color
    }
  }), /*#__PURE__*/React.createElement("strong", null, c.name || "(無名)"), /*#__PURE__*/React.createElement("span", {
    style: S.tdSub
  }, formLabel(c.form), "・", fmt(c.ml), " mL"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 13,
      color: "#66756a"
    }
  }, "よく撹拌"))), /*#__PURE__*/React.createElement("li", {
    style: S.orderItem
  }, /*#__PURE__*/React.createElement("span", {
    style: S.orderStep
  }, p.mixOrder.length + 2), "残りの水を加えて全量にする")), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "※ 一般的な剤型順の目安です。", /*#__PURE__*/React.createElement("strong", null, "混用可否と順序は必ず各薬剤のラベル・メーカー指示を優先"), "してください。")), /*#__PURE__*/React.createElement("button", {
    onClick: p.savePreset,
    disabled: !p.ready,
    style: {
      ...S.primaryBtn,
      width: "100%",
      opacity: p.ready ? 1 : 0.4
    }
  }, "⭐ プリセットに保存"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "ここはタンク1杯分を計算するための電卓です。圃場への適用は「作業・記録」タブの「この日に使用した薬剤」で行います。何度も使う組み合わせは「⭐ プリセットに保存」で名前を付けて残すと、作業タブから読み込めます。"))));
}
function TankViz({
  calc,
  waterMl,
  totalMl,
  over
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: S.tank,
    role: "img",
    "aria-label": "タンク内訳"
  }, !over && totalMl > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      height: waterMl / totalMl * 100 + "%",
      background: "#4A90C4"
    }
  }), calc.filter(c => c.valid).map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: {
      height: c.ml / totalMl * 100 + "%",
      background: c.color,
      minHeight: c.ml > 0 ? 3 : 0
    }
  }))), (over || totalMl <= 0) && /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      background: over ? "#C74E36" : "#dfe6dc",
      opacity: 0.25
    }
  }));
}

// ═══════════════════ 作業・記録タブ ═══════════════════
function WorkTab(p) {
  const [query, setQuery] = useState("");
  const [reportingId, setReportingId] = useState(null);
  const [agriOpen, setAgriOpen] = useState(false); // アグリノート転記ビュー
  const [repFlights, setRepFlights] = useState([""]);
  const [repMemo, setRepMemo] = useState("");
  const [selected, setSelected] = useState([]);
  // 選択モードは1つだけ:"none"=通常 / "group"=まとめ散布 / "delete"=選択削除。
  // 1つの状態にまとめることで、2つの選択モードが同時に動いて取り違える事故を防いでいる。
  const [selMode, setSelMode] = useState("none");
  const groupMode = selMode === "group";
  const deleteMode = selMode === "delete";
  const [gSprayed, setGSprayed] = useState("");
  const [gMemo, setGMemo] = useState("");
  const [gFormOpen, setGFormOpen] = useState(false);
  // モード切替時は必ず選択をリセットする(前のモードの選択が残らないように)
  const switchMode = m => {
    setSelMode(prev => prev === m ? "none" : m);
    setSelected([]);
    setGFormOpen(false);
  };
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [ef, setEf] = useState({
    name: "",
    crop: "",
    area: "",
    areaA: ""
  });
  const [ratePerDay, setRatePerDay] = useState("");
  const [zoneFilter, setZoneFilter] = useState(""); // 圃場を追加するときの地区の絞り込み
  const [dayChemsOpen, setDayChemsOpen] = useState(false);
  // 実績入力済みの行は1行に畳む。開いている行のIDを1つだけ保持する
  const [openRowId, setOpenRowId] = useState(null);
  // 「未実施のみ表示」フィルタ
  const [onlyPending, setOnlyPending] = useState(false);
  // 作業タブの表示切替。"list"=作業一覧 / "map"=進捗地図。
  // 作業日と集計は両方で共通に出し、その下だけを差し替える。
  // 選んだ表示は端末に残す(見たい側が人によって違うため)
  const [workView, setWorkView] = useState(() => load("tankmix:workview", "list") === "map" ? "map" : "list");
  const chooseView = v => {
    setWorkView(v);
    save("tankmix:workview", v);
  };
  // 「今日の準備」は既定で畳む。まだ圃場が入っていない日は開いた状態で始める
  const [prepOpen, setPrepOpen] = useState(() => p.works.filter(w => w.workDate === p.workDate).length === 0);
  const [pickForDay, setPickForDay] = useState(false);
  const [chemTargetIds, setChemTargetIds] = useState([]); // 薬剤の適用先としてチェックした圃場ID
  const [dragId, setDragId] = useState(null); // ドラッグ中の圃場ID
  const [dragOverId, setDragOverId] = useState(null); // ドロップ先候補
  const [dragPos, setDragPos] = useState(null); // 指・ポインタの現在位置(フロートするチップの表示用)
  // 順送りナビで「飛ばす」を押した作業ID。その場限りの操作なので保存データには入れない
  const [naviSkipped, setNaviSkipped] = useState([]);
  const dragIdRef = useRef(null);
  // 作業日を切り替えたら「飛ばした」記録は破棄する(前の日の除外を持ち越さないため)
  useEffect(() => {
    setNaviSkipped([]);
  }, [p.workDate]);
  // 実績入力済みでも当日リストからは消さず、そのまま表示・編集できるようにする
  const dayList = p.works.filter(w => w.workDate === p.workDate);
  // 薬剤の一括適用・投下量計算など「未実施の圃場」だけを対象にすべき操作用
  const pendingDayList = dayList.filter(w => !w.reported);
  // 画面に出す行。「未実施のみ」がONなら実績入力済みを隠す(並べ替えは通常表示のときだけ)
  const shownList = onlyPending ? pendingDayList : dayList;
  // 次にやる圃場(この日の並び順で最初の未実施)
  // この日の並びで最初の未実施。一覧で「▶ 次の圃場」と印を付けるのに使う
  const nextWork = pendingDayList[0] || null;
  // タンクの累計と補給位置。state に持たず毎回 pendingDayList から導出するので、
  // 並べ替え・圃場の追加削除・実績入力のたびに自動で計算し直される
  const tankPlan = planTankRefills(pendingDayList, p.tankCapacityL);
  // 本日の投下量(L/10a)がまだ計算されていない圃場がある場合は警告バナーを出す
  const needsRateWarning = pendingDayList.some(w => !(parseFloat(w.plannedL) > 0));
  // 順送りナビの対象。nextWork(一覧の印)は壊さず、飛ばした分だけを別に除く
  const naviQueue = pendingDayList.filter(w => !naviSkipped.includes(w.id));
  const naviNext = naviQueue[0] || null;
  const history = p.works.filter(w => w.reported).sort((a, b) => b.id - a.id);
  // 送信はその日ぶんだけ。日付を切り替えないと他の日の記録は送られない
  const pendingWorks = dayList.filter(w => !w.synced || w.reported && !w.reportSynced);
  const pending = pendingWorks.length;

  // ドラッグ&ドロップ並べ替え(タッチ・マウス両対応)。共通処理を利用
  const onHandleDown = (e, id) => startDragReorder(e, id, "data-work-id", {
    ref: dragIdRef,
    setDragId,
    setDragOverId,
    setDragPos,
    onDrop: p.reorderWork
  });
  // 集計バーは「圃場数・合計面積・合計薬液量」なので、実績入力済みも含めた
  // その日のリスト全体で集計する(見出しの「合計」と中身を一致させる)
  const sumArea = dayList.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0);
  // AgriNote 転記やタンク補給の計算と同じ sprayVolumeL を使う。
  // 以前は実績入力後も予定量を足していたため、転記画面の数字と合わなかった
  const sumLiters = dayList.reduce((s, w) => s + sprayVolumeL(w), 0);
  // 実績を入力済みの圃場は実散布量で数えている。予定量との違いを黙って混ぜると
  // 調合タブの「必要総量」と合わずに混乱するので、件数を添えて分かるようにする
  const reportedCount = dayList.filter(w => w.reported).length;
  // 一括計算の予告。実際に書き換わる圃場だけを、書き換わる値そのもので合計する。
  // 以前は実績入力済みも含む全圃場の面積で概算していたため、押した結果と食い違っていた
  const rateNum = parseFloat(ratePerDay);
  const rateTargets = pendingDayList.filter(w => parseFloat(p.resolveWork(w).areaA) > 0);
  // 対象外の理由は「実績入力済み」と「面積未入力」で対処が違うので分けて数える。
  // まとめて実績扱いにすると、面積を直せば解決することに気づけない
  const rateSkipReported = dayList.length - pendingDayList.length;
  const rateSkipNoArea = pendingDayList.length - rateTargets.length;
  const rateArea = rateTargets.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0);
  const rateTotal = rateTargets.reduce((s, w) => s + plannedLFromArea(p.resolveWork(w).areaA, rateNum), 0);
  // 実績の一括入力の対象:散布済にしたが実散布量がまだ空で、面積が入っている圃場
  const bulkTargets = dayList.filter(w => w.reported && !(parseFloat(w.sprayedL) > 0) && parseFloat(p.resolveWork(w).areaA) > 0);
  const openReport = w => {
    const f = p.resolveWork(w);
    setReportingId(w.id);
    if (w.reported) {
      // 修正:すでに保存されている実績値を復元してその場で編集する
      const flights = Array.isArray(w.flights) && w.flights.length > 0 ? w.flights.map(v => String(v)) : [String(w.sprayedL || "")];
      setRepFlights(flights);
      setRepMemo(w.reportMemo || "");
    } else {
      // 初回入力は自動入力せず空欄から始める(誤入力・誤タップ防止)
      setRepFlights([""]);
      setRepMemo("");
    }
  };
  const flightSum = repFlights.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const setFlight = (i, v) => setRepFlights(repFlights.map((x, idx) => idx === i ? v : x));
  const addFlight = () => setRepFlights([...repFlights, ""]);
  const removeFlight = i => setRepFlights(repFlights.length > 1 ? repFlights.filter((_, idx) => idx !== i) : repFlights);
  const sendReport = () => {
    const flightsNum = repFlights.map(v => parseFloat(v) || 0);
    p.submitReport(reportingId, {
      sprayedL: flightSum,
      flights: flightsNum,
      memo: repMemo
    });
    setReportingId(null);
    setRepFlights([""]);
  };
  const toggleSelect = id => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const openGroupForm = () => {
    const members = p.works.filter(w => selected.includes(w.id));
    setGSprayed(String(members.reduce((s, w) => s + (w.totalL || 0), 0) || ""));
    setGMemo("");
    setGFormOpen(true);
  };
  const sendGroup = () => {
    p.submitGroupReport(selected, {
      sprayedL: gSprayed,
      memo: gMemo
    });
    setSelected([]);
    setSelMode("none");
    setGFormOpen(false);
  };
  // 選択削除:チェックした圃場をこの日のリストから外す
  const deleteSelected = () => {
    const names = p.works.filter(w => selected.includes(w.id)).map(w => p.resolveWork(w).name);
    if (names.length === 0) return;
    if (!confirm(names.length + "件の圃場をこの日のリストから外します。\n" + names.join("、") + "\n\n(圃場マスタには残ります。実績を入力済みの記録も消えます)\nよろしいですか？")) return;
    p.removeWorks(selected);
    setSelected([]);
    setSelMode("none");
  };
  // 一括削除:この日のリストを丸ごと空にする
  const deleteAllToday = () => {
    if (dayList.length === 0) return;
    if (!confirm(dateLabel(p.workDate) + "の作業リスト" + dayList.length + "件をすべて外します。\n\n(圃場マスタには残ります。実績を入力済みの記録も消えます)\nこの操作は取り消せません。よろしいですか？")) return;
    p.removeWorks(dayList.map(w => w.id));
    setSelected([]);
    setSelMode("none");
  };
  const startEditField = w => {
    const f = p.resolveWork(w);
    const master = p.fields.find(x => x.id === w.fieldId);
    if (!master) return;
    setEditingFieldId(master.id);
    setEf({
      name: f.name,
      crop: f.crop || "",
      area: master.area || "",
      areaA: String(f.areaA || "")
    });
  };
  const saveEditField = () => {
    if (!ef.name.trim()) return;
    const cropName = ef.crop.trim();
    if (cropName && p.addCrop) p.addCrop(cropName); // 入力された作物をマスタに自動登録
    p.upsertField({
      name: ef.name.trim(),
      crop: cropName,
      area: (ef.area || "").trim(),
      areaA: parseFloat(ef.areaA) || ""
    }, editingFieldId);
    setEditingFieldId(null);
  };
  // 「圃場を選んで」追加するときの候補。検索が空なら登録済みの全圃場を出す
  // (打たなくてもタップだけで追加できるように)
  // 検索と地区の絞り込みは重ねがけできる(「大津地区の中から探す」ができるように)
  // 絞り込んでいた地区が(圃場の編集で)なくなったら、絞り込みを解除した扱いにする。
  // そうしないと候補が0件のまま、解除するボタンも消えて戻せなくなる
  const activeZone = zoneFilter && (p.areas || []).indexOf(zoneFilter) >= 0 ? zoneFilter : "";
  const results = (query.trim() ? p.fields.filter(f => f.name.includes(query.trim()) || (f.crop || "").includes(query.trim())) : p.fields).filter(f => !activeZone || (f.area || "").trim() === activeZone);
  const orderInToday = fieldId => {
    const idx = dayList.findIndex(w => w.fieldId === fieldId);
    return idx >= 0 ? idx + 1 : 0;
  };
  const draggingWork = dragId != null ? dayList.find(w => w.id === dragId) : null;
  // ポップアップ用:編集中の圃場・実績入力中の作業(元データが消えていたら閉じた扱い)
  const editingField = editingFieldId != null ? p.fields.find(f => f.id === editingFieldId) : null;
  const reportingWork = reportingId != null ? p.works.find(w => w.id === reportingId) : null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, pickForDay && /*#__PURE__*/React.createElement(ChemPickModal, {
    chemMaster: p.chemMaster,
    onPick: m => {
      p.addDayChem(m);
      setPickForDay(false);
    },
    onCancel: () => setPickForDay(false)
  }), editingField && /*#__PURE__*/React.createElement(FieldEditModal, {
    mf: ef,
    setMf: setEf,
    crops: p.crops,
    areas: p.areas,
    onCancel: () => setEditingFieldId(null),
    onSave: saveEditField
  }), reportingWork && /*#__PURE__*/React.createElement(ReportModal, {
    fieldName: p.resolveWork(reportingWork).name,
    isFix: !!reportingWork.reported,
    flights: repFlights,
    setFlight: setFlight,
    addFlight: addFlight,
    removeFlight: removeFlight,
    areaLabel: (() => {
      const a = p.resolveWork(reportingWork).areaA;
      return a !== "" && a != null ? dispArea(a, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "未設定";
    })(),
    memo: repMemo,
    setMemo: setRepMemo,
    onCancel: () => setReportingId(null),
    onSave: sendReport
  }), agriOpen && /*#__PURE__*/React.createElement(AgriNoteModal, {
    works: p.works,
    resolveWork: p.resolveWork,
    flash: p.flash,
    onCancel: () => setAgriOpen(false)
  }),
  // v8.56: 画面下に固定していた「▶ 次の圃場／🚁 実績入力」の帯を外した。
  // 同じ内容が上の「順送りナビ」と各行の実績入力ボタンにあり、常に画面を
  // 塞ぐぶんだけ地図と一覧が狭くなっていた。
  draggingWork && dragPos && dragChip(dragPos, p.resolveWork(draggingWork).name), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "作業日"), /*#__PURE__*/React.createElement("div", {
    style: S.dateRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setWorkDate(shiftDate(p.workDate, -1)),
    style: S.orderBtn
  }, "◀"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: p.workDate,
    onChange: e => e.target.value && p.setWorkDate(e.target.value),
    style: S.dateInput,
    className: "num"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setWorkDate(shiftDate(p.workDate, 1)),
    style: S.orderBtn
  }, "▶"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setWorkDate(today()),
    style: {
      ...S.smallSecondary,
      whiteSpace: "nowrap"
    }
  }, "今日")), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.segWrap,
      marginTop: 12
    },
    className: "no-print"
  }, [["list", "📋 作業一覧"], ["map", "🚦 進捗地図"]].map(v => /*#__PURE__*/React.createElement("button", {
    key: v[0],
    onClick: () => chooseView(v[0]),
    style: {
      ...S.seg,
      ...(workView === v[0] ? S.segOn : {})
    }
  }, v[1]))), workView === "list" ? /*#__PURE__*/React.createElement("div", {
    style: S.totalsBar,
    className: "num"
  },/*#__PURE__*/React.createElement("div", {
    style: S.totalsItem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.totalsNum
  }, dayList.length), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "圃場数")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsItem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.totalsNum
  }, dispArea(sumArea, p.areaUnitKey), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " ", areaSuffix(p.areaUnitKey))), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "合計面積")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsItem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.totalsNum
  }, dispVol(sumLiters, p.volUnitKey), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " ", volSuffix(p.volUnitKey))), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "合計薬液量", reportedCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: S.totalsNote
  }, "実績 ", reportedCount, "件ぶんを含む")))) : /*#__PURE__*/React.createElement("div", {
    // 進捗地図のときは集計を大きなタイル3枚ではなじ1行に畳む。
    // タイルのままだとこのカードだけで340pxを使い、地図が画面の
    // 下半分からしか始まらない。数字の中身は一覧のときと同じ。
    style: {
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "baseline",
      marginTop: 10,
      fontSize: 15,
      fontWeight: 800,
      color: "#1C2B21"
    },
    className: "num"
  }, /*#__PURE__*/React.createElement("span", null, dayList.length, /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " 圃場")), /*#__PURE__*/React.createElement("span", null, dispArea(sumArea, p.areaUnitKey), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " ", areaSuffix(p.areaUnitKey))), /*#__PURE__*/React.createElement("span", null, dispVol(sumLiters, p.volUnitKey), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " ", volSuffix(p.volUnitKey)))),
  // 作業一覧向けの部品は、進捗地図のときは出さない。地図を見たいときに
  // 地図が画面の下半分へ押し出されていた。投下量の警告も、直す先の
  // 「今日の準備」が一覧側にしかないので揃える。
  workView === "list" && needsRateWarning &&/*#__PURE__*/React.createElement("div", {
    style: S.rateWarnBand,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", null, "⚠"), /*#__PURE__*/React.createElement("span", null, "本日の投下量(L/10a)が未入力の圃場があります。下の欄に入力して「面積から一括計算」を押してください。")), workView === "list" && dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.naviPanel,
    className: "no-print"
  }, naviNext ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.naviPanelLabel
  }, "順送りナビ (残り ", naviQueue.length, " 件)"), /*#__PURE__*/React.createElement("div", {
    style: S.naviPanelName
  }, "次の圃場: ", p.resolveWork(naviNext).name)), naviLink(fieldCenter(p.resolveWork(naviNext)), {
    ...S.naviBtn,
    flexShrink: 0
  }, "🚗 この圃場へナビ"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNaviSkipped(naviSkipped.concat([naviNext.id])),
    style: {
      ...S.smallSecondary,
      whiteSpace: "nowrap"
    }
  }, "⏭ この圃場は飛ばす")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.naviPanelName,
      flex: 1,
      minWidth: 0
    }
  }, "この日の圃場はすべて回りました"), naviSkipped.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setNaviSkipped([]),
    style: {
      ...S.smallSecondary,
      whiteSpace: "nowrap"
    }
  }, "↩ 飛ばした圃場を戻す"))), /*#__PURE__*/React.createElement(WorkProgress, {
    total: dayList.length,
    done: dayList.length - pendingDayList.length
  }), workView === "list" && p.dayChems.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setPrepOpen(true),
    style: S.dayChemStrip,
    className: "no-print"
  }, "🧪 ", p.dayChems.map(c => (c.name || "(無名)") + (c.ratio ? " " + c.ratio + "倍" : "")).join(" ／ "))), workView === "map" ? /*#__PURE__*/React.createElement(ProgressMapTab, {
    fields: p.fields,
    works: p.works,
    workDate: p.workDate,
    recorder: p.recorder,
    areaUnitKey: p.areaUnitKey,
    fetchProgress: p.fetchProgress,
    // 地図タブと同じエンジン設定を使う(無料地図 / Googleマップ)
    mapEngine: p.mapEngine,
    gmapKey: p.gmapKey,
    pullSec: p.pullSec,
    active: true
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, collapsibleHead("⚙ 今日の準備", prepOpen, () => setPrepOpen(!prepOpen)), prepOpen && /*#__PURE__*/React.createElement(React.Fragment, null, dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.rateBox
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "本日の散布投下量から予定薬液量をまとめて計算"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.inline
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    placeholder: "10a",
    value: ratePerDay,
    onChange: e => setRatePerDay(e.target.value),
    style: {
      ...S.midInput,
      width: 110
    },
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "L/10a")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      p.applyRatePerDay(ratePerDay);
    },
    disabled: !(parseFloat(ratePerDay) > 0),
    style: {
      ...S.smallPrimary,
      padding: "13px 16px",
      opacity: parseFloat(ratePerDay) > 0 ? 1 : 0.4
    }
  }, "面積から一括計算")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      p.bulkReportFromRate(ratePerDay);
    },
    disabled: !(parseFloat(ratePerDay) > 0) || bulkTargets.length === 0,
    style: {
      ...S.smallPrimary,
      width: "100%",
      padding: "13px 16px",
      marginTop: 8,
      background: "#B7791F",
      borderColor: "#8A5108",
      opacity: parseFloat(ratePerDay) > 0 && bulkTargets.length > 0 ? 1 : 0.4
    }
  }, "✓ 投下量から実績を一括入力(", bulkTargets.length, "圃場)"), /*#__PURE__*/React.createElement("div", {
    style: S.rateHint
  }, "実績は「散布済」にチェックを入れた圃場のうち、実散布量がまだ空のものだけに入ります(手で入れた値は上書きしません)。"), parseFloat(ratePerDay) > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.rateHint,
    className: "num"
  }, "対象 ", rateTargets.length, "圃場 ／ 合計 ", fmt(rateArea, 2), "a → ", fmt(rateTotal, 2), "L", rateSkipReported > 0 || rateSkipNoArea > 0 ? "(" + [rateSkipReported > 0 ? "実績入力済み " + rateSkipReported + "圃場は上書きしません" : "", rateSkipNoArea > 0 ? "面積未入力 " + rateSkipNoArea + "圃場は対象外です" : ""].filter(Boolean).join(" ／ ") + ")" : "")), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.prepBlock
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "この日に使用した薬剤(", p.dayChems.length, "件)"), dayChemsOpen && p.dayChems.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("この日の薬剤欄をすべて消しますか？\n(圃場に適用済みの内容は消えません)")) p.clearDayChems();
    },
    style: S.linkBtn
  }, "すべて消す")), !dayChemsOpen && /*#__PURE__*/React.createElement(React.Fragment, null, p.dayChems.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 4
    }
  }, "この日に使う薬剤(薬剤名と希釈倍率)を入力して、圃場に適用します。") : /*#__PURE__*/React.createElement("div", {
    style: S.dayChemSummary,
    className: "num"
  }, p.dayChems.map(c => (c.name || "(無名)") + (c.ratio ? " " + c.ratio + "倍" : "")).join(" ／ ")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      // 開くたびに未実施の圃場を初期選択しておく(全圃場に使うケースが一番多いため)
      setChemTargetIds(pendingDayList.map(w => w.id));
      setDayChemsOpen(true);
    },
    style: {
      ...S.smallPrimary,
      width: "100%",
      marginTop: 10,
      padding: "13px 0"
    }
  }, p.dayChems.length === 0 ? "＋ この日の薬剤を入力" : "✎ 薬剤を編集・圃場に適用")), dayChemsOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.zoneChem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.zoneChemHead
  }, "① 何を撒くか（この日に使う薬剤）"), p.dayChems.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "「＋ 薬剤を追加」で、この日に使う薬剤を入れてください。"), p.dayChems.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: S.dayChemRow
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: c.name,
    placeholder: "薬剤名(登録済みは候補表示)",
    list: "daychemlist",
    onChange: e => p.setDayChemName(c.id, e.target.value),
    style: {
      ...S.fieldInput,
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.removeDayChem(c.id),
    style: S.removeBtn,
    "aria-label": "この薬剤を外す"
  }, "✕")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: c.use || "other",
    onChange: e => p.updateDayChem(c.id, "use", e.target.value),
    style: {
      ...S.formSelect,
      flex: 1
    }
  }, USES.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.key,
    value: u.key
  }, u.label))), /*#__PURE__*/React.createElement("select", {
    value: c.form,
    onChange: e => p.updateDayChem(c.id, "form", e.target.value),
    style: {
      ...S.formSelect,
      flex: 1
    }
  }, FORMS.map(f => /*#__PURE__*/React.createElement("option", {
    key: f.key,
    value: f.key
  }, f.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "希釈倍率"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "1",
    placeholder: "例:1000",
    value: c.ratio,
    onChange: e => p.updateDayChem(c.id, "ratio", e.target.value),
    style: {
      ...S.midInput,
      flex: 1
    },
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "倍")))), /*#__PURE__*/React.createElement("datalist", {
    id: "daychemlist"
  }, p.chemMaster.map(m => /*#__PURE__*/React.createElement("option", {
    key: m.name,
    value: m.name
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => p.addDayChem(),
    style: {
      ...S.addBtnBlue,
      marginTop: 0
    }
  }, "＋ 薬剤を追加"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setPickForDay(true),
    style: {
      ...S.addBtnBlue,
      marginTop: 0
    }
  }, "📋 登録薬剤から追加")), (p.presets.length > 0 || p.lastMix && p.lastMix.length > 0) && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "よく使う組み合わせから読み込む"), p.lastMix && p.lastMix.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => p.fillDayChems(p.lastMix),
    style: {
      ...S.applyChemBtn,
      marginTop: 6
    }
  }, "↩ 前回と同じ薬液（", p.lastMix.map(c => (c.name || "無名") + " " + c.ratio + "倍").join("・"), "）"), p.presets.map(pr => /*#__PURE__*/React.createElement("button", {
    key: pr.id,
    onClick: () => p.fillDayChems(pr.chems),
    style: {
      ...S.applyChemBtn,
      marginTop: 6
    }
  }, "⭐ ", pr.name, "（", pr.chems.map(c => (c.name || "無名") + " " + c.ratio + "倍").join("・"), "）")))), /*#__PURE__*/React.createElement("div", {
    style: S.zoneField
  }, /*#__PURE__*/React.createElement("div", {
    style: S.zoneFieldHead
  }, "② どこに撒くか（適用先の圃場）"), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "チェックした圃場に適用します"),
  // 日によって圃場ごとに使う薬剤が変わるため、複数の圃場をチェックでまとめて選べるようにする
  /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginTop: 6,
      marginBottom: 8
    }
  }, [{
    label: "未実施すべて(" + pendingDayList.length + ")",
    ids: pendingDayList.map(w => w.id)
  }, {
    label: "この日すべて(" + dayList.length + ")",
    ids: dayList.map(w => w.id)
  }, {
    label: "選択解除",
    ids: []
  }].map(b => /*#__PURE__*/React.createElement("button", {
    key: b.label,
    onClick: () => setChemTargetIds(b.ids),
    style: S.chemPickQuick
  }, b.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 280,
      overflowY: "auto",
      marginBottom: 10
    }
  }, dayList.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "この日の作業リストが空です。先に圃場を追加してください。") : dayList.map(w => {
    const f = p.resolveWork(w);
    const on = chemTargetIds.includes(w.id);
    return /*#__PURE__*/React.createElement("div", {
      key: w.id,
      onClick: () => setChemTargetIds(on ? chemTargetIds.filter(id => id !== w.id) : chemTargetIds.concat(w.id)),
      style: {
        ...S.pickRow,
        marginBottom: 6,
        ...(on ? S.pickRowOn : {})
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.pickNum,
        ...(on ? S.pickNumOn : {})
      }
    }, on ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, w.reported ? "✅ " : "", f.name, w.chems && w.chems.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: S.tdSub
    }, "現在: ", w.chems.map(c => c.name || "無名").join("・"))), /*#__PURE__*/React.createElement("span", {
      style: S.tdSub,
      className: "num"
    }, w.reported ? "実績" + fmt(parseFloat(w.sprayedL) || 0, 1) + "L" : w.plannedL ? "予定" + fmt(parseFloat(w.plannedL), 1) + "L" : "予定なし"));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setDayChemsOpen(false),
    style: S.secondaryBtn
  }, "閉じる"), (() => {
    // この日のリストに残っている圃場だけを適用対象にする(日付を変えたときの選択残りを除く)
    const targets = chemTargetIds.filter(id => dayList.some(w => w.id === id));
    const ready = p.validDayChems.length > 0 && targets.length > 0;
    return /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (!ready) return;
        p.applyChemsToWorks(targets, p.validDayChems);
        setDayChemsOpen(false);
      },
      disabled: !ready,
      style: {
        ...S.primaryBtn,
        opacity: ready ? 1 : 0.4
      }
    }, "🚁 選択した", targets.length, "圃場に適用");
  })()), /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 8
    }
  }, "圃場ごとに使う薬剤が違う日は、チェックを付け替えて何度でも適用できます(適用のたびに、その圃場の薬剤は選んだ内容で置き換わります)。薬量は各圃場の予定薬液量 ÷ 希釈倍率で自動計算されます。予定薬液量が未設定の圃場は、先に上の「本日の散布投下量」で計算してください。✅付き(実績入力済み)の圃場は実散布量を基準に計算し、次回の送信でスプレッドシートの薬剤欄が更新されます。"))),/*#__PURE__*/React.createElement("div", {
    style: S.prepBlock
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "圃場を追加"), /*#__PURE__*/React.createElement(React.Fragment, null, (p.areas || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setZoneFilter(""),
    style: {
      ...S.cropPickChip,
      ...(activeZone === "" ? S.cropPickChipOn : {})
    }
  }, "すべて"), p.areas.map(a => /*#__PURE__*/React.createElement("button", {
    key: a,
    onClick: () => setZoneFilter(activeZone === a ? "" : a),
    style: {
      ...S.cropPickChip,
      ...(activeZone === a ? S.cropPickChipOn : {})
    }
  }, a))), activeZone && results.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => p.addWorks(results.map(f => f.id)),
    style: {
      ...S.smallPrimary,
      width: "100%",
      marginBottom: 8
    }
  }, "＋ 「", activeZone, "」の", results.length, "圃場をまとめて追加"), p.fields.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ圃場が登録されていません。", /*#__PURE__*/React.createElement("br", null), "データベースタブの🌾圃場で登録してください。") : /*#__PURE__*/React.createElement(React.Fragment, null, p.fields.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: query,
    placeholder: "🔍 圃場名・作物名で検索",
    onChange: e => setQuery(e.target.value),
    style: S.fieldInput
  }), query.trim() && results.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      marginTop: 10
    }
  }, "該当する圃場がありません。"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      maxHeight: 320,
      overflowY: "auto"
    }
  }, results.map(f => {
    const ord = orderInToday(f.id);
    return /*#__PURE__*/React.createElement("div", {
      key: f.id,
      style: S.listItem
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.listTitle
    }, f.name, f.crop ? "(" + f.crop + ")" : ""), /*#__PURE__*/React.createElement("div", {
      style: S.listSub,
      className: "num"
    }, f.areaA ? dispArea(f.areaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "面積未定")), ord > 0 ? /*#__PURE__*/React.createElement("span", {
      style: S.orderBadge,
      className: "num"
    }, "この日の ", ord, "番目") : /*#__PURE__*/React.createElement("button", {
      onClick: () => p.addWork(f.id),
      style: S.smallPrimary
    }, "＋この日へ"));
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 8
    }
  }, "タップした順にこの日のリストへ追加されます。地区を選ぶとまとめて追加できます。圃場の登録・編集は「データベース」タブで行えます。")))))), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, dateLabel(p.workDate), "の作業リスト(", dayList.length, "件)"), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, selMode === "none" && dayList.length > pendingDayList.length && /*#__PURE__*/React.createElement("button", {
    onClick: () => setOnlyPending(!onlyPending),
    style: onlyPending ? S.smallPrimary : S.smallSecondary
  }, onlyPending ? "すべて表示" : "未実施のみ"), /*#__PURE__*/React.createElement("button", {
    onClick: () => switchMode("group"),
    style: groupMode ? S.smallPrimary : S.smallSecondary
  }, groupMode ? "まとめ選択を終了" : "🔗 まとめ散布"), /*#__PURE__*/React.createElement("button", {
    onClick: () => switchMode("delete"),
    style: deleteMode ? S.smallDangerOn : S.smallSecondary
  }, deleteMode ? "削除選択を終了" : "🗑 選択して削除"))), deleteMode && /*#__PURE__*/React.createElement("div", {
    style: S.delBar
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: "#8a2f1c",
      flex: 1,
      minWidth: 120
    }
  }, "外したい圃場をタップで選択(", selected.length, "件)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelected(selected.length === dayList.length ? [] : dayList.map(w => w.id)),
    style: S.smallSecondary
  }, selected.length === dayList.length ? "選択を解除" : "すべて選択")), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: deleteSelected,
    disabled: selected.length === 0,
    style: {
      ...S.smallDanger,
      padding: "13px 0",
      opacity: selected.length === 0 ? 0.4 : 1
    }
  }, "🗑 選択した", selected.length, "件を外す"), /*#__PURE__*/React.createElement("button", {
    onClick: deleteAllToday,
    style: {
      ...S.smallDanger,
      padding: "13px 0"
    }
  }, "🗑 この日をすべて外す"))), dayList.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "この日の作業はまだ登録されていません。", /*#__PURE__*/React.createElement("br", null), "上の「⚙ 今日の準備」→「圃場を追加」で追加するか、データベースタブで圃場を登録してください。"), dayList.length > 1 && !groupMode && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 0,
      marginBottom: 10
    }
  }, "右の⣿マークを長押ししてドラッグすると、散布する順番を入れ替えられます。"), shownList.map((w, idx) => {
    const f = p.resolveWork(w);
    const master = p.fields.find(x => x.id === w.fieldId);
    // 実績入力済みの行は既定で1行に畳む(タップで開く)
    const collapsed = selMode === "none" && w.reported && openRowId !== w.id;
    // この日で次にやる圃場は目立たせる
    const isNext = selMode === "none" && nextWork && nextWork.id === w.id;
    // 補給の区切りは未実施の並びに対して打つ。実績入力済みの行が混ざっていても位置がズレない
    const tank = tankPlan[w.id] || null;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: w.id
    }, tank && tank.refill && /*#__PURE__*/React.createElement("div", {
      style: S.tankBand,
      className: "num"
    }, "⛽ ここで補給(タンク" + tank.refill.tankNo + "杯目 " + dispVol(tank.refill.usedL, p.volUnitKey) + " " + volSuffix(p.volUnitKey) + " / " + dispVol(tank.refill.capL, p.volUnitKey) + " " + volSuffix(p.volUnitKey) + ")"), /*#__PURE__*/React.createElement("div", {
      "data-work-id": w.id,
      style: {
        ...S.record,
        ...(groupMode && selected.includes(w.id) ? S.recordSelected : {}),
        ...(deleteMode && selected.includes(w.id) ? S.recordDeleting : {}),
        ...(selMode === "none" && w.reported && w.synced && w.reportSynced ? S.recordSent : {}),
        ...(isNext ? S.recordNext : {}),
        ...(dragId === w.id ? {
          opacity: 0.35,
          border: "2px dashed #B9C3B4"
        } : {}),
        ...(dragOverId === w.id && dragId !== w.id ? {
          outline: "2.5px solid #2E7D4F",
          outlineOffset: -2
        } : {})
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordHead
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        flex: 1
      }
    }, deleteMode ? /*#__PURE__*/React.createElement("button", {
      onClick: () => toggleSelect(w.id),
      style: {
        ...S.checkBtn,
        ...(selected.includes(w.id) ? S.checkBtnDanger : {})
      },
      "aria-label": "削除する圃場として選択"
    }, selected.includes(w.id) ? "✓" : "") : groupMode ? w.reported ? /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.checkBtn,
        opacity: 0.3
      },
      title: "実績入力済みのためまとめ選択の対象外です"
    }, "済") : /*#__PURE__*/React.createElement("button", {
      onClick: () => toggleSelect(w.id),
      style: {
        ...S.checkBtn,
        ...(selected.includes(w.id) ? S.checkBtnOn : {})
      }
    }, selected.includes(w.id) ? "✓" : "") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: () => p.toggleDone(w.id),
      style: {
        ...S.doneBox,
        ...(w.reported ? S.doneBoxOn : {})
      },
      title: w.reported ? "散布済を取り消す" : "散布済にする",
      "aria-label": w.reported ? "散布済を取り消す" : "散布済にする",
      "aria-pressed": w.reported ? "true" : "false"
    }, w.reported ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
      style: S.orderNum,
      className: "num"
    }, idx + 1)), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0,
        flex: 1
      }
    }, isNext && /*#__PURE__*/React.createElement("div", {
      style: S.nextTag
    }, "▶ 次の圃場"), /*#__PURE__*/React.createElement("div", {
      style: S.recordField
    }, f.name), /*#__PURE__*/React.createElement("div", {
      style: S.workMeta,
      className: "num"
    }, f.areaA ? /*#__PURE__*/React.createElement("span", null, dispArea(f.areaA, p.areaUnitKey), /*#__PURE__*/React.createElement("span", {
      style: S.workMetaUnit
    }, areaSuffix(p.areaUnitKey))) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#a08b5a"
      }
    }, "面積未定"), collapsed ? /*#__PURE__*/React.createElement("span", {
      style: S.workMetaSep
    }, "／ 実散布 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#2E7D4F"
      }
    }, dispVol(w.sprayedL, p.volUnitKey), /*#__PURE__*/React.createElement("span", {
      style: S.workMetaUnit
    }, volSuffix(p.volUnitKey)))) : w.plannedL ? /*#__PURE__*/React.createElement("span", {
      style: S.workMetaSep
    }, "／ 予定 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#2b5a7a"
      }
    }, dispVol(w.plannedL, p.volUnitKey), /*#__PURE__*/React.createElement("span", {
      style: S.workMetaUnit
    }, volSuffix(p.volUnitKey)))) : null,
    // 累計はその杯の中での合計。予定薬液量が未計算(0)の圃場には出さない
    tank && tank.planned > 0 && /*#__PURE__*/React.createElement("span", {
      style: S.workMetaSep
    }, "／ 累計 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#8a5a12"
      }
    }, dispVol(tank.cum, p.volUnitKey), /*#__PURE__*/React.createElement("span", {
      style: S.workMetaUnit
    }, volSuffix(p.volUnitKey)))), tank && tank.over && /*#__PURE__*/React.createElement("span", {
      style: S.tankOverWarn
    }, "⚠ この圃場だけでタンク容量を超えます")))), selMode === "none" && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "flex-end",
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: w.reported ? w.synced && w.reportSynced ? S.badgeOk : S.badgePending : w.chems.length > 0 ? S.badgeOk : S.badgePlan
    }, w.reported ? w.synced && w.reportSynced ? w.fromTeam ? "✓実施済(他端末)" : "✓送信済" : "実績入力済(未送信)" : w.chems.length > 0 ? "調合済" : "計画"), w.fromTeam && w.by && /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.smallLabel,
        fontSize: 11,
        color: "#2A5F80"
      },
      title: "この作業は他の端末から受け取りました"
    }, "👥 ", w.by), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        alignItems: "center"
      }
    }, w.reported ? /*#__PURE__*/React.createElement(React.Fragment, null, !collapsed && master && /*#__PURE__*/React.createElement("button", {
      onClick: () => startEditField(w),
      style: S.orderBtn,
      "aria-label": "編集"
    }, "✎"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setOpenRowId(openRowId === w.id ? null : w.id),
      style: S.orderBtn,
      "aria-label": collapsed ? "詳細を開く" : "詳細を閉じる"
    }, collapsed ? "▼" : "▲")) : /*#__PURE__*/React.createElement(React.Fragment, null, master && /*#__PURE__*/React.createElement("button", {
      onClick: () => startEditField(w),
      style: S.orderBtn,
      "aria-label": "編集"
    }, "✎"), /*#__PURE__*/React.createElement("span", {
      onPointerDown: e => onHandleDown(e, w.id),
      onTouchStart: e => onHandleDown(e, w.id),
      style: S.dragHandle,
      title: "ドラッグで並べ替え",
      "aria-label": "並べ替え"
    }, "⣿"))))), !collapsed && /*#__PURE__*/React.createElement("div", {
      style: S.recordBody
    }, w.chems.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: S.recordTotal,
      className: "num"
    }, "🧪 総量 ", /*#__PURE__*/React.createElement("strong", null, fmt(w.totalL, 2), " L"), "(薬剤", w.chems.length, "種):", w.chems.map(c => c.name + " " + c.ratio + "倍").join(" ／ ")), w.reported && /*#__PURE__*/React.createElement("div", {
      style: S.recordTotal,
      className: "num"
    }, "🚁 実散布 ", /*#__PURE__*/React.createElement("strong", null, dispVol(w.sprayedL, p.volUnitKey), " ", volSuffix(p.volUnitKey)), w.reportAreaA ? " ／ " + dispArea(w.reportAreaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "", w.flights && w.flights.length > 1 ? " ／ " + w.flights.length + "フライト" : "", (w.reportMemo || w.memo) && /*#__PURE__*/React.createElement("div", {
      style: S.memoLine
    }, "備考:", w.reportMemo || w.memo)), selMode === "none" && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 6
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => openReport(w),
      style: {
        ...S.reportBtn,
        flex: "1 1 130px",
        marginTop: 0
      }
    }, w.reported ? "✎ 実績を修正" : "🚁 実績入力"), naviLink(fieldCenter(f), {
      ...S.naviBtn,
      alignSelf: "stretch"
    }, "🚗 ナビ"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("「" + f.name + "」をこの日のリストから外しますか？\n" + (w.reported ? "入力済みの実績も消えます。\n" : "") + "(圃場マスタには残ります)")) p.removeWork(w.id);
      },
      style: {
        ...S.smallDanger,
        alignSelf: "stretch"
      }
    }, "外す")))));
  }), groupMode && selected.length >= 2 && !gFormOpen && /*#__PURE__*/React.createElement("button", {
    onClick: openGroupForm,
    style: {
      ...S.bigSendBtn,
      background: "#B78A1F",
      marginTop: 6
    }
  }, "🔗 選択した", selected.length, "圃場をまとめて実績入力"), groupMode && selected.length < 2 && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      textAlign: "center",
      marginTop: 8
    }
  }, "まとめたい圃場を2つ以上タップして選択してください"), gFormOpen && (() => {
    const members = p.works.filter(w => selected.includes(w.id));
    const areas = members.map(w => parseFloat(p.resolveWork(w).areaA) || 0);
    const areaSum = areas.reduce((s, a) => s + a, 0);
    const total = parseFloat(gSprayed) || 0;
    const useEqual = areaSum <= 0;
    let allocated = 0;
    const preview = members.map((w, i) => {
      let share;
      if (i === members.length - 1) share = Math.round((total - allocated) * 100) / 100;else {
        const r = useEqual ? 1 / members.length : areas[i] / areaSum;
        share = Math.round(total * r * 100) / 100;
        allocated += share;
      }
      return {
        name: p.resolveWork(w).name,
        area: areas[i],
        share
      };
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        ...S.reportForm,
        marginTop: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.smallLabel
    }, "連続散布の実績(", selected.length, "圃場)"), /*#__PURE__*/React.createElement("label", {
      style: {
        ...S.areaField,
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.smallLabel
    }, "フライト実績の合計散布量(L)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      inputMode: "decimal",
      min: "0",
      value: gSprayed,
      onChange: e => setGSprayed(e.target.value),
      style: S.midInput,
      className: "num"
    })), /*#__PURE__*/React.createElement("div", {
      style: S.anbunBox
    }, /*#__PURE__*/React.createElement("div", {
      style: S.anbunTitle
    }, useEqual ? "面積未入力のため均等割り" : "面積比で按分"), preview.map((pv, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: S.anbunRow,
      className: "num"
    }, /*#__PURE__*/React.createElement("span", null, pv.name, /*#__PURE__*/React.createElement("span", {
      style: S.tdSub
    }, pv.area ? fmt(pv.area, 1) + "a" : "面積未定")), /*#__PURE__*/React.createElement("strong", null, fmt(pv.share, 2), " L")))), /*#__PURE__*/React.createElement("input", {
      value: gMemo,
      placeholder: "備考(任意)",
      onChange: e => setGMemo(e.target.value),
      style: {
        ...S.fieldInput,
        marginTop: 10
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        ...S.btnRow,
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setGFormOpen(false),
      style: S.secondaryBtn
    }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
      onClick: sendGroup,
      style: S.primaryBtn
    }, "按分して保存")));
  })()), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "作業終了後に送信(", dateLabel(p.workDate), "ぶん・未送信 ", pending, "件)"), p.syncing && p.syncProgress.total > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.progressBox
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: "#2b5a7a"
    },
    className: "num"
  }, "送信中… ", p.syncProgress.done, " / ", p.syncProgress.total), /*#__PURE__*/React.createElement("button", {
    onClick: p.abortSync,
    style: S.abortBtn
  }, "■ 送信を中止")), /*#__PURE__*/React.createElement("div", {
    style: S.progressTrack
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.progressFill,
      width: (p.syncProgress.total > 0 ? p.syncProgress.done / p.syncProgress.total * 100 : 0) + "%"
    }
  }))), !p.gasUrl && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      marginBottom: 10
    }
  }, "送信先URLが未設定です。「⚙設定」タブで設定してください。"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.syncPending(),
    disabled: p.syncing || pending === 0 || !p.gasUrl,
    style: {
      ...S.bigSendBtn,
      opacity: p.syncing || pending === 0 || !p.gasUrl ? 0.45 : 1
    }
  }, p.syncing ? "送信中…" : !p.gasUrl ? "☁ 送信先が未設定です" : pending === 0 ? "☁ " + dateLabel(p.workDate) + "に送信するデータはありません" : "☁ " + dateLabel(p.workDate) + "の未送信 " + pending + "件を送信"), !p.syncing && pending > 0 && p.gasUrl && pendingWorks.length > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "特定の圃場から送信を再開する"), /*#__PURE__*/React.createElement("select", {
    value: "",
    onChange: e => {
      if (e.target.value) p.syncPending(Number(e.target.value));
    },
    style: {
      ...S.planSelect,
      marginTop: 6,
      marginBottom: 0
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "▼ この圃場から送信を開始"), pendingWorks.map(w => {
    const f = p.resolveWork(w);
    return /*#__PURE__*/React.createElement("option", {
      key: w.id,
      value: w.id
    }, f.name, w.reported ? "(実績)" : "(調合)");
  }))), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "送信されるのは", dateLabel(p.workDate), "ぶんだけです。電波のある場所で押してください。送信済みは二重登録されません。中止した場合は、上の選択から途中の圃場を選んで再開できます。"), p.pendingOtherDays > 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      marginTop: 8
    }
  }, "⚠ 他の日にも未送信が", p.pendingOtherDays, "件あります。上の「作業日」をその日に切り替えてから送信してください。")), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    id: "print-area"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    },
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "記録(完了 ", history.length, "件)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setAgriOpen(true),
    disabled: p.works.length === 0,
    style: {
      ...S.smallSecondary,
      opacity: p.works.length ? 1 : 0.4
    }
  }, "📋 アグリノート"), /*#__PURE__*/React.createElement("button", {
    onClick: p.exportCSV,
    disabled: p.works.length === 0,
    style: {
      ...S.smallPrimary,
      opacity: p.works.length ? 1 : 0.4
    }
  }, "CSV"), /*#__PURE__*/React.createElement("button", {
    onClick: () => window.print(),
    disabled: history.length === 0,
    style: {
      ...S.smallSecondary,
      opacity: history.length ? 1 : 0.4
    }
  }, "印刷"))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.cardLabel,
      display: "none"
    },
    className: "print-only"
  }, "散布記録一覧"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "none"
    },
    className: "print-only"
  }, history.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "完了した記録はまだありません。"), history.map(w => {
    const f = p.resolveWork(w);
    return /*#__PURE__*/React.createElement("div", {
      key: w.id,
      style: S.record
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordHead
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: S.recordDate,
      className: "num"
    }, w.reportDate || w.workDate), /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.recordField,
        marginLeft: 8
      }
    }, w.flightGroupId ? "🔗" : "", f.name, f.crop ? "(" + f.crop + ")" : ""), /*#__PURE__*/React.createElement("span", {
      style: w.synced && w.reportSynced ? S.badgeOk : S.badgePending,
      className: "no-print"
    }, w.synced && w.reportSynced ? "✓送信済" : "未送信")), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("この記録を削除しますか？")) p.deleteWork(w.id);
      },
      style: {
        ...S.smallDanger,
        padding: "6px 12px"
      },
      className: "no-print"
    }, "削除")), /*#__PURE__*/React.createElement("div", {
      style: S.recordBody
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordTotal,
      className: "num"
    }, "実散布 ", /*#__PURE__*/React.createElement("strong", null, dispVol(w.sprayedL, p.volUnitKey), " ", volSuffix(p.volUnitKey)), "(調合 ", fmt(w.totalL, 2), " L ／ 水 ", fmtL(w.waterMl), " L)", w.reportAreaA || f.areaA ? " ／ " + dispArea(w.reportAreaA || f.areaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : ""), w.flights && w.flights.length > 1 && /*#__PURE__*/React.createElement("div", {
      style: S.memoLine,
      className: "num"
    }, "🔋 ", w.flights.length, "フライト:", w.flights.map(fl => fmt(fl, 1) + "L").join(" + ")), w.chems.map((c, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: S.recordChem,
      className: "num"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.dot,
        background: SWATCHES[i % SWATCHES.length]
      }
    }), c.name, /*#__PURE__*/React.createElement("span", {
      style: S.tdSub
    }, formLabel(c.form), "・", c.ratio, "倍"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontWeight: 700
      }
    }, fmt(c.ml), " mL"))), (w.reportMemo || w.memo) && /*#__PURE__*/React.createElement("div", {
      style: S.memoLine
    }, "備考:", w.reportMemo || w.memo)));
  }))))); // 帯を外したので、その高さぶんの下余白(76px)も不要になった
}

// ═══════════════════ 作業の進捗バー ═══════════════════
// 現場で一番知りたい「あと何枚か」を常に見せる
function WorkProgress(p) {
  if (!p.total) return null;
  const rest = p.total - p.done;
  const pct = Math.round(p.done / p.total * 100);
  return /*#__PURE__*/React.createElement("div", {
    style: S.progWrap,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.progTop
  }, /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, rest > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, "あと ", /*#__PURE__*/React.createElement("strong", {
    style: S.progRest
  }, rest), " 圃場") : /*#__PURE__*/React.createElement("strong", {
    style: {
      ...S.progRest,
      color: "#2E7D4F"
    }
  }, "✓ この日は完了")), /*#__PURE__*/React.createElement("span", {
    style: S.progSub,
    className: "num"
  }, p.done, " / ", p.total, " 済")), /*#__PURE__*/React.createElement("div", {
    style: S.progBar
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.progFill,
      width: pct + "%"
    }
  })));
}

// ═══════════════════ 長押しドラッグで並べ替える共通処理 ═══════════════════
// attr で指定した data属性を持つ行を探し、指を離した位置の行へ移動する。
// 作業タブの圃場並べ替えで使う。
function startDragReorder(e, id, attr, o) {
  e.preventDefault();
  o.setDragId(id);
  o.ref.current = id;
  o.setDragOverId(id);
  const p0 = e.touches ? e.touches[0] : e;
  o.setDragPos({
    x: p0.clientX,
    y: p0.clientY
  });
  const rowAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("[" + attr + "]") : null;
  };
  const move = ev => {
    const pt = ev.touches ? ev.touches[0] : ev;
    o.setDragPos({
      x: pt.clientX,
      y: pt.clientY
    });
    const row = rowAt(pt.clientX, pt.clientY);
    if (row) {
      const overId = Number(row.getAttribute(attr));
      if (overId) o.setDragOverId(overId);
    }
  };
  const up = ev => {
    const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
    const row = rowAt(pt.clientX, pt.clientY);
    const fromId = o.ref.current;
    if (row) {
      const toId = Number(row.getAttribute(attr));
      if (toId && fromId && toId !== fromId) o.onDrop(fromId, toId);
    }
    o.setDragId(null);
    o.ref.current = null;
    o.setDragOverId(null);
    o.setDragPos(null);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("touchmove", move);
    window.removeEventListener("touchend", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("touchmove", move, {
    passive: false
  });
  window.addEventListener("touchend", up);
}

// ドラッグ中に指の位置へ浮かぶ名札
function dragChip(pos, label) {
  return /*#__PURE__*/React.createElement("div", {
    className: "no-print",
    style: {
      position: "fixed",
      left: pos.x,
      top: pos.y - 46,
      transform: "translateX(-50%)",
      zIndex: 900,
      pointerEvents: "none",
      background: "#1C2B21",
      color: "#fff",
      fontWeight: 800,
      fontSize: 14.5,
      padding: "9px 16px",
      borderRadius: 20,
      boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
      whiteSpace: "nowrap",
      maxWidth: "80vw",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "⣿ ", label);
}

// ═══════════════════ 登録薬剤の呼び出しポップアップ ═══════════════════
// データベースタブで登録した薬剤(名前・種類・剤型・希釈倍率)を一覧から選んで
// 調合タブの薬剤欄にそのまま入れる。倍率は入った後でも書き換えられる。
function ChemPickModal(p) {
  const [q, setQ] = useState("");
  // 絞り込みも正規化して突き合わせる(半角カナで打っても全角カナの登録に当たる)
  const nq = normalizeChemName(q);
  const list = nq ? p.chemMaster.filter(c => normalizeChemName(c.name).includes(nq) || useLabel(c.use).includes(nq)) : p.chemMaster;
  return /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    className: "no-print",
    onClick: p.onCancel
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "登録済みの薬剤から選ぶ"), p.chemMaster.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ薬剤が登録されていません。", /*#__PURE__*/React.createElement("br", null), "データベースタブの🧪薬剤で登録してください。") : /*#__PURE__*/React.createElement(React.Fragment, null, p.chemMaster.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: q,
    placeholder: "🔍 薬剤名・種類で検索",
    onChange: e => setQ(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), list.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "該当する薬剤がありません。"), list.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.name,
    onClick: () => p.onPick(c),
    style: S.chemPickRow
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: S.listSub
  }, useLabel(c.use), "・", formLabel(c.form)))))), /*#__PURE__*/React.createElement("button", {
    onClick: p.onCancel,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 14
    }
  }, "閉じる")));
}

// ═══════════════════ 散布実績の入力ポップアップ ═══════════════════
// 一覧のその場で開くので、入力欄を探して画面を動かす必要がない。
function ReportModal(p) {
  const sum = p.flights.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  return /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    className: "no-print",
    onClick: p.onCancel
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, p.isFix ? "散布実績の修正" : "散布実績の入力"), /*#__PURE__*/React.createElement("div", {
    style: S.recordField
  }, p.fieldName), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "フライトごとの散布量(L)"), p.flights.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.flightNum,
    className: "num"
  }, i + 1), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: v,
    placeholder: "散布量",
    onChange: e => p.setFlight(i, e.target.value),
    style: {
      ...S.midInput,
      flex: 1
    },
    className: "num",
    autoFocus: i === 0
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "L"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.removeFlight(i),
    disabled: p.flights.length <= 1,
    style: {
      ...S.removeBtn,
      opacity: p.flights.length <= 1 ? 0.3 : 1
    },
    "aria-label": "このフライトを削除"
  }, "✕"))), /*#__PURE__*/React.createElement("button", {
    onClick: p.addFlight,
    style: {
      ...S.addBtn,
      marginTop: 8,
      padding: "11px 0"
    }
  }, "＋ フライトを追加(バッテリー交換など)"), /*#__PURE__*/React.createElement("div", {
    style: S.flightSumBox,
    className: "num"
  }, "実散布量 合計 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 22
    }
  }, fmt(sum, 2)), " L", p.flights.length > 1 ? /*#__PURE__*/React.createElement("span", {
    style: S.tdSub
  }, "(", p.flights.length, "フライト)") : null)), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "散布面積は圃場に登録された面積(", p.areaLabel, ")がそのまま記録されます。面積を直すときは一覧の✎から編集してください。"), /*#__PURE__*/React.createElement("input", {
    value: p.memo,
    placeholder: "備考(残液・中断理由など任意)",
    onChange: e => p.setMemo(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.onCancel,
    style: S.secondaryBtn
  }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
    onClick: p.onSave,
    style: S.primaryBtn
  }, "実績を保存"))));
}

// ═══════════════════ アグリノート転記ビュー ═══════════════════
// 実績・調合を「同じ作業日 × 同じ調合」でまとめ、AgriNote の1レコード分
// (圃場一覧・合計面積・散布液量合計・各農薬の希釈倍数と使用量)を作って
// コピーしやすく並べる。使用量は AgriNote と同じ式(散布液量 ÷ 希釈倍数)で計算。

// 固形の剤型。使用量を kg で出すものを列挙し、それ以外(液状)は mL で出す。
// AgriNote 側の使用量の単位と合わせるための対応表。
const SOLID_FORM_KEYS = ["wp", "wg", "sp", "sg", "gr", "dl", "jumbo", "paste"];
const agriAmountUnit = formKey => SOLID_FORM_KEYS.indexOf(formKey) >= 0 ? "kg" : "mL";

// 末尾の余分なゼロだけを落とす。小数点を含まない文字列には手を触れない
// ("100" から "00" を削って "1" になるような誤削除を防ぐ)。
const stripTrailingZeros = s => s.indexOf(".") < 0 || s.indexOf("e") >= 0 ? s : s.replace(/0+$/, "").replace(/\.$/, "");

// 転記用の数値表記。指定桁で丸めたうえで余分なゼロを落とす。
// 丸めると 0 になってしまう小さな値は、0 と誤解されないよう有効数字で見せる。
const agriNum = (value, digits) => {
  const n = Number(value);
  if (!isFinite(n)) return "";
  if (n === 0) return "0";
  const rounded = stripTrailingZeros(n.toFixed(digits == null ? 3 : digits));
  return Number(rounded) === 0 ? stripTrailingZeros(n.toPrecision(2)) : rounded;
};

// 薬剤名のゆれ(半角カナ・全角英数)を吸収する。chemdb.json 側も同じ正規化を
// かけてあるので、登録番号検索から登録した薬剤と手入力の薬剤が同じ名前に揃う。
const normalizeChemName = name => (name || "").normalize("NFKC").trim();

// 面積(a)と10aあたりの散布量(L)から薬液量(L)を出す。端数は小数第2位で丸める。
// 調合タブ・作業タブの一括計算・その予告表示は必ずこの関数を通すこと。
// 別々に式を書くと、同じ面積・同じ投下量でもタブごとに端数が違う値になる。
const plannedLFromArea = (areaA, ratePer10a) => {
  const a = parseFloat(areaA) || 0;
  const r = parseFloat(ratePer10a) || 0;
  if (!(a > 0) || !(r > 0)) return 0;
  return Math.round(a / 10 * r * 100) / 100;
};

// その圃場の散布液量(L)。実績があれば実散布量、まだなら調合上の予定量を使う。
const sprayVolumeL = work => work.reported && parseFloat(work.sprayedL) > 0 ? parseFloat(work.sprayedL) : parseFloat(work.totalL) > 0 ? parseFloat(work.totalL) : parseFloat(work.plannedL) || 0;

// 作業記録を「作業日 × 調合内容」でまとめ、AgriNote の1レコード分に整形する。
function buildAgriGroups(works, resolveWork) {
  const groups = new Map();
  (works || []).forEach(work => {
    // 日付のない記録は転記先(AgriNoteの1レコード)を決められないので除く。
    // 見出しの日付表示でも落ちるため、ここで確実に弾いておく。
    if (!work.workDate) return;
    // 倍率の入っていない薬剤は使用量を計算できないので対象外
    const validChems = (work.chems || []).filter(c => c.name && parseFloat(c.ratio) > 0);
    if (validChems.length === 0) return;
    // 名前と倍率は正規化してから鍵にする。"16" と "16.0"、半角カナと全角カナが
    // 別グループに割れて転記が二度手間になるのを防ぐため。
    const mix = validChems.map(c => ({
      name: normalizeChemName(c.name),
      form: c.form,
      ratio: parseFloat(c.ratio)
    }));
    // 剤型も鍵に含める。同名・同倍率でも水和剤(kg)と乳剤(mL)では
    // 転記する単位が違うので、まとめると先に出た方の単位に引きずられる
    const mixKey = mix.map(c => c.name + "@" + c.ratio + "@" + (c.form || "")).sort().join("|");
    const groupKey = work.workDate + "##" + mixKey;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        date: work.workDate,
        chems: mix,
        fieldMap: new Map(),
        sprayL: 0
      };
      groups.set(groupKey, group);
    }
    const field = resolveWork(work);
    // 同じ圃場に同日・同じ調合の記録が2件あっても、圃場と面積は1回だけ数える
    // (AgriNote では圃場を1回しか選べないため)。散布液量だけは合算する。
    const fieldKey = work.fieldId != null ? "id:" + work.fieldId : "name:" + field.name;
    const known = group.fieldMap.get(fieldKey);
    if (known) {
      if (work.reported) known.reported = true;
    } else {
      group.fieldMap.set(fieldKey, {
        name: field.name,
        areaA: parseFloat(work.reportAreaA || field.areaA) || 0,
        reported: !!work.reported
      });
    }
    group.sprayL += sprayVolumeL(work);
  });
  return Array.from(groups.values()).map(group => {
    const fields = Array.from(group.fieldMap.values());
    return {
      key: group.key,
      date: group.date,
      fields,
      areaA: fields.reduce((sum, f) => sum + f.areaA, 0),
      sprayL: group.sprayL,
      reportedCount: fields.filter(f => f.reported).length,
      chemRows: group.chems.map(chem => {
        const amountL = group.sprayL / chem.ratio; // 散布液量 ÷ 希釈倍数
        const unit = agriAmountUnit(chem.form);
        return {
          name: chem.name,
          ratio: chem.ratio,
          form: chem.form,
          unit,
          amount: unit === "kg" ? amountL : amountL * 1000
        };
      })
    };
  }).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}

// クリップボードへコピーする。navigator.clipboard は https か localhost でしか
// 使えないため、失敗したときは textarea 経由の従来手段にフォールバックする。
function copyToClipboard(text, onDone) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    if (ok && onDone) onDone();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => onDone && onDone(), fallback);else fallback();
}
const agriRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 0",
  borderTop: "1px solid #eef2f7"
};
const agriValueStyle = {
  fontWeight: 700,
  fontSize: 15
};
function AgriNoteModal(p) {
  const groups = React.useMemo(() => buildAgriGroups(p.works, p.resolveWork), [p.works, p.resolveWork]);
  const copyBtn = (text, label) => /*#__PURE__*/React.createElement("button", {
    onClick: () => copyToClipboard(text, () => p.flash && p.flash(label + "をコピーしました")),
    title: label + "をコピー",
    style: {
      marginLeft: 6,
      padding: "2px 8px",
      fontSize: 13,
      border: "1px solid #cbd5e1",
      borderRadius: 6,
      background: "#f8fafc",
      cursor: "pointer",
      flex: "0 0 auto"
    }
  }, "⧉");
  // 「圃場」行。AgriNote へは1行1圃場で貼れるよう、コピー時だけ改行区切りにする
  const fieldsRow = group => /*#__PURE__*/React.createElement("div", {
    style: agriRowStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.tdSub
  }, "圃場"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      wordBreak: "break-all"
    }
  }, group.fields.map(f => f.name).join("、"))), copyBtn(group.fields.map(f => f.name).join("\n"), "圃場一覧"));
  const sprayRow = group => /*#__PURE__*/React.createElement("div", {
    style: agriRowStyle
  }, /*#__PURE__*/React.createElement("div", null, "散布液量 合計", group.areaA > 0 && /*#__PURE__*/React.createElement("span", {
    style: S.tdSub
  }, "  (", agriNum(group.sprayL / (group.areaA / 10), 4), " L/10a)")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: agriValueStyle
  }, agriNum(group.sprayL, 3), " L"), copyBtn(agriNum(group.sprayL, 3), "散布液量")));
  const chemRow = (chem, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: agriRowStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, chem.name), /*#__PURE__*/React.createElement("div", {
    style: S.tdSub
  }, formLabel(chem.form))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, chem.ratio, "倍"), copyBtn(String(chem.ratio), "希釈倍数"), /*#__PURE__*/React.createElement("span", {
    style: agriValueStyle
  }, agriNum(chem.amount, 3), " ", chem.unit), copyBtn(agriNum(chem.amount, 3), "使用量")));
  const groupCard = group => /*#__PURE__*/React.createElement("div", {
    key: group.key,
    style: {
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      padding: 12,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 15,
      marginBottom: 6
    }
  }, dateLabel(group.date), "  ", /*#__PURE__*/React.createElement("span", {
    style: S.tdSub
  }, group.fields.length, "圃場・", fmt(group.areaA, 2), " a", group.reportedCount < group.fields.length ? "(未実績あり)" : "")), fieldsRow(group), sprayRow(group), group.chemRows.map(chemRow));
  return /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    className: "no-print",
    onClick: p.onCancel
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "#fff",
      borderRadius: 12,
      padding: 16,
      width: "min(560px, 94vw)",
      maxHeight: "88vh",
      overflowY: "auto",
      boxShadow: "0 10px 40px rgba(0,0,0,.3)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "📋 アグリノート転記"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "「同じ日 × 同じ調合」でまとめた1グループが、AgriNote の1レコードに対応します。⧉ で数値をコピーして貼り付けてください。使用量 = 散布液量 ÷ 希釈倍数(AgriNote と同じ式)。単位は剤型からの推定です。"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "アグリノートはウォーターセル株式会社の商標です。本アプリは同社とは関係ありません。"), groups.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "薬剤が入力された記録がありません。") : groups.map(groupCard), /*#__PURE__*/React.createElement("button", {
    onClick: p.onCancel,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 14
    }
  }, "閉じる")));
}

// ═══════════════════ 農薬登録番号での検索 → 薬剤マスタ登録 ═══════════════════
// FAMICの農薬登録情報(基本部)を使い、登録番号・農薬名・成分名で検索して、
// その場で薬剤マスタ(プリセット)に登録できるようにする。
//
// ⚠ データはアプリに同梱していない。FAMICの利用規約
//   (https://www.famic.go.jp/docs/rule/) が「無断で改変を行うことはできない」
//   「許可なく商業目的での利用を禁止」としており、列を抜き出してJSONに変換した
//   加工物を公開リポジトリで再配布する形は取れないと判断したため。
//   代わりに、各利用者が tools/update_chemdb.py で自分の chemdb.json を作り、
//   自分のGoogleドライブに置き、自分のApps Script(Code.gs の chemdbLoad)経由で
//   端末に取り込む。取り込んだデータはこの端末の IndexedDB に入る。
//
// 1件は {n:登録番号, nm:農薬名, u:用途キー, f:剤型キー, ig:有効成分, mk:登録者}。
// 容量を抑えるためキー名を短くしてある。生成は tools/update_chemdb.py。
const CHEM_SEARCH_LIMIT = 200; // 一度に表示する検索結果の上限

// ── 農薬データの保存先(IndexedDB) ──
// 約940KBある。localStorage に入れると作業記録・圃場・プリセットと合わせて
// 5MB の上限に近づき、記録の保存が静かに失敗する事故につながる。
// 使うのはキー1つだけなので、汎用ライブラリは足さず最小のラッパで済ませる。
const CHEMDB_DB_NAME = "tankmix";
const CHEMDB_STORE = "chemdb";
const CHEMDB_KEY = "current"; // 保存する値は {data:[...], savedAt:ISO文字列, count:件数}
function chemDbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      reject(new Error("この端末ではIndexedDBが使えません"));
      return;
    }
    const req = indexedDB.open(CHEMDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHEMDB_STORE)) db.createObjectStore(CHEMDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDBを開けません"));
    // プライベートブラウジングなどで許可待ちのまま固まることがある。
    // 開けないまま画面が「読み込み中…」で止まらないよう、失敗として扱う。
    req.onblocked = () => reject(new Error("IndexedDBを開けません"));
  });
}
function chemDbTx(mode, run) {
  return chemDbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(CHEMDB_STORE, mode);
    const req = run(tx.objectStore(CHEMDB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDBの操作に失敗しました"));
    tx.oncomplete = () => db.close();
  }));
}
const chemDbGetRecord = () => chemDbTx("readonly", s => s.get(CHEMDB_KEY));
const chemDbPutRecord = rec => chemDbTx("readwrite", s => s.put(rec, CHEMDB_KEY));
const chemDbDeleteRecord = () => chemDbTx("readwrite", s => s.delete(CHEMDB_KEY));

let chemDbCache = null;
let chemDbLoading = null;
// 取り込み・削除のあとに呼ぶ。メモリ上の写しを捨てて、次の検索で読み直させる
function resetChemDbCache() {
  chemDbCache = null;
  chemDbLoading = null;
}
// 未取り込みであることを、通信エラー等と区別できるようにする印
const CHEMDB_NOT_IMPORTED = "chemdb-not-imported";
function loadChemDb() {
  if (chemDbCache) return Promise.resolve(chemDbCache);
  if (!chemDbLoading) chemDbLoading = chemDbGetRecord().then(rec => {
    if (!rec || !Array.isArray(rec.data) || rec.data.length === 0) {
      const e = new Error("農薬データが取り込まれていません");
      e.code = CHEMDB_NOT_IMPORTED;
      throw e;
    }
    chemDbCache = rec.data;
    return rec.data;
  }).catch(err => {
    // 失敗した Promise を残すと、取り込んだあとも二度と読めなくなる
    chemDbLoading = null;
    throw err;
  });
  return chemDbLoading;
}
// 設定タブの状態表示用。本体(data)を読まずに件数と日付だけ欲しいところだが、
// IndexedDB は値の一部だけを取り出せないので、結局まるごと読む。
// 開くのは設定タブを表示したときの1回だけなので、これで足りる。
function chemDbMeta() {
  return chemDbGetRecord().then(rec => {
    if (!rec || !Array.isArray(rec.data) || rec.data.length === 0) return null;
    return {
      count: rec.count || rec.data.length,
      savedAt: rec.savedAt || ""
    };
  }).catch(() => null);
}

// chemdb.json は「登録番号 × 有効成分」で行が分かれているため、同じ登録番号が
// 複数行ある(例: No.23646 ベジセイバーは ペンチオピラド と TPN の2行、6275行中
// 1617番号ぶんが重複)。行のまま並べると同じ薬剤が何度も出るうえ、React の key に
// 登録番号を使うと key が重複し、再描画で前回の検索結果の行が残ってしまう。
// そこで検索は「登録番号ごとに1件へ集約」して返し、有効成分は「・」で連結する。
// 並び順は 完全一致 → 前方一致 → 部分一致。打ち切りは呼び出し側で並べ替え後に
// 行う(先頭N件で走査を止めると、関連度の高い候補が落ちるため全件走査する)。
function searchChemDb(chemDb, query, byNo, byName, byIngredient) {
  // 半角カナ・全角英数のゆれを吸収(DB側は生成時にNFKC正規化済み)
  const normalized = query.normalize("NFKC");
  const lower = normalized.toLowerCase();
  // 一致の強さ。0=完全一致 1=前方一致 2=部分一致 -1=不一致
  const rankOf = (value, needle) => {
    if (value === needle) return 0;
    const at = value.indexOf(needle);
    if (at === 0) return 1;
    return at > 0 ? 2 : -1;
  };
  const stronger = (a, b) => b < 0 ? a : a < 0 ? b : Math.min(a, b);
  const byNumber = new Map(); // 登録番号 -> 集約した1件
  const order = []; // Map の列挙順に頼らず、DB の出現順を明示的に保つ
  for (let i = 0; i < chemDb.length; i++) {
    const chem = chemDb[i];
    let rank = -1;
    if (byNo) rank = stronger(rank, rankOf(String(chem.n), normalized));
    if (byName && chem.nm) rank = stronger(rank, rankOf(chem.nm.toLowerCase(), lower));
    if (byIngredient && chem.ig) rank = stronger(rank, rankOf(chem.ig.toLowerCase(), lower));
    if (rank < 0) continue;
    const key = String(chem.n);
    const hit = byNumber.get(key);
    if (!hit) {
      byNumber.set(key, {
        key: key,
        n: chem.n,
        nm: chem.nm,
        u: chem.u,
        f: chem.f,
        igs: [],
        rank: rank,
        seq: order.length
      });
      order.push(key);
    } else if (rank < hit.rank) {
      // 同じ登録番号の別の行で当たった場合は、より強い一致のほうを採用する
      hit.rank = rank;
    }
  }
  // 有効成分は「その登録番号の全行」から集める。成分名で検索したときに
  // 当たった成分だけが出ると、混合剤なのに片方しか見えず誤解を招くため。
  for (let i = 0; i < chemDb.length; i++) {
    const chem = chemDb[i];
    if (!chem.ig) continue;
    const hit = byNumber.get(String(chem.n));
    if (hit && hit.igs.indexOf(chem.ig) < 0) hit.igs.push(chem.ig);
  }
  const rows = order.map(key => byNumber.get(key));
  // 同順位は DB の並び順(seq)を保つ。sort の安定性に依存しない書き方にしておく
  rows.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  return rows.map(r => ({
    key: r.key,
    n: r.n,
    nm: r.nm,
    u: r.u,
    f: r.f,
    ig: r.igs.join("・")
  }));
}
function ChemSearchModal(p) {
  const [chemDb, setChemDb] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [byNo, setByNo] = useState(true);
  const [byName, setByName] = useState(true);
  const [byIngredient, setByIngredient] = useState(false);
  const [justAdded, setJustAdded] = useState({}); // 登録番号 -> true(この画面で登録した印)
  useEffect(() => {
    let alive = true;
    loadChemDb().then(data => {
      if (alive) setChemDb(data);
    }).catch(() => {
      if (alive) setLoadFailed(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const query = keyword.trim();
  const matched = React.useMemo(() => {
    if (!chemDb || !query) return [];
    return searchChemDb(chemDb, query, byNo, byName, byIngredient);
  }, [chemDb, query, byNo, byName, byIngredient]);
  // 打ち切りは並べ替えの後。表示件数と実際に描画する行数を必ず一致させるため、
  // 件数表示にもこの results.length をそのまま使う。
  const results = matched.length > CHEM_SEARCH_LIMIT ? matched.slice(0, CHEM_SEARCH_LIMIT) : matched;
  // 登録済み判定も正規化して比べる。手入力した半角カナの薬剤と、ここから登録した
  // 全角の薬剤が別物と見なされて二重登録されるのを防ぐ。
  const registeredNames = React.useMemo(() => (p.existingNames || []).map(normalizeChemName), [p.existingNames]);
  // justAdded の印は集約キー(=登録番号の文字列)で持つ。集約後は1登録番号=1行なので、
  // 同じ番号の別行に印が波及することはない。
  const isRegistered = chem => !!justAdded[chem.key] || registeredNames.indexOf(normalizeChemName(chem.nm)) >= 0;
  const register = chem => {
    p.onPick({
      name: chem.nm,
      use: chem.u,
      form: chem.f
    });
    setJustAdded(prev => {
      const next = {
        ...prev
      };
      next[chem.key] = true;
      return next;
    });
  };
  const filterCheck = (checked, setChecked, label) => /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      marginRight: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    onChange: e => setChecked(e.target.checked)
  }), label);
  return /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    className: "no-print",
    onClick: p.onCancel
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "#fff",
      borderRadius: 12,
      padding: 16,
      width: "min(560px,94vw)",
      maxHeight: "88vh",
      overflowY: "auto",
      boxShadow: "0 10px 40px rgba(0,0,0,.3)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "🔢 農薬を登録番号・名称で検索"), /*#__PURE__*/React.createElement("input", {
    value: keyword,
    autoFocus: true,
    placeholder: "🔍 登録番号・農薬名・成分名",
    onChange: e => setKeyword(e.target.value),
    style: S.fieldInput
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "10px 0"
    }
  }, "絞り込み　", filterCheck(byNo, setByNo, "登録番号"), filterCheck(byName, setByName, "農薬名"), filterCheck(byIngredient, setByIngredient, "成分名")), loadFailed ? /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "農薬データが取り込まれていません。設定タブの「農薬データ」から取り込んでください。") : !chemDb ? /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "農薬データを読み込み中…") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "検索結果：", query ? results.length + "件" + (matched.length > CHEM_SEARCH_LIMIT ? "以上(絞り込んでください)" : "") : "キーワードを入力してください"), results.map(chem => /*#__PURE__*/React.createElement("button", {
    key: chem.key,
    onClick: () => register(chem),
    disabled: isRegistered(chem),
    style: {
      ...S.chemPickRow,
      opacity: isRegistered(chem) ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, chem.nm), /*#__PURE__*/React.createElement("div", {
    style: S.listSub
  }, "No.", chem.n, "・", useLabel(chem.u), "・", formLabel(chem.f), chem.ig ? "・" + chem.ig : "")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: isRegistered(chem) ? "#16a34a" : "#2563eb"
    }
  }, isRegistered(chem) ? "✓登録済" : "＋登録")))), /*#__PURE__*/React.createElement("p", {
    // 出典はコード内のコメントだけでなく、データを使う画面に常時出しておく
    style: {
      ...S.note,
      marginTop: 14,
      borderTop: "1px solid #e2e8e4",
      paddingTop: 10
    }
  }, "出典: 独立行政法人農林水産消費安全技術センター(FAMIC)「農薬登録情報ダウンロード」を加工して作成。農薬名は各社の商標または登録商標です。取り込んであるのは特定時点のデータで、登録情報は変わります。使用前に必ずラベルを確認してください。"), /*#__PURE__*/React.createElement("button", {
    onClick: p.onCancel,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 14
    }
  }, "閉じる")));
}

// ═══════════════════ 圃場の編集ポップアップ ═══════════════════
// 一覧のその場で開くので、編集のたびに画面上部まで戻る必要がない。
// 保存すると圃場マスタが更新され、作業タブの表示にも同時に反映される。
function FieldEditModal(p) {
  const set = (k, v) => p.setMf({
    ...p.mf,
    [k]: v
  });
  const crops = p.crops || [];
  const areas = p.areas || [];
  const canSave = p.mf.name.trim().length > 0;
  return /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    className: "no-print",
    onClick: p.onCancel
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "圃場を編集"), /*#__PURE__*/React.createElement("datalist", {
    id: "croplist-edit"
  }, crops.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }))), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "圃場名 ※必須"), /*#__PURE__*/React.createElement("input", {
    value: p.mf.name,
    placeholder: "圃場名",
    onChange: e => set("name", e.target.value),
    style: S.fieldInput,
    autoFocus: true
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "作物名"), /*#__PURE__*/React.createElement("input", {
    value: p.mf.crop,
    placeholder: "作物名(入力or選択)",
    list: "croplist-edit",
    onChange: e => set("crop", e.target.value),
    style: S.fieldInput
  })), crops.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8
    }
  }, crops.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => set("crop", c),
    style: {
      ...S.cropPickChip,
      ...(p.mf.crop === c ? S.cropPickChipOn : {})
    }
  }, c))), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "面積(a)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    value: p.mf.areaA,
    onChange: e => set("areaA", e.target.value),
    style: S.midInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "地区(任意)"), /*#__PURE__*/React.createElement("input", {
    value: p.mf.area || "",
    placeholder: "例:大津地区",
    list: "arealist-edit",
    onChange: e => set("area", e.target.value),
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("datalist", {
    id: "arealist-edit"
  }, areas.map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }))), areas.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8
    }
  }, areas.map(a => /*#__PURE__*/React.createElement("button", {
    key: a,
    onClick: () => set("area", a),
    style: {
      ...S.cropPickChip,
      ...((p.mf.area || "") === a ? S.cropPickChipOn : {})
    }
  }, a))), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "保存すると、作業タブに入っているこの圃場の名前・面積も同時に更新されます。"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.onCancel,
    style: S.secondaryBtn
  }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
    onClick: p.onSave,
    disabled: !canSave,
    style: {
      ...S.primaryBtn,
      opacity: canSave ? 1 : 0.4
    }
  }, "保存"))));
}

// ═══════════════════ 薬剤タブ ═══════════════════
// ═══════════════════ データベースタブ(圃場・薬剤) ═══════════════════
// ═══════════════════ 圃場マスタ ═══════════════════
// v8.57 でデータベースタブを畳み、ここは地図タブの「📋 一覧」に入った。
// 地図から使うときだけ p.onFocus / p.hidden / p.setHidden が渡り、
// 「📍 地図で見る」と表示ON/OFFのボタンが増える。
// 囲んでいない圃場もここに出す(「位置未登録」の印付き)。
// 地図に出ている分だけを一覧にしていた頃は、位置のない圃場を
// 編集する場所がどこにもなくなる。
function FieldMasterPanel(p) {
  // v8.61 で手入力の登録フォームを外した。登録は地図で囲む1本にする。
  // 手入力だと位置のない圃場が増え、進捗地図にもナビにも使えない。
  // 編集(名前・作物・面積・地区)はこれまでどおり一覧の「編集」からできる。
  const [fq, setFq] = useState("");
  // 圃場編集ポップアップ(編集対象のID。nullなら閉じている)
  const [editId, setEditId] = useState(null);
  const [mf, setMf] = useState({
    name: "",
    crop: "",
    area: "",
    areaA: ""
  });
  const [closed, setClosed] = useState([]); // 閉じている地区名
  // 連番で付け直すときの入力(null なら閉じている)
  const [renumber, setRenumber] = useState(null);
  const hidden = p.hidden || [];
  const hasPoly = f => !!(f.polygon && f.polygon.length) || !!f.center;
  const isHidden = id => hidden.indexOf(id) >= 0;
  const toggleHidden = id => p.setHidden(isHidden(id) ? hidden.filter(x => x !== id) : [...hidden, id]);
  const setZoneVisible = (items, visible) => {
    const ids = items.map(f => f.id);
    p.setHidden(visible ? hidden.filter(id => ids.indexOf(id) < 0) : Array.from(new Set([...hidden, ...ids])));
  };
  // 検索中は畳まない(探しているものが隠れると意味がないため)
  const isOpen = name => !!fq.trim() || closed.indexOf(name) < 0;
  const toggleZone = name => setClosed(closed.indexOf(name) < 0 ? [...closed, name] : closed.filter(x => x !== name));
  const fieldList = fq.trim() ? p.fields.filter(f => f.name.includes(fq.trim()) || (f.crop || "").includes(fq.trim()) || (f.area || "").includes(fq.trim())) : p.fields;
  // 地区ごとにまとめて見出しを付ける。地区なしは末尾の「未分類」へ
  const fieldGroups = React.useMemo(() => {
    const map = new Map();
    fieldList.forEach(f => {
      const key = (f.area || "").trim() || "未分類";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    });
    return Array.from(map.entries()).map(e => ({
      name: e[0],
      items: e[1]
    })).sort((a, b) => a.name === "未分類" ? 1 : b.name === "未分類" ? -1 : a.name.localeCompare(b.name, "ja"));
  }, [fieldList]);
  // 編集対象の圃場(マスタから消えていたらポップアップは閉じた扱いにする)
  const editField = editId != null ? p.fields.find(f => f.id === editId) : null;
  // 編集ポップアップを開く(一覧のその場で開くので、画面上部まで戻る必要がない)
  const startEdit = f => {
    setEditId(f.id);
    setMf({
      name: f.name,
      crop: f.crop || "",
      area: f.area || "",
      areaA: String(f.areaA || "")
    });
  };
  const closeEdit = () => setEditId(null);
  // 地区の中を連番で付け直す。並べ直してから振るので、
  // 丸数字と普通の数字が混ざっていても順番は崩れない。
  const openRenumber = g => setRenumber({
    zone: g.name,
    items: g.items,
    prefix: commonNamePrefix(g.items.map(f => f.name)),
    start: "1",
    byNumber: true
  });
  const renumberList = () => {
    if (!renumber) return [];
    const items = [...renumber.items];
    if (renumber.byNumber) {
      // 数字のない名前は末尾へ回す(並び順を決められないため)。
      // 同じ数字が2件あったときは一覧の順を保つ。
      const idx = new Map(items.map((f, i) => [f.id, i]));
      items.sort((a, b) => {
        const na = nameNumber(a.name),
          nb = nameNumber(b.name);
        if (na === null && nb === null) return idx.get(a.id) - idx.get(b.id);
        if (na === null) return 1;
        if (nb === null) return -1;
        if (na !== nb) return na - nb;
        return idx.get(a.id) - idx.get(b.id);
      });
    }
    const start = parseInt(renumber.start, 10);
    const from = isFinite(start) ? start : 1;
    return items.map((f, i) => ({
      id: f.id,
      before: f.name,
      name: (renumber.prefix || "") + (from + i)
    }));
  };
  const runRenumber = () => {
    const pairs = renumberList();
    if (!pairs.length) return;
    const changed = pairs.filter(x => x.before !== x.name);
    if (changed.length === 0) {
      setRenumber(null);
      return;
    }
    if (!confirm("「" + renumber.zone + "」の" + pairs.length + "圃場の名前を付け直します。\n" + changed.length + "件が変わります(例: " + changed[0].before + " → " + changed[0].name + ")。\nこの操作は戻せません。よろしいですか？")) return;
    p.renameFields(pairs.map(x => ({
      id: x.id,
      name: x.name
    })));
    setRenumber(null);
  };
  // 保存すると圃場マスタが更新され、作業タブに入っている同じ圃場の
  // 名前・面積の表示も同時に切り替わる(resolveWorkがマスタを参照しているため)
  const saveEdit = () => {
    if (!mf.name.trim()) return;
    const cropName = mf.crop.trim();
    if (cropName) p.addCrop(cropName);
    p.upsertField({
      name: mf.name.trim(),
      crop: cropName,
      area: (mf.area || "").trim(),
      areaA: parseFloat(mf.areaA) || ""
    }, editId);
    setEditId(null);
  };
  const preview = renumberList();
  return /*#__PURE__*/React.createElement(React.Fragment, null, renumber && /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    onClick: () => setRenumber(null)
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, "連番で名前を付け直す"), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel,
    className: "num"
  }, "地区「", renumber.zone, "」の ", renumber.items.length, "圃場"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.areaGrid,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "名前の頭"), /*#__PURE__*/React.createElement("input", {
    value: renumber.prefix,
    onChange: e => setRenumber({
      ...renumber,
      prefix: e.target.value
    }),
    placeholder: "例:嘉島",
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "開始番号"), /*#__PURE__*/React.createElement("input", {
    value: renumber.start,
    onChange: e => setRenumber({
      ...renumber,
      start: e.target.value
    }),
    inputMode: "numeric",
    style: S.fieldInput
  }))), /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      fontSize: 14,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: renumber.byNumber,
    onChange: e => setRenumber({
      ...renumber,
      byNumber: e.target.checked
    })
  }), "今の名前に入っている番号の順に並べてから振る"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "丸数字(①)も普通の数字として読みます。番号が入っていない名前は末尾に回ります。付け直すのは名前だけで、囲んだ形・面積・作物・作業の記録はそのままです。"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 4,
      maxHeight: 180,
      overflowY: "auto"
    },
    className: "num"
  }, preview.slice(0, 60).map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    style: {
      fontSize: 13,
      lineHeight: 1.7,
      color: x.before === x.name ? "#8a978e" : "#1C2B21"
    }
  }, x.before, " → ", /*#__PURE__*/React.createElement("strong", null, x.name))), preview.length > 60 && /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "他 ", preview.length - 60, "件")), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setRenumber(null),
    style: S.smallSecondary
  }, "やめる"), /*#__PURE__*/React.createElement("button", {
    onClick: runRenumber,
    style: S.smallPrimary
  }, "この内容で付け直す")))), editField && /*#__PURE__*/React.createElement(FieldEditModal, {
    mf: mf,
    setMf: setMf,
    crops: p.crops,
    areas: p.areas,
    onCancel: closeEdit,
    onSave: saveEdit
  }), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "登録済み圃場(", p.fields.length, "件)"), p.fields.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: fq,
    placeholder: "🔍 圃場名・作物名・地区で検索",
    onChange: e => setFq(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), p.fields.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ圃場が登録されていません。上の「🗺 地図」に切り替えて「✏ 圃場を囲む」から登録してください。"), fieldGroups.map(g => /*#__PURE__*/React.createElement(React.Fragment, {
    key: "zone:" + g.name
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.zoneHead,
      cursor: "pointer"
    },
    onClick: () => toggleZone(g.name)
  }, isOpen(g.name) ? "▾ " : "▸ ", g.name, /*#__PURE__*/React.createElement("span", {
    style: S.zoneCount,
    className: "num"
  }, g.items.length, "圃場"), p.renameFields && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      openRenumber(g);
    },
    style: {
      ...S.smallSecondary,
      marginLeft: "auto",
      padding: "4px 8px"
    },
    title: "この地区の圃場名を連番で付け直す"
  }, "🔢 連番"), p.setHidden && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      setZoneVisible(g.items, g.items.every(f => isHidden(f.id)));
    },
    style: {
      ...S.smallSecondary,
      padding: "4px 8px"
    },
    title: "この地区を地図に出す／隠す"
  }, g.items.every(f => isHidden(f.id)) ? "🙈" : "👁")), isOpen(g.name) && g.items.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    style: S.listItem
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, f.name, f.crop ? "(" + f.crop + ")" : ""), /*#__PURE__*/React.createElement("div", {
    style: S.listSub,
    className: "num"
  }, f.areaA ? dispArea(f.areaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "面積未定", !hasPoly(f) && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#A15E08",
      marginLeft: 6
    },
    title: "地図で囲むと、進捗地図にも出るようになります"
  }, "・位置未登録"))), p.onFocus && hasPoly(f) && /*#__PURE__*/React.createElement("button", {
    onClick: () => p.onFocus(f),
    style: S.smallSecondary,
    title: "地図でこの圃場を見る"
  }, "📍"), p.setHidden && hasPoly(f) && /*#__PURE__*/React.createElement("button", {
    onClick: () => toggleHidden(f.id),
    style: S.smallSecondary,
    title: isHidden(f.id) ? "地図に出す" : "地図から隠す"
  }, isHidden(f.id) ? "🙈" : "👁"), /*#__PURE__*/React.createElement("button", {
    onClick: () => startEdit(f),
    style: S.smallSecondary
  }, "編集"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("圃場「" + f.name + "」を削除しますか？\n(過去の記録は残ります)")) p.deleteField(f.id);
    },
    style: S.smallDanger
  }, "削除")))))));
}

// ═══════════════════ 薬剤マスタ ═══════════════════
// v8.57 で調合タブの「🧪 薬剤」に入った。中身はデータベースタブのときと同じ。
function ChemMasterPanel(p) {
  // 薬剤編集
  const [editChem, setEditChem] = useState(null);
  const [ec, setEc] = useState({
    form: "sc",
    use: "fungicide",
    maxUse: ""
  });
  const [cq, setCq] = useState("");
  // 薬剤の新規登録フォーム
  const [nName, setNName] = useState("");
  const [nUse, setNUse] = useState("fungicide");
  const [nForm, setNForm] = useState("sc");
  const [nMax, setNMax] = useState("");
  const [chemSearchOpen, setChemSearchOpen] = useState(false); // 登録番号検索モーダル
  const submitChem = () => {
    if (!nName.trim()) return;
    const ok = p.addChemMaster({
      name: nName.trim(),
      use: nUse,
      form: nForm,
      maxUse: nMax
    });
    if (ok === false) return;
    setNName("");
    setNMax("");
  };
  const ncq = normalizeChemName(cq);
  const chemList = ncq ? p.chemMaster.filter(c => normalizeChemName(c.name).includes(ncq)) : p.chemMaster;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "薬剤を登録"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setChemSearchOpen(true),
    style: {
      ...S.smallSecondary,
      width: "100%",
      marginBottom: 10
    }
  }, "🔢 登録番号・名称で検索して登録"), chemSearchOpen && /*#__PURE__*/React.createElement(ChemSearchModal, {
    existingNames: p.chemMaster.map(c => c.name),
    onPick: c => p.addChemMaster({
      name: c.name,
      use: c.use,
      form: c.form
    }),
    onCancel: () => setChemSearchOpen(false)
  }), /*#__PURE__*/React.createElement("input", {
    value: nName,
    placeholder: "薬剤名 ※必須(下のボタンで検索登録も可)",
    onChange: e => setNName(e.target.value),
    style: S.fieldInput
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.areaGrid,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "種類"), /*#__PURE__*/React.createElement("select", {
    value: nUse,
    onChange: e => setNUse(e.target.value),
    style: S.formSelect
  }, USES.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.key,
    value: u.key
  }, u.label)))), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "剤型"), /*#__PURE__*/React.createElement("select", {
    value: nForm,
    onChange: e => setNForm(e.target.value),
    style: S.formSelect
  }, FORMS.map(f => /*#__PURE__*/React.createElement("option", {
    key: f.key,
    value: f.key
  }, f.label))))), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "総使用回数の上限(回)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "numeric",
    min: "1",
    placeholder: "未入力なら既定" + CHEM_LIMIT_DEFAULT + "回",
    value: nMax,
    onChange: e => setNMax(e.target.value),
    style: S.midInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: submitChem,
    disabled: !nName.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 12,
      opacity: nName.trim() ? 1 : 0.4
    }
  }, "＋ 薬剤を登録"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "登録した薬剤は、調合タブの「📋 登録薬剤から追加」や各薬剤欄の📋ボタンから、名前・種類・剤型・希釈倍率ごと呼び出せます(呼び出したあと倍率だけ変えることもできます)。同じ名前で登録すると内容が上書きされます。")), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "登録済みの薬剤(", p.chemMaster.length, "件)"), p.chemMaster.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: cq,
    placeholder: "🔍 薬剤名で検索",
    onChange: e => setCq(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), p.chemMaster.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ薬剤が登録されていません。", /*#__PURE__*/React.createElement("br", null), "上のフォームから登録するか、作業タブで薬剤を使うと自動で貯まります。"), chemList.map(c => {
    return /*#__PURE__*/React.createElement("div", {
      key: c.name,
      style: S.listItem
    }, editChem === c.name ? /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.listTitle
    }, c.name), /*#__PURE__*/React.createElement("select", {
      value: ec.use,
      onChange: e => setEc({
        ...ec,
        use: e.target.value
      }),
      style: S.formSelect
    }, USES.map(u => /*#__PURE__*/React.createElement("option", {
      key: u.key,
      value: u.key
    }, u.label))), /*#__PURE__*/React.createElement("select", {
      value: ec.form,
      onChange: e => setEc({
        ...ec,
        form: e.target.value
      }),
      style: S.formSelect
    }, FORMS.map(f => /*#__PURE__*/React.createElement("option", {
      key: f.key,
      value: f.key
    }, f.label))), /*#__PURE__*/React.createElement("input", {
      type: "number",
      inputMode: "numeric",
      min: "1",
      value: ec.maxUse,
      onChange: e => setEc({
        ...ec,
        maxUse: e.target.value
      }),
      style: S.ratioInput,
      className: "num",
      placeholder: "上限回数"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        p.editChemMaster(c.name, {
          form: ec.form,
          use: ec.use,
          maxUse: parseFloat(ec.maxUse) || 0
        });
        setEditChem(null);
      },
      style: S.smallPrimary
    }, "保存")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.listTitle
    }, c.name), /*#__PURE__*/React.createElement("div", {
      style: S.listSub,
      className: "num"
    }, useLabel(c.use), " ／ ", formLabel(c.form), " ／ 使用回数の上限 ", c.maxUse ? c.maxUse + "回" : CHEM_LIMIT_DEFAULT + "回(既定)")), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setEditChem(c.name);
        setEc({
          form: c.form,
          use: c.use || "other",
          maxUse: c.maxUse ? String(c.maxUse) : ""
        });
      },
      style: S.smallSecondary
    }, "編集"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("「" + c.name + "」を削除しますか？")) p.deleteChemMaster(c.name);
      },
      style: S.smallDanger
    }, "削除")));
  })), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "調合プリセット(薬剤の組み合わせ)"), p.presets.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだプリセットがありません。", /*#__PURE__*/React.createElement("br", null), "調合計算の「⭐プリセット保存」で保存できます。"), p.presets.map(pr => /*#__PURE__*/React.createElement("div", {
    key: pr.id,
    style: S.listItem
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, pr.name), /*#__PURE__*/React.createElement("div", {
    style: S.listSub
  }, pr.chems.map(c => (c.name || "(無名)") + " " + c.ratio + "倍").join(" ／ "))), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.loadPreset(pr),
    style: S.smallPrimary
  }, "読込"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("「" + pr.name + "」を削除しますか？")) p.deletePreset(pr.id);
    },
    style: S.smallDanger
  }, "削除")))));
}


// ═══════════════════ 設定タブ ═══════════════════
// ═══════════════════ MAPタブ(圃場を地図で管理) ═══════════════════
// Google Maps JavaScript APIを動的に読み込む(1回だけ)
let __gmapsLoadPromise = null;
function loadGoogleMaps(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve();
  if (__gmapsLoadPromise) return __gmapsLoadPromise;
  __gmapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) + "&libraries=geometry&loading=async";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      __gmapsLoadPromise = null;
      reject(new Error("load failed"));
    };
    document.head.appendChild(script);
  });
  return __gmapsLoadPromise;
}

// ═══════════════════ 地図タブ ルーター(Leaflet/Google切替) ═══════════════════
// 地図に出す圃場の色。今は「登録済みかどうか」だけが分かればよいので1色。
// 衛星写真は緑・茶が大半なので、補色側の赤が最も輪郭を追いやすい
// (以前は蛍光イエローだったが、枯れた圃場や土の色と近く見分けにくかった)。
// 輪郭は濃く、塗りは薄く。中の作物の生育状況が透けて見える濃さにしてある。
const FIELD_COLOR = {
  stroke: "#D81111",
  fill: "#FF4D4D",
  opacity: 0.12
};

// 地図を画面の残り全部に広げる。上に何が積まれているか(見出し・ボタン列・
// 切替タブ)は状態で変わるので、固定値ではなく実際の位置から測って決める。
// これをやらないと画面をスクロールしないと地図の下半分が見えない。
// Google版・Leaflet版で手順が同じなので共通化してある。違うのは
// 「大きさが変わった」と地図に伝える呼び出しだけなので resize で受け取る。
function useMapHeightFit(mapWrapRef, hidden, drawing, ready, fullMap, resize) {
  // resize は描画のたびに作り直される関数なので、依存配列には入れずrefで最新を見る
  const resizeRef = React.useRef(resize);
  resizeRef.current = resize;
  React.useLayoutEffect(() => {
    const fit = () => {
      const el = mapWrapRef.current;
      // 隠れている間(一覧表示中・他のタブを見ている間)は大きさを測れない。
      // 測ると0になって高さが潰れるので、表示に戻るまで何もしない。
      if (!el || hidden) return;
      const nav = document.querySelector("nav");
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      if (fullMap) {
        // position:fixed で画面全体を覆っているので高さは指定しない
        el.style.height = "";
        resizeRef.current();
        return;
      }
      let h = window.innerHeight - el.getBoundingClientRect().top - navH - 14;
      // 画面がスクロールされていると上端が負になりうるので上限で抑える
      h = Math.min(h, window.innerHeight - navH - 60);
      // 作図中は下の操作パネルに手が届くよう、画面の半分ほどに抑える
      if (drawing) h = Math.min(h, Math.round(window.innerHeight * 0.5));
      el.style.height = Math.max(240, h) + "px";
      // カードの下余白などで1画面に収まらないぶんを実測して詰める。
      // ここまでやらないと数十pxだけ縦スクロールが残る
      if (!drawing) {
        const over = document.documentElement.scrollHeight - window.innerHeight;
        if (over > 0) el.style.height = Math.max(240, h - over) + "px";
      }
      resizeRef.current();
    };
    fit();
    // 端末の回転・ブラウザのアドレスバーの出入りでも測り直す
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [hidden, drawing, ready, fullMap]);
}

// 頂点をドラッグしている最中の「面積 X a」を、指を離す前から追従させる。
// ドラッグ中に setDrawPts を呼ぶと再描画effectが走って掴んでいるマーカーごと
// 作り直されてしまう(だから既存コードは draggingRef で再描画を抑えている)。
// そこで線・面と同じやり方で、Reactの状態は触らずDOMを直接書き換える。
// 指を離すと dragend → setDrawPts → 再描画 で React が同じ値を書き直すので、
// ここで書いた文字列と最終的な表示は一致する(fmt の呼び方を揃えてあるため)。
// Google版・Leaflet版で手順がまったく同じなので共通化してある。
function useLiveAreaReadout(drawPtsRef) {
  const areaRef = React.useRef(null); // 「面積 ○ a」の数字を出している <strong>
  const warnRef = React.useRef(null); // 「⚠ 線が交差しています」の行
  const rafRef = React.useRef(0); // 予約済みの requestAnimationFrame のID(0=なし)
  // drag はマウス/指の移動のたびに飛んでくるので、そのつど面積と交差判定を
  // 計算するとカクつく。1フレーム1回に間引き、多重予約はIDの有無で弾く。
  const refreshAreaReadout = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pts = drawPtsRef.current;
      const crossed = polygonSelfIntersects(pts);
      // 交差しているときに 0 を出すのは React 側の描画と同じ規則。
      // ここだけ実面積を出すと、指を離した瞬間に 0 へ飛んで見える。
      if (areaRef.current) areaRef.current.textContent = fmt(crossed ? 0 : polygonAreaA(pts), 2);
      // 警告行は常に描画しておき、表示/非表示だけを切り替える。
      // ドラッグ中に React に生成させることはできないため。
      if (warnRef.current) warnRef.current.style.display = crossed ? "" : "none";
    });
  };
  // 作図をやめた・タブを離れたときに予約が残ると、消えたDOMを触りにいく
  React.useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);
  return {
    areaRef,
    warnRef,
    refreshAreaReadout
  };
}

// 住所・地名を入力すると国土地理院の住所検索API(APIキー不要・全国対応)で座標を調べ、
// 地図をその場所へ移動する。Google版・無料地図版のどちらでも同じ結果になるよう、
// 検索処理そのものは共通化し、地図を動かす部分だけを onFound で受け取る。
function AddressSearchBox(p) {
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const search = async () => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    try {
      const res = await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(query));
      if (!res.ok) throw new Error("http " + res.status);
      const list = await res.json();
      if (!Array.isArray(list) || list.length === 0) {
        p.flash && p.flash("「" + query + "」が見つかりませんでした");
        return;
      }
      // 住所検索はあいまい一致なので、打った文字と違う場所に飛ぶことがある。
      // どこに移動したのかを必ず知らせないと、利用者は地図の見た目だけでは
      // 目的地に来たのか判断できず、そのまま別の場所で圃場を囲んでしまう。
      const hit = list[0];
      const coords = hit && hit.geometry && hit.geometry.coordinates;
      if (!Array.isArray(coords) || !isFinite(coords[0]) || !isFinite(coords[1])) {
        p.flash && p.flash("「" + query + "」の位置を取得できませんでした");
        return;
      }
      const title = hit.properties && hit.properties.title;
      p.onFound(coords[1], coords[0]);
      p.flash && p.flash("📍 " + (title || query) + " へ移動しました" + (list.length > 1 ? "(候補 " + list.length + "件の先頭)" : ""));
    } catch (e) {
      p.flash && p.flash("住所検索に失敗しました(オンライン環境で試してください)");
    } finally {
      setBusy(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: q,
    placeholder: "🔍 住所・地名を入力して地図を移動",
    onChange: e => setQ(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") search();
    },
    style: {
      ...S.fieldInput,
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: search,
    disabled: busy || !q.trim(),
    style: {
      ...S.smallSecondary,
      opacity: busy || !q.trim() ? 0.5 : 1,
      flexShrink: 0
    }
  }, busy ? "検索中…" : "🔍 移動"));
}

// 地図タブの圃場一覧。Google版・Leaflet版で中身が同じなので共通化してある。
// 地区で折りたたみ、検索で絞り込み、チェックで地図の表示/非表示を切り替える。
// 圃場が数百件になっても、開いている地区のぶんしか縦に伸びない。
function MapTabRouter(p) {
  if (p.mapEngine === "google") {
    if (!p.gmapKey) {
      return /*#__PURE__*/React.createElement("section", {
        style: S.card,
        className: "no-print"
      }, /*#__PURE__*/React.createElement("div", {
        style: S.cardLabel
      }, "圃場マップ"), /*#__PURE__*/React.createElement("p", {
        style: S.empty
      }, "Google マップを使うにはAPIキーの設定が必要です。", /*#__PURE__*/React.createElement("br", null), "設定タブで「Google Maps APIキー」を入力してください。"), /*#__PURE__*/React.createElement("button", {
        onClick: () => p.setTab("settings"),
        style: {
          ...S.primaryBtn,
          width: "100%",
          marginTop: 10
        }
      }, "⚙ 設定タブへ"));
    }
    return /*#__PURE__*/React.createElement(GoogleMapTab, p);
  }
  return /*#__PURE__*/React.createElement(LeafletMapTab, p);
}

// ═══════════════════ Googleマップ版 圃場マップタブ ═══════════════════
function GoogleMapTab(p) {
  const mapRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const fieldOverlaysRef = React.useRef([]); // 登録済み圃場のPolygon+Label
  const drawOverlaysRef = React.useRef([]); // 作図中の頂点マーカー・線
  const gpsMarkerRef = React.useRef(null);
  const [status, setStatus] = React.useState("loading"); // loading | ready | error
  // Googleマップの読み込みをやり直した回数。Googleの地図は毎回ネットから
  // 取り直す必要があり(オフラインでは動かない)、電波の弱い圃場では起動時の
  // 1回目が失敗しやすい。失敗したまま固定されないよう、やり直せるようにする。
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const retryLoad = () => {
    setStatus("loading");
    setLoadAttempt(n => n + 1);
  };
  const [ready, setReady] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [drawPts, setDrawPts] = React.useState([]);
  const [newName, setNewName] = React.useState("");
  const [newCrop, setNewCrop] = React.useState("");
  const [newZone, setNewZone] = React.useState(""); // 作図した圃場の地区
  const [editingFieldId, setEditingFieldId] = React.useState(null); // 既存圃場を編集中ならそのID。nullなら新規作図
  // 地図タップで頂点を足すかどうか。切れるようにしてあるのは、形を整えている最中に
  // 地図を触ってしまい、離れた場所に頂点ができて消す作業が発生していたため。
  // 地図のclickリスナーは初期化時に1回だけ張るので、値はrefでも持って参照する。
  const [addMode, setAddMode] = React.useState(true);
  const addModeRef = React.useRef(true);
  const changeAddMode = v => {
    addModeRef.current = v;
    setAddMode(v);
  };
  const [hidden, setHidden] = React.useState([]); // 地図に出さない圃場ID(この画面を開いている間だけ)
  const [listOnly, setListOnly] = React.useState(false); // 一覧だけを全画面で見るモード
  const [fullMap, setFullMap] = React.useState(false); // 地図だけを画面いっぱいに出す
  const mapWrapRef = React.useRef(null); // 地図+凡例の枠。高さを実測して決める
  // 全画面のまま作図できる。作図パネルは全画面のとき、地図の上に
  // 下からのシートとして重なる(S.drawPanelFull)。
  const [gpsOn, setGpsOn] = React.useState(false);
  const [mapType, setMapType] = React.useState("hybrid"); // hybrid=衛星+地名, roadmap=地図のみ
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const LABEL_MIN_ZOOM = 16; // これ以上に拡大すると圃場名・作物・面積の札を出す
  const [zoom, setZoom] = React.useState(15);
  const drawArea = polygonAreaA(drawPts);
  const drawCrossed = polygonSelfIntersects(drawPts);
  // 頂点をタップしたら消すモード。既定はOFF。
  // v8.58までは1回目のタップで✕に変わり、2回目で削除していた。
  // 形を直しているだけでも✕になるので、作業中に邪魔になる。
  const [delMode, setDelMode] = React.useState(false);
  const delModeRef = React.useRef(false);
  const [histLen, setHistLen] = React.useState(0); // 「1つ戻す」の有効判定に使う

  const histRef = React.useRef([]); // 作図中だけ持つ操作履歴(変更前のdrawPtsを積む)
  const draggingRef = React.useRef(false); // ドラッグ中は再描画しない(掴んだマーカーが消えるため)
  const lastEditAtRef = React.useRef(0); // 直前の頂点操作の時刻。地図のclickに化けた分を弾く
  const dragBeforeRef = React.useRef(null); // ドラッグ開始時の頂点配列(履歴に積む「変更前」)
  const drawLineRef = React.useRef(null); // 作図中の線。ドラッグ中に直接書き換える
  const drawFillRef = React.useRef(null); // 作図中の面。同上
  // 面積表示もドラッグ中はDOMを直接書き換えて追従させる(線・面と同じ理由)
  const {
    areaRef,
    warnRef,
    refreshAreaReadout
  } = useLiveAreaReadout(drawPtsRef);
  // 頂点編集を1手として確定する。履歴には「変更前」を積む
  const commitPts = (next, opt) => {
    const o = opt || {};
    const prev = o.prev || drawPtsRef.current;
    histRef.current = pushDrawHistory(histRef.current, prev);
    setHistLen(histRef.current.length);
    drawPtsRef.current = next;
    setDrawPts(next);
  };
  // ねじれを、頂点の並べ替えだけで直す。座標は1つも動かさない。
  // 自動では走らせない。凹んだ圃場では意図した形と変わりうるので、
  // 押した本人が結果を見て「↩ 1つ戻す」で戻せる形にしている。
  const fixTwist = () => {
    const cur = drawPtsRef.current;
    const next = untwistPts(cur);
    if (polygonSelfIntersects(next)) {
      // 並べ替えでは解けない形(頂点が重なっている等)。できなかったと伝えて、
      // 黙って何もしないことはしない
      p.flash && p.flash("並び順では直せませんでした。頂点をドラッグして直してください");
      return;
    }
    commitPts(next);
    p.flash && p.flash("頂点の並び順を直しました(戻すには「↩ 1つ戻す」)");
  };
  const removePt = i => {
    if (i < 0 || i >= drawPtsRef.current.length) return;
    commitPts(ptsRemove(drawPtsRef.current, i));
  };
  // 頂点を消すモードの切替。足すモードと同時にはONにしない。
  // 両方ONだと、消すつもりで地図を触ったときに頂点が増える。
  // 消すモードをやめたら、入る前の「頂点を追加」の状態に戻す。
  // 戻さないと、消し終わったあと地図をタップしても何も起きず、
  // なぜ増えないのか分からない。編集中はOFFで始まるので、
  // 一律にONに戻すのではなく覚えておいた値を使う。
  const addBeforeDelRef = React.useRef(true);
  const changeDelMode = v => {
    delModeRef.current = v;
    setDelMode(v);
    if (v) {
      addBeforeDelRef.current = addModeRef.current;
      changeAddMode(false);
    } else {
      changeAddMode(addBeforeDelRef.current);
    }
  };
  // 全消し・作図開始・やめる で使う。履歴もモードも落とす
  const resetDrawState = () => {
    histRef.current = [];
    setHistLen(0);
    drawPtsRef.current = [];
    setDrawPts([]);
    delModeRef.current = false;
    setDelMode(false);
    draggingRef.current = false;
    dragBeforeRef.current = null;
  };
  // ドラッグの終了処理。dragend からも保険のリスナーからも呼ばれるが、
  // draggingRef で入口を塞いでいるので二重に走っても履歴は1手しか積まれない
  const endDragCommit = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastEditAtRef.current = Date.now();
    const prev = dragBeforeRef.current;
    dragBeforeRef.current = null;
    const next = drawPtsRef.current;
    if (prev && prev !== next) {
      commitPts(next, {
        prev
      });
    } else {
      // 実際には動いていない。履歴を汚さず、マーカーの位置だけ描き直す
      const same = next.slice();
      drawPtsRef.current = same;
      setDrawPts(same);
    }
  };
  // ドラッグ中に線・面・面積表示を追従させる(マーカーは作り直さない)
  const refreshDrawShapes = () => {
    const pts = drawPtsRef.current;
    const toLL = a => ({
      lat: a[0],
      lng: a[1]
    });
    if (drawLineRef.current) drawLineRef.current.setPath((pts.length >= 3 ? [...pts, pts[0]] : pts).map(toLL));
    if (drawFillRef.current) drawFillRef.current.setPaths(pts.map(toLL));
    // 頂点・中点ハンドルの drag は全部ここを通るので、面積表示の追従もここで済ませる
    refreshAreaReadout();
  };
  // dragend を取りこぼしてもドラッグ状態が残らないようにする保険。
  // スマホではブラウザがスクロールを引き取って pointercancel で終わることがあり、
  // その場合 dragend は来ない。フラグが立ちっぱなしになると再描画effectが
  // 冒頭で抜け続け、地図が二度と更新されなくなるため必ず拾う。
  // document ではなく window に張るのは、地図ライブラリが document で受ける
  // ドラッグ終了処理(=正規の dragend)を先に走らせてから保険を効かせるため。
  React.useEffect(() => {
    if (!drawing) return;
    const onEnd = () => endDragCommit();
    const types = ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"];
    types.forEach(t => window.addEventListener(t, onEnd));
    return () => {
      types.forEach(t => window.removeEventListener(t, onEnd));
    };
  }, [drawing]);

  // Google Maps APIを読み込んで地図を初期化。
  // loadAttempt が増えると読み込みからやり直す(mapRef があれば作り直さない)
  React.useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(p.gmapKey).then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const g = window.google.maps;
      let center = {
        lat: 35.0,
        lng: 137.0
      };
      let z = 5;
      const withPoly = p.fields.filter(f => f.center);
      if (withPoly.length > 0) {
        center = {
          lat: withPoly[0].center[0],
          lng: withPoly[0].center[1]
        };
        z = 17;
      }
      const map = new g.Map(containerRef.current, {
        center,
        zoom: z,
        mapTypeId: "hybrid",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        // 既定だとスマホで指 1 本で動かそうとしたときに
        // 「地図を移動させるには指 2 本で操作します」と出て地図が動かない。
        // このアプリは地図が主役で、背後のページをスクロールさせたい場面がないので、
        // 1 本指でそのまま動かせる greedy にする。
        gestureHandling: "greedy",
        maxZoom: 21
      });
      mapRef.current = map;
      map.addListener("click", e => {
        if (!drawingRef.current || draggingRef.current) return;
        if (!addModeRef.current) return; // 「頂点を追加」がOFFのときは地図を触っても増やさない
        // マーカー操作の直後に地図のclickが続くと点が増えてしまうので短時間だけ弾く
        if (Date.now() - lastEditAtRef.current < 400) return;
        commitPts([...drawPtsRef.current, [e.latLng.lat(), e.latLng.lng()]]);
      });
      map.addListener("zoom_changed", () => setZoom(map.getZoom()));
      setZoom(map.getZoom());
      setStatus("ready");
      setReady(true);
    }).catch(() => {
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // 失敗したあとの自動やり直し。圃場に着いて電波が入ったとき、地図タブに
  // 戻ってきたときに、利用者が何もしなくても復帰できるようにする。
  React.useEffect(() => {
    if (status !== "error") return;
    if (p.active !== false) retryLoad();
  }, [p.active]);
  React.useEffect(() => {
    if (status !== "error") return;
    const onOnline = () => retryLoad();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [status]);

  // 地図タイプ切替
  React.useEffect(() => {
    if (mapRef.current) mapRef.current.setMapTypeId(mapType);
  }, [mapType]);

  // 登録済み圃場ポリゴンを再描画
  React.useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = window.google.maps;
    fieldOverlaysRef.current.forEach(o => {
      o.setMap && o.setMap(null);
    });
    fieldOverlaysRef.current = [];
    const showLabel = zoom >= LABEL_MIN_ZOOM;
    p.fields.forEach(f => {
      if (!f.polygon || f.polygon.length < 3) return;
      if (hidden.indexOf(f.id) >= 0) return;
      const st = FIELD_COLOR;
      const path = f.polygon.map(pt => ({
        lat: pt[0],
        lng: pt[1]
      }));
      const poly = new g.Polygon({
        paths: path,
        strokeColor: st.stroke,
        strokeWeight: 3,
        fillColor: st.fill,
        fillOpacity: st.opacity,
        map: mapRef.current,
        clickable: true
      });
      poly.addListener("click", () => {
        startEditPoly(f);
      });
      fieldOverlaysRef.current.push(poly);
      if (showLabel) {
        const c = f.center || polygonCenter(f.polygon);
        const label = new g.Marker({
          position: {
            lat: c[0],
            lng: c[1]
          },
          map: mapRef.current,
          icon: {
            path: 0,
            scale: 0
          },
          // 透明アイコン(ラベルだけ表示)
          label: {
            text: f.name + (f.crop ? " / " + f.crop : ""),
            color: "#fff",
            fontSize: "12px",
            fontWeight: "700",
            className: "gm-field-label"
          }
        });
        fieldOverlaysRef.current.push(label);
        // 面積は別の札にして名前の下へ。Googleの札はHTMLを入れられず、
        // 改行も効かないので、CSS(gm-field-area)で下へずらして二行に見せる。
        const areaLabel = new g.Marker({
          position: {
            lat: c[0],
            lng: c[1]
          },
          map: mapRef.current,
          icon: {
            path: 0,
            scale: 0
          },
          label: {
            text: fieldAreaText(f, p.areaUnitKey),
            color: "#BFE3CD",
            fontSize: "11px",
            fontWeight: "600",
            className: "gm-field-area"
          }
        });
        fieldOverlaysRef.current.push(areaLabel);
      }
    });
  }, [ready, p.fields, zoom, hidden, p.areaUnitKey]); // 単位を変えたら札も描き直す

  // 作図中の頂点・線を再描画
  React.useEffect(() => {
    if (!ready || !mapRef.current) return;
    // ドラッグ中に作り直すと掴んでいるマーカーごと消えて動かせなくなる
    if (draggingRef.current) return;
    const g = window.google.maps;
    drawOverlaysRef.current.forEach(o => {
      o.setMap && o.setMap(null);
    });
    drawOverlaysRef.current = [];
    drawLineRef.current = null;
    drawFillRef.current = null;
    if (drawPts.length > 0) {
      // 頂点(ドラッグで移動。削除モードのときだけタップで消える)
      drawPts.forEach((pt, i) => {
        const sel = delMode;
        const marker = new g.Marker({
          position: {
            lat: pt[0],
            lng: pt[1]
          },
          map: mapRef.current,
          draggable: true,
          zIndex: 1000,
          label: {
            text: sel ? "✕" : String(i + 1),
            color: "#fff",
            fontWeight: "800",
            fontSize: sel ? "11px" : "9px"
          },
          icon: {
            path: g.SymbolPath.CIRCLE,
            // Leaflet版の .vtx(16px)と見た目を揃える。scaleは半径なので8。
            // 大きいと隣の頂点と重なって細かい調整ができない
            scale: 8,
            fillColor: sel ? "#8a2f1c" : "#C74E36",
            fillOpacity: 1,
            strokeColor: sel ? "#FFD9CF" : "#fff",
            strokeWeight: 1.5
          }
        });
        let moved = false; // 動かしたときは選択・削除に化けさせない
        let before = drawPtsRef.current;
        marker.addListener("dragstart", () => {
          moved = true;
          draggingRef.current = true;
          before = drawPtsRef.current;
          dragBeforeRef.current = before;
        });
        marker.addListener("drag", () => {
          // ドラッグ中に作り直すと掴んでいるマーカーごと消えるので、
          // ref と線・面だけを直接更新し setDrawPts は dragend で1回だけ呼ぶ
          const ll = marker.getPosition();
          drawPtsRef.current = ptsMove(drawPtsRef.current, i, ll.lat(), ll.lng());
          refreshDrawShapes();
        });
        marker.addListener("dragend", () => {
          if (!draggingRef.current) return; // 保険のリスナーが先に確定済み
          const ll = marker.getPosition();
          drawPtsRef.current = ptsMove(before, i, ll.lat(), ll.lng());
          endDragCommit();
        });
        marker.addListener("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
          if (delModeRef.current) removePt(i);
        });
        drawOverlaysRef.current.push(marker);
      });
      // 辺の中点ハンドル(頂点より小さく薄い。ドラッグしたときだけ頂点を挿入)
      drawMidpoints(drawPts).forEach(mp => {
        const handle = new g.Marker({
          position: {
            lat: mp.lat,
            lng: mp.lng
          },
          map: mapRef.current,
          draggable: true,
          zIndex: 500,
          icon: {
            path: g.SymbolPath.CIRCLE,
            // Leaflet版の .vtx-mid(9px)と揃える
            scale: 4.5,
            fillColor: "#C74E36",
            fillOpacity: 0.45,
            strokeColor: "#fff",
            strokeWeight: 1.5,
            strokeOpacity: 0.85
          }
        });
        let moved = false;
        let before = drawPtsRef.current;
        handle.addListener("dragstart", () => {
          moved = true;
          draggingRef.current = true;
          before = drawPtsRef.current;
          dragBeforeRef.current = before;
          // 掴んだ瞬間に挿入しておくと、そのまま新しい頂点として引っ張れる
          drawPtsRef.current = ptsInsert(before, mp.edge, mp.lat, mp.lng);
        });
        handle.addListener("drag", () => {
          const ll = handle.getPosition();
          drawPtsRef.current = ptsMove(drawPtsRef.current, mp.edge + 1, ll.lat(), ll.lng());
          refreshDrawShapes();
        });
        handle.addListener("dragend", () => {
          if (!draggingRef.current) return; // 保険のリスナーが先に確定済み
          const ll = handle.getPosition();
          drawPtsRef.current = ptsInsert(before, mp.edge, ll.lat(), ll.lng());
          endDragCommit();
        });
        // 中点ハンドルは「ドラッグしたときだけ」頂点を足す(理由はLeaflet版と同じ)。
        // clickを拾わないと地図のclickになって別の場所に頂点が増えるので、
        // 受けるだけ受けて何もしない。
        handle.addListener("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
        });
        drawOverlaysRef.current.push(handle);
      });
      if (drawPts.length >= 2) {
        const path = drawPts.map(pt => ({
          lat: pt[0],
          lng: pt[1]
        }));
        if (drawPts.length >= 3) path.push({
          lat: drawPts[0][0],
          lng: drawPts[0][1]
        });
        const line = new g.Polyline({
          path,
          strokeColor: "#C74E36",
          strokeWeight: 2,
          strokeOpacity: 0.9,
          map: mapRef.current,
          icons: [{
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              scale: 3
            },
            offset: "0",
            repeat: "10px"
          }]
        });
        drawLineRef.current = line;
        drawOverlaysRef.current.push(line);
      }
      if (drawPts.length >= 3) {
        const fillPath = drawPts.map(pt => ({
          lat: pt[0],
          lng: pt[1]
        }));
        const fillPoly = new g.Polygon({
          paths: fillPath,
          strokeOpacity: 0,
          fillColor: "#C74E36",
          fillOpacity: 0.15,
          map: mapRef.current,
          clickable: false
        });
        drawFillRef.current = fillPoly;
        drawOverlaysRef.current.push(fillPoly);
      }
    }
  }, [ready, drawPts, delMode]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    // 新規はまず点を打つところから始まるのでONで開く
    changeAddMode(true);
    resetDrawState();
  };
  // 既存の圃場ポリゴンをタップしたときの編集開始。頂点・圃場名などを
  // 作図パネルへ読み込み、地図上では二重表示にならないよう元のポリゴンを隠す
  const startEditPoly = f => {
    if (drawingRef.current) return; // 作図中に他の圃場へ乗り換えさせない
    setDrawing(true);
    drawingRef.current = true;
    // 圃場ポリゴンのclickは地図のclickにも伝播する。何もしないと、選択に使った
    // 同じタップが「作図中の地図タップ」として処理され、5点目の頂点が紛れ込む
    lastEditAtRef.current = Date.now();
    // 既存の圃場は「形を整えに来た」場面なので、追加はOFFで開く。
    // ONのままだと地図に触れるたびに離れた場所へ頂点ができ、消す作業が発生する
    changeAddMode(false);
    resetDrawState();
    const pts = (f.polygon || []).map(pt => [pt[0], pt[1]]);
    drawPtsRef.current = pts;
    setDrawPts(pts);
    setNewName(f.name || "");
    setNewCrop(f.crop || "");
    setNewZone(f.area || "");
    setEditingFieldId(f.id);
    setHidden(h => h.indexOf(f.id) >= 0 ? h : [...h, f.id]);
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    resetDrawState();
    setNewName("");
    setNewCrop("");
    setNewZone("");
    if (editingFieldId != null) setHidden(h => h.filter(id => id !== editingFieldId));
    setEditingFieldId(null);
    changeAddMode(true); // 次に「✏ 圃場を囲む」で始めるときのために戻しておく
  };
  // 追加・移動・削除・挿入をまとめて1手ずつ戻す
  const undoPt = () => {
    if (histRef.current.length === 0) return;
    const prev = histRef.current[histRef.current.length - 1];
    histRef.current = histRef.current.slice(0, -1);
    setHistLen(histRef.current.length);
    drawPtsRef.current = prev;
    setDrawPts(prev);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    // ねじれたまま登録すると面積が実際より小さく出るので、ここで止める
    if (polygonSelfIntersects(drawPts)) {
      p.flash && p.flash("線が交差しています。頂点を動かしてねじれを直してください");
      return;
    }
    // 座標は保存時に丸める。倍精度のまま貯めると、あとからチーム共有が
    // セル上限に当たって保存できなくなる(roundPts のコメント参照)。
    //
    // ただし面積は「丸める前の座標」から出す。丸めた座標から計算し直すと、
    // 作図中にパネルで見えていた面積と、保存された面積がわずかにずれる。
    // 面積は散布量やアグリノート転記に流れるので、画面で確認した値が
    // そのまま残るようにする。
    const pts = roundPts(drawPts);
    const center = roundPts([polygonCenter(drawPts)])[0];
    let areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    // 形をまったく動かさずに保存したときは、登録されている面積をそのまま残す。
    // 計算し直すと、データベースで手入力した面積(登記簿の値など)が
    // 囲んだ形から出した値で黙って上書きされてしまう。
    const editTarget = editingFieldId != null ? p.fields.find(x => x.id === editingFieldId) : null;
    if (editTarget && JSON.stringify(editTarget.polygon) === JSON.stringify(pts) && parseFloat(editTarget.areaA) > 0) {
      areaA = editTarget.areaA;
    }
    const data = {
      name: newName.trim(),
      crop: newCrop.trim(),
      area: newZone.trim(),
      areaA,
      polygon: pts,
      center
    };
    if (editingFieldId != null) {
      p.upsertField(data, editingFieldId);
    } else {
      p.addFieldWithPolygon(data);
    }
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    // 全画面で新しい圃場を囲んだときは、そのまま次の圃場を囲める状態に戻す。
    // 全画面を抜けずに何枚も続けて登録する使い方(現地で一気に囲む)を想定している。
    // 既存の圃場を編集していたときは続けない(編集は1枚ずつ終わる作業のため)。
    const drawAgain = editingFieldId == null && fullMap;
    cancelDraw();
    // ここで flash は出さない。登録できたことは addFieldWithPolygon 側が
    // 面積つきで知らせており(「登録しました(◯◯a)」)、上書きすると
    // その面積の確認が消える。続けて囲めることは、1行バーが「0点」で
    // 残っていることで分かる
    if (drawAgain) startDraw();
  };
  // 一覧表示中と、他のタブを見ている間はどちらも display:none で隠れている
  const mapHidden = listOnly || p.active === false;
  useMapHeightFit(mapWrapRef, mapHidden, drawing, ready, fullMap, () => {
    if (mapRef.current && window.google) window.google.maps.event.trigger(mapRef.current, "resize");
  });
  // display:none の間はサイズを取れないので、地図に戻したら測り直させる
  React.useEffect(() => {
    if (mapHidden || !mapRef.current || !window.google) return;
    const t = setTimeout(() => {
      if (mapRef.current) window.google.maps.event.trigger(mapRef.current, "resize");
    }, 60);
    return () => clearTimeout(t);
  }, [mapHidden]);
  const toggleGps = () => {
    if (!mapRef.current || !window.google) return;
    if (gpsOn) {
      if (gpsMarkerRef.current) gpsMarkerRef.current.setMap(null);
      setGpsOn(false);
      return;
    }
    if (!navigator.geolocation) {
      p.flash && p.flash("この端末は位置情報に対応していません");
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
      const g = window.google.maps;
      const ll = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      if (gpsMarkerRef.current) gpsMarkerRef.current.setMap(null);
      gpsMarkerRef.current = new g.Marker({
        position: ll,
        map: mapRef.current,
        label: {
          text: "現在地",
          color: "#fff",
          fontWeight: "700"
        },
        icon: {
          path: g.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#3B7EA1",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 3
        }
      });
      mapRef.current.setCenter(ll);
      mapRef.current.setZoom(16);
      setGpsOn(true);
    }, () => {
      p.flash && p.flash("位置情報を取得できませんでした(権限を確認してください)");
    }, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: {
      ...S.card,
      padding: "10px 10px 12px"
    },
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.mapSegWrap
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setListOnly(false),
    style: {
      ...S.mapSeg,
      ...(listOnly ? {} : S.segOn)
    }
  }, "🗺 地図"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setListOnly(true),
    style: {
      ...S.mapSeg,
      ...(listOnly ? S.segOn : {})
    }
  }, "📋 圃場一覧")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, !listOnly && /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(true),
    style: S.smallSecondary,
    title: "地図を全画面で見る"
  }, "⛶"), /*#__PURE__*/React.createElement("button", {
    onClick: toggleGps,
    style: {
      ...S.smallSecondary,
      ...(gpsOn ? {
        background: "#EAF3FA",
        borderColor: "#3B7EA1",
        color: "#2b5a7a"
      } : {})
    }
  }, "📍 現在地"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMapType(mapType === "hybrid" ? "roadmap" : "hybrid"),
    style: {
      ...S.smallSecondary,
      ...(mapType === "roadmap" ? {
        background: "#FBF7EC",
        borderColor: "#E4D6AC",
        color: "#8a621f"
      } : {})
    }
  }, mapType === "hybrid" ? "🗺 地図表示" : "📷 衛星写真"), !drawing ? /*#__PURE__*/React.createElement("button", {
    onClick: startDraw,
    style: S.smallPrimary
  }, "✏ 圃場を囲む") : /*#__PURE__*/React.createElement("button", {
    onClick: cancelDraw,
    style: S.smallDanger
  }, "やめる"))), !listOnly && /*#__PURE__*/React.createElement(AddressSearchBox, {
    flash: p.flash,
    onFound: (lat, lng) => {
      if (!mapRef.current || !window.google) return;
      mapRef.current.setCenter({
        lat,
        lng
      });
      mapRef.current.setZoom(17);
    }
  }), status === "loading" && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "Google マップを読み込んでいます…"), status === "error" && /*#__PURE__*/React.createElement("div", {
    style: S.settingsBox
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.empty,
      marginBottom: 10
    }
  }, "Google マップを読み込めませんでした。", /*#__PURE__*/React.createElement("br", null), "Google の地図は開くたびに通信が必要で、電波の弱い場所では失敗します。電波のある場所で「再読み込み」を押すか、電波がないところでは無料地図をご利用ください。"), /*#__PURE__*/React.createElement("div", {
    style: S.btnRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: retryLoad,
    style: S.smallPrimary
  }, "🔄 再読み込み"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setTab("settings"),
    style: S.smallSecondary
  }, "⚙ 設定タブへ"))), /*#__PURE__*/React.createElement("div", {
    ref: mapWrapRef,
    style: listOnly ? {
      ...S.mapWrap,
      display: "none"
    } : fullMap ? S.mapWrapFull : S.mapWrap
  }, /*#__PURE__*/React.createElement("div", {
    ref: containerRef,
    style: fullMap ? {
      ...S.mapBox,
      borderRadius: 0,
      border: "none"
    } : S.mapBox,
    "data-map-box": ""
  }), fullMap && drawing && /*#__PURE__*/React.createElement("button", {
    // 作図中は下の帯を作図パネルが使うので、抜けるボタンは右上に出す。
    // 作図していないときは下の帯(S.fullBar)にまとめてある。
    onClick: () => setFullMap(false),
    style: S.mapFullExit
  }, "✕ 全画面をやめる")), fullMap && !drawing && /*#__PURE__*/React.createElement("div", {
    style: S.fullBar,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", {
    style: S.fullBarHint
  }, "圃場をタップすると形を直せます"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(false),
    style: S.drawBarBtn
  }, "✕ 全画面"), /*#__PURE__*/React.createElement("button", {
    onClick: startDraw,
    style: S.fullBarPrimary
  }, "✏ 圃場を囲む")), drawing && fullMap && /*#__PURE__*/React.createElement(DrawBarFull, {
    drawPts,
    drawArea,
    drawCrossed,
    addMode,
    changeAddMode,
    delMode,
    changeDelMode,
    areaRef,
    warnRef,
    undoPt,
    histLen,
    resetDrawState,
    fixTwist,
    onCancel: cancelDraw,
    editing: editingFieldId != null,
    newName,
    setNewName,
    newCrop,
    setNewCrop,
    newZone,
    setNewZone,
    saveDraw,
    crops: p.crops,
    areas: p.areas
  }), drawing && !fullMap && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, editingFieldId != null && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      color: "#C74E36",
      fontWeight: "700",
      marginBottom: 4
    }
  }, "✎「", newName || "この圃場", "」を編集中(「この圃場を保存」を押すまでは元の圃場データは変わりません。「やめる」で編集を取り消せます)"), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, addMode ? "地図をタップして圃場の角を順に打ちます(3点以上)。" : "いまは地図をタップしても頂点は増えません。足したいときは下の「頂点を追加」をONにしてください。", "頂点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "。消すときは", /*#__PURE__*/React.createElement("strong", null, "「🗑 頂点を消す」をON"), "にしてから頂点をタップ。辺の中点にある小さな丸を", /*#__PURE__*/React.createElement("strong", null, "ドラッグ"), "すると頂点を足せます(触れただけでは増えません)。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", {
    ref: areaRef
  }, fmt(drawCrossed ? 0 : drawArea, 2)), " a"),
  // 警告行は drawCrossed で出し分けず常に置いておき、display だけを切り替える。
  // ドラッグ中は React を動かせないので、無い要素は出しようがないため。
  /*#__PURE__*/React.createElement("div", {
    ref: warnRef,
    style: {
      ...S.drawWarn,
      display: drawCrossed ? "" : "none"
    }
  }, "⚠ 線が交差しています。このままでは面積を正しく計算できないため登録できません。下の「並び順を直す」を押すか、頂点をドラッグして直してください。"),
  // 警告と同じく、常に置いて display だけを切り替える(ドラッグ中はReactを動かせない)
  /*#__PURE__*/React.createElement("button", {
    onClick: fixTwist,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      display: drawCrossed ? "" : "none"
    }
  }, "🔀 並び順を直す"), /*#__PURE__*/React.createElement("button", {
    onClick: () => changeAddMode(!addMode),
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      ...(addMode ? {
        background: "#FDEBE7",
        borderColor: "#C74E36",
        color: "#8a2f1c",
        fontWeight: 800
      } : {})
    }
  }, addMode ? "✏ 頂点を追加:ON(地図をタップすると増えます)" : "🔒 頂点を追加:OFF(地図をタップしても増えません)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => changeDelMode(!delMode),
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      ...(delMode ? {
        background: "#FBE9E4",
        borderColor: "#C74E36",
        color: "#8a2f1c"
      } : {})
    }
  }, delMode ? "🗑 頂点を消す:ON(頂点をタップすると消えます)" : "🗑 頂点を消す:OFF"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 8,
      gridTemplateColumns: "1fr 1fr"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: undoPt,
    disabled: histLen === 0,
    style: {
      ...S.secondaryBtn,
      opacity: histLen ? 1 : 0.4
    }
  }, "↩ 1つ戻す"), /*#__PURE__*/React.createElement("button", {
    onClick: resetDrawState,
    disabled: drawPts.length === 0,
    style: {
      ...S.secondaryBtn,
      opacity: drawPts.length ? 1 : 0.4
    }
  }, "全消し")), /*#__PURE__*/React.createElement("input", {
    value: newName,
    placeholder: "圃場名 ※必須",
    onChange: e => setNewName(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 10
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: newCrop,
    placeholder: "作物名(任意)",
    list: "croplist-gmap",
    onChange: e => setNewCrop(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "croplist-gmap"
  }, p.crops.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }))), /*#__PURE__*/React.createElement("input", {
    value: newZone,
    placeholder: "地区(任意)",
    list: "arealist-map",
    onChange: e => setNewZone(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "arealist-map"
  }, (p.areas || []).map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: saveDraw,
    disabled: drawPts.length < 3 || !newName.trim() || drawCrossed,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 10,
      opacity: drawPts.length >= 3 && newName.trim() && !drawCrossed ? 1 : 0.4
    }
  }, drawCrossed ? "⚠ 線の交差を直してください" : (editingFieldId != null ? "この圃場を保存(" : "この圃場を登録(") + fmt(drawArea, 2) + " a)"))), listOnly && /*#__PURE__*/React.createElement(FieldMasterPanel, {
    // 一覧は圃場マスタそのもの。囲んでいない圃場も含むので p.fields を渡す
    fields: p.fields,
    upsertField: p.upsertField,
    deleteField: p.deleteField,
    renameFields: p.renameFields,
    areas: p.areas,
    crops: p.crops,
    addCrop: p.addCrop,
    areaUnitKey: p.areaUnitKey,
    hidden: hidden,
    setHidden: setHidden,
    onFocus: f => {
      setListOnly(false);
      if (mapRef.current && f.center) {
        mapRef.current.setCenter({
          lat: f.center[0],
          lng: f.center[1]
        });
        mapRef.current.setZoom(17);
      }
    }
  }));
}

function LeafletMapTab(p) {
  const mapRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const layersRef = React.useRef({
    fields: null,
    draw: null,
    gps: null
  });
  const tileLayerRef = React.useRef(null); // 現在のタイルレイヤー
  const [ready, setReady] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [drawPts, setDrawPts] = React.useState([]);
  const [newName, setNewName] = React.useState("");
  const [newCrop, setNewCrop] = React.useState("");
  const [newZone, setNewZone] = React.useState(""); // 作図した圃場の地区
  const [editingFieldId, setEditingFieldId] = React.useState(null); // 既存圃場を編集中ならそのID。nullなら新規作図
  // 地図タップで頂点を足すかどうか。切れるようにしてあるのは、形を整えている最中に
  // 地図を触ってしまい、離れた場所に頂点ができて消す作業が発生していたため。
  // 地図のclickリスナーは初期化時に1回だけ張るので、値はrefでも持って参照する。
  const [addMode, setAddMode] = React.useState(true);
  const addModeRef = React.useRef(true);
  const changeAddMode = v => {
    addModeRef.current = v;
    setAddMode(v);
  };
  const [hidden, setHidden] = React.useState([]); // 地図に出さない圃場ID(この画面を開いている間だけ)
  const [listOnly, setListOnly] = React.useState(false); // 一覧だけを全画面で見るモード
  const [fullMap, setFullMap] = React.useState(false); // 地図だけを画面いっぱいに出す
  const mapWrapRef = React.useRef(null); // 地図+凡例の枠。高さを実測して決める
  // 全画面のまま作図できる。作図パネルは全画面のとき、地図の上に
  // 下からのシートとして重なる(S.drawPanelFull)。
  const [gpsOn, setGpsOn] = React.useState(false);
  const [zoom, setZoom] = React.useState(15);
  const [tileMode, setTileMode] = React.useState("photo"); // "photo" | "map"
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const drawArea = polygonAreaA(drawPts);
  const drawCrossed = polygonSelfIntersects(drawPts);
  const LABEL_MIN_ZOOM = 16; // これ以上に拡大すると圃場名・作物・面積の札を出す
  // 頂点をタップしたら消すモード。既定はOFF。
  // v8.58までは1回目のタップで✕に変わり、2回目で削除していた。
  // 形を直しているだけでも✕になるので、作業中に邪魔になる。
  const [delMode, setDelMode] = React.useState(false);
  const delModeRef = React.useRef(false);
  const [histLen, setHistLen] = React.useState(0); // 「1つ戻す」の有効判定に使う

  const histRef = React.useRef([]); // 作図中だけ持つ操作履歴(変更前のdrawPtsを積む)
  const draggingRef = React.useRef(false); // ドラッグ中は再描画しない(掴んだマーカーが消えるため)
  const lastEditAtRef = React.useRef(0); // 直前の頂点操作の時刻。地図のclickに化けた分を弾く
  const dragBeforeRef = React.useRef(null); // ドラッグ開始時の頂点配列(履歴に積む「変更前」)
  const drawLineRef = React.useRef(null); // 作図中の線。ドラッグ中に直接書き換える
  const drawFillRef = React.useRef(null); // 作図中の面。同上
  // 面積表示もドラッグ中はDOMを直接書き換えて追従させる(線・面と同じ理由)
  const {
    areaRef,
    warnRef,
    refreshAreaReadout
  } = useLiveAreaReadout(drawPtsRef);
  // 頂点編集を1手として確定する。履歴には「変更前」を積む
  const commitPts = (next, opt) => {
    const o = opt || {};
    const prev = o.prev || drawPtsRef.current;
    histRef.current = pushDrawHistory(histRef.current, prev);
    setHistLen(histRef.current.length);
    drawPtsRef.current = next;
    setDrawPts(next);
  };
  // ねじれを、頂点の並べ替えだけで直す。座標は1つも動かさない。
  // 自動では走らせない。凹んだ圃場では意図した形と変わりうるので、
  // 押した本人が結果を見て「↩ 1つ戻す」で戻せる形にしている。
  const fixTwist = () => {
    const cur = drawPtsRef.current;
    const next = untwistPts(cur);
    if (polygonSelfIntersects(next)) {
      // 並べ替えでは解けない形(頂点が重なっている等)。できなかったと伝えて、
      // 黙って何もしないことはしない
      p.flash && p.flash("並び順では直せませんでした。頂点をドラッグして直してください");
      return;
    }
    commitPts(next);
    p.flash && p.flash("頂点の並び順を直しました(戻すには「↩ 1つ戻す」)");
  };
  const removePt = i => {
    if (i < 0 || i >= drawPtsRef.current.length) return;
    commitPts(ptsRemove(drawPtsRef.current, i));
  };
  // 頂点を消すモードの切替。足すモードと同時にはONにしない。
  // 両方ONだと、消すつもりで地図を触ったときに頂点が増える。
  // 消すモードをやめたら、入る前の「頂点を追加」の状態に戻す。
  // 戻さないと、消し終わったあと地図をタップしても何も起きず、
  // なぜ増えないのか分からない。編集中はOFFで始まるので、
  // 一律にONに戻すのではなく覚えておいた値を使う。
  const addBeforeDelRef = React.useRef(true);
  const changeDelMode = v => {
    delModeRef.current = v;
    setDelMode(v);
    if (v) {
      addBeforeDelRef.current = addModeRef.current;
      changeAddMode(false);
    } else {
      changeAddMode(addBeforeDelRef.current);
    }
  };
  // 全消し・作図開始・やめる で使う。履歴もモードも落とす
  const resetDrawState = () => {
    histRef.current = [];
    setHistLen(0);
    drawPtsRef.current = [];
    setDrawPts([]);
    delModeRef.current = false;
    setDelMode(false);
    draggingRef.current = false;
    dragBeforeRef.current = null;
  };
  // ドラッグの終了処理。dragend からも保険のリスナーからも呼ばれるが、
  // draggingRef で入口を塞いでいるので二重に走っても履歴は1手しか積まれない
  const endDragCommit = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastEditAtRef.current = Date.now();
    const prev = dragBeforeRef.current;
    dragBeforeRef.current = null;
    const next = drawPtsRef.current;
    if (prev && prev !== next) {
      commitPts(next, {
        prev
      });
    } else {
      // 実際には動いていない。履歴を汚さず、マーカーの位置だけ描き直す
      const same = next.slice();
      drawPtsRef.current = same;
      setDrawPts(same);
    }
  };
  // ドラッグ中に線・面・面積表示を追従させる(マーカーは作り直さない)
  const refreshDrawShapes = () => {
    const pts = drawPtsRef.current;
    if (drawLineRef.current) drawLineRef.current.setLatLngs(pts.length >= 3 ? [...pts, pts[0]] : pts);
    if (drawFillRef.current) drawFillRef.current.setLatLngs(pts);
    // 頂点・中点ハンドルの drag は全部ここを通るので、面積表示の追従もここで済ませる
    refreshAreaReadout();
  };
  // dragend を取りこぼしてもドラッグ状態が残らないようにする保険。
  // スマホではブラウザがスクロールを引き取って pointercancel で終わることがあり、
  // その場合 dragend は来ない。フラグが立ちっぱなしになると再描画effectが
  // 冒頭で抜け続け、地図が二度と更新されなくなるため必ず拾う。
  // document ではなく window に張るのは、地図ライブラリが document で受ける
  // ドラッグ終了処理(=正規の dragend)を先に走らせてから保険を効かせるため。
  React.useEffect(() => {
    if (!drawing) return;
    const onEnd = () => endDragCommit();
    const types = ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"];
    types.forEach(t => window.addEventListener(t, onEnd));
    return () => {
      types.forEach(t => window.removeEventListener(t, onEnd));
    };
  }, [drawing]);

  // タイル定義
  const TILES = {
    photo: {
      url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
      attr: "地理院タイル",
      maxNative: 18
    },
    // 道路・地名は国土地理院の標準地図を使う。以前は OpenStreetMap のタイルサーバーを
    // 直接読んでいたが、OSMF の Tile Usage Policy が一般配布アプリからの継続的な利用
    // (systematic/heavy use)を認めていないため差し替えた。航空写真と同じ配信元になる
    map: {
      url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
      attr: "地理院タイル",
      maxNative: 18
    }
  };

  // タイルレイヤーの切り替え
  const toggleTileMode = () => {
    const next = tileMode === "photo" ? "map" : "photo";
    setTileMode(next);
    if (!mapRef.current || !window.L) return;
    const L = window.L;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    const t = TILES[next];
    tileLayerRef.current = L.tileLayer(t.url, {
      attribution: t.attr,
      maxZoom: 21,
      maxNativeZoom: t.maxNative
    }).addTo(mapRef.current);
  };

  // 地図の初期化(1回だけ)
  React.useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const L = window.L;
    // 初期表示:登録済み圃場があればその中心、なければ日本の中心付近
    let center = [35.0, 137.0];
    let z = 5;
    const withPoly = p.fields.filter(f => f.center);
    if (withPoly.length > 0) {
      center = withPoly[0].center;
      z = 17;
    }
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      maxZoom: 21
    }).setView(center, z);
    // 国土地理院 航空写真タイル(初期)
    tileLayerRef.current = L.tileLayer(TILES.photo.url, {
      attribution: TILES.photo.attr,
      maxZoom: 21,
      maxNativeZoom: TILES.photo.maxNative
    }).addTo(map);
    mapRef.current = map;
    setZoom(map.getZoom());
    layersRef.current.fields = L.layerGroup().addTo(map);
    layersRef.current.draw = L.layerGroup().addTo(map);
    layersRef.current.gps = L.layerGroup().addTo(map);
    // タップで作図
    map.on("click", e => {
      if (!drawingRef.current || draggingRef.current) return;
      if (!addModeRef.current) return; // 「頂点を追加」がOFFのときは地図を触っても増やさない
      // マーカー操作の直後に地図のclickが続くと点が増えてしまうので短時間だけ弾く
      if (Date.now() - lastEditAtRef.current < 400) return;
      commitPts([...drawPtsRef.current, [e.latlng.lat, e.latlng.lng]]);
    });
    map.on("zoomend", () => setZoom(map.getZoom()));
    setReady(true);
    setTimeout(() => map.invalidateSize(), 200);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 登録済み圃場ポリゴンを再描画
  React.useEffect(() => {
    if (!ready || !window.L) return;
    const L = window.L;
    const grp = layersRef.current.fields;
    grp.clearLayers();
    const showLabel = zoom >= LABEL_MIN_ZOOM;
    p.fields.forEach(f => {
      if (!f.polygon || f.polygon.length < 3) return;
      if (hidden.indexOf(f.id) >= 0) return;
      const st = FIELD_COLOR;
      const poly = L.polygon(f.polygon, {
        color: st.stroke,
        weight: 3,
        fillColor: st.fill,
        fillOpacity: st.opacity
      }).addTo(grp);
      if (showLabel) {
        // 圃場名と面積を別の行にする。同じ行に並べると、
        // 名前に数字が入る圃場(「嘉島60」など)で面積と続きの数字に見える。
        // 名前は受け取った文字列でもあるので、必ずエスケープしてからHTMLに入れる。
        const labelText = '<span class="fl-name">' + escapeHtml(f.name) + (f.crop ? '<span class="fl-crop"> / ' + escapeHtml(f.crop) + '</span>' : "") + '</span><span class="fl-area">' + escapeHtml(fieldAreaText(f, p.areaUnitKey)) + '</span>';
        poly.bindTooltip(labelText, {
          permanent: true,
          direction: "center",
          className: "field-label"
        });
      }
      poly.on("click", () => {
        startEditPoly(f);
      });
    });
  }, [ready, p.fields, zoom, hidden, p.areaUnitKey]); // 単位を変えたら札も描き直す

  // 作図中ポリゴンの再描画
  React.useEffect(() => {
    if (!ready || !window.L) return;
    // ドラッグ中に作り直すと掴んでいるマーカーごと消えて動かせなくなる
    if (draggingRef.current) return;
    const L = window.L;
    const grp = layersRef.current.draw;
    grp.clearLayers();
    drawLineRef.current = null;
    drawFillRef.current = null;
    if (drawPts.length > 0) {
      // 頂点(ドラッグで移動。削除モードのときだけタップで消える)
      drawPts.forEach((pt, i) => {
        const sel = delMode; // 削除モード中は全部の頂点を✕にして、押せば消えることを見せる
        const icon = L.divIcon({
          className: "vtx-icon",
          html: '<div class="vtx' + (sel ? " vtx-sel" : "") + '">' + escapeHtml(sel ? "✕" : String(i + 1)) + '</div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        const m = L.marker(pt, {
          icon,
          draggable: true,
          zIndexOffset: 1000
        }).addTo(grp);
        let moved = false; // 動かしたときは選択・削除に化けさせない
        let before = drawPtsRef.current;
        m.on("dragstart", () => {
          moved = true;
          draggingRef.current = true;
          before = drawPtsRef.current;
          dragBeforeRef.current = before;
        });
        m.on("drag", e => {
          // ドラッグ中は ref と線・面だけを直接更新する。
          // ここで setDrawPts を呼ぶと再描画で掴んでいるマーカーが破棄されてしまう
          const ll = e.target.getLatLng();
          drawPtsRef.current = ptsMove(drawPtsRef.current, i, ll.lat, ll.lng);
          refreshDrawShapes();
        });
        m.on("dragend", e => {
          if (!draggingRef.current) return; // 保険のリスナーが先に確定済み
          const ll = e.target.getLatLng();
          drawPtsRef.current = ptsMove(before, i, ll.lat, ll.lng);
          endDragCommit();
        });
        m.on("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
          if (delModeRef.current) removePt(i);
        });
      });
      // 辺の中点ハンドル(頂点より小さく薄い。ドラッグしたときだけ頂点を挿入)
      drawMidpoints(drawPts).forEach(mp => {
        const icon = L.divIcon({
          className: "vtx-icon",
          html: '<div class="vtx-mid"></div>',
          iconSize: [9, 9],
          iconAnchor: [4.5, 4.5]
        });
        const h = L.marker([mp.lat, mp.lng], {
          icon,
          draggable: true,
          zIndexOffset: 500
        }).addTo(grp);
        let moved = false;
        let before = drawPtsRef.current;
        h.on("dragstart", () => {
          moved = true;
          draggingRef.current = true;
          before = drawPtsRef.current;
          dragBeforeRef.current = before;
          // 掴んだ瞬間に挿入しておくと、そのまま新しい頂点として引っ張れる
          drawPtsRef.current = ptsInsert(before, mp.edge, mp.lat, mp.lng);
        });
        h.on("drag", e => {
          const ll = e.target.getLatLng();
          drawPtsRef.current = ptsMove(drawPtsRef.current, mp.edge + 1, ll.lat, ll.lng);
          refreshDrawShapes();
        });
        h.on("dragend", e => {
          if (!draggingRef.current) return; // 保険のリスナーが先に確定済み
          const ll = e.target.getLatLng();
          drawPtsRef.current = ptsInsert(before, mp.edge, ll.lat, ll.lng);
          endDragCommit();
        });
        // 中点ハンドルは「ドラッグしたときだけ」頂点を足す。
        // 以前はタップでも挿入していたが、形を見ようとして触れただけ・
        // 地図を動かそうとして指が乗っただけで頂点が増えてしまい、
        // 消す操作が余計に発生していた。挿入は意図の要るドラッグに限る。
        // clickを拾わないと、このタップが地図のclickとして扱われて
        // 別の場所に頂点が増えるので、受けるだけ受けて何もしない。
        h.on("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
        });
      });
      if (drawPts.length >= 2) drawLineRef.current = L.polyline([...drawPts, ...(drawPts.length >= 3 ? [drawPts[0]] : [])], {
        color: "#C74E36",
        weight: 2,
        dashArray: "6 4"
      }).addTo(grp);
      if (drawPts.length >= 3) drawFillRef.current = L.polygon(drawPts, {
        color: "#C74E36",
        weight: 1,
        fillColor: "#C74E36",
        fillOpacity: 0.15
      }).addTo(grp);
    }
  }, [ready, drawPts, delMode]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    // 新規はまず点を打つところから始まるのでONで開く
    changeAddMode(true);
    resetDrawState();
  };
  // 既存の圃場ポリゴンをタップしたときの編集開始。頂点・圃場名などを
  // 作図パネルへ読み込み、地図上では二重表示にならないよう元のポリゴンを隠す
  const startEditPoly = f => {
    if (drawingRef.current) return; // 作図中に他の圃場へ乗り換えさせない
    setDrawing(true);
    drawingRef.current = true;
    // 圃場ポリゴンのclickは地図のclickにも伝播する。何もしないと、選択に使った
    // 同じタップが「作図中の地図タップ」として処理され、5点目の頂点が紛れ込む
    lastEditAtRef.current = Date.now();
    // 既存の圃場は「形を整えに来た」場面なので、追加はOFFで開く。
    // ONのままだと地図に触れるたびに離れた場所へ頂点ができ、消す作業が発生する
    changeAddMode(false);
    resetDrawState();
    const pts = (f.polygon || []).map(pt => [pt[0], pt[1]]);
    drawPtsRef.current = pts;
    setDrawPts(pts);
    setNewName(f.name || "");
    setNewCrop(f.crop || "");
    setNewZone(f.area || "");
    setEditingFieldId(f.id);
    setHidden(h => h.indexOf(f.id) >= 0 ? h : [...h, f.id]);
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    resetDrawState();
    setNewName("");
    setNewCrop("");
    setNewZone("");
    if (editingFieldId != null) setHidden(h => h.filter(id => id !== editingFieldId));
    setEditingFieldId(null);
    changeAddMode(true); // 次に「✏ 圃場を囲む」で始めるときのために戻しておく
  };
  // 追加・移動・削除・挿入をまとめて1手ずつ戻す
  const undoPt = () => {
    if (histRef.current.length === 0) return;
    const prev = histRef.current[histRef.current.length - 1];
    histRef.current = histRef.current.slice(0, -1);
    setHistLen(histRef.current.length);
    drawPtsRef.current = prev;
    setDrawPts(prev);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    // ねじれたまま登録すると面積が実際より小さく出るので、ここで止める
    if (polygonSelfIntersects(drawPts)) {
      p.flash && p.flash("線が交差しています。頂点を動かしてねじれを直してください");
      return;
    }
    // 座標は保存時に丸める。倍精度のまま貯めると、あとからチーム共有が
    // セル上限に当たって保存できなくなる(roundPts のコメント参照)。
    //
    // ただし面積は「丸める前の座標」から出す。丸めた座標から計算し直すと、
    // 作図中にパネルで見えていた面積と、保存された面積がわずかにずれる。
    // 面積は散布量やアグリノート転記に流れるので、画面で確認した値が
    // そのまま残るようにする。
    const pts = roundPts(drawPts);
    const center = roundPts([polygonCenter(drawPts)])[0];
    let areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    // 形をまったく動かさずに保存したときは、登録されている面積をそのまま残す。
    // 計算し直すと、データベースで手入力した面積(登記簿の値など)が
    // 囲んだ形から出した値で黙って上書きされてしまう。
    const editTarget = editingFieldId != null ? p.fields.find(x => x.id === editingFieldId) : null;
    if (editTarget && JSON.stringify(editTarget.polygon) === JSON.stringify(pts) && parseFloat(editTarget.areaA) > 0) {
      areaA = editTarget.areaA;
    }
    const data = {
      name: newName.trim(),
      crop: newCrop.trim(),
      area: newZone.trim(),
      areaA,
      polygon: pts,
      center
    };
    if (editingFieldId != null) {
      p.upsertField(data, editingFieldId);
    } else {
      p.addFieldWithPolygon(data);
    }
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    // 全画面で新しい圃場を囲んだときは、そのまま次の圃場を囲める状態に戻す。
    // 全画面を抜けずに何枚も続けて登録する使い方(現地で一気に囲む)を想定している。
    // 既存の圃場を編集していたときは続けない(編集は1枚ずつ終わる作業のため)。
    const drawAgain = editingFieldId == null && fullMap;
    cancelDraw();
    // ここで flash は出さない。登録できたことは addFieldWithPolygon 側が
    // 面積つきで知らせており(「登録しました(◯◯a)」)、上書きすると
    // その面積の確認が消える。続けて囲めることは、1行バーが「0点」で
    // 残っていることで分かる
    if (drawAgain) startDraw();
  };

  // 一覧表示中と、他のタブを見ている間はどちらも display:none で隠れている
  const mapHidden = listOnly || p.active === false;
  useMapHeightFit(mapWrapRef, mapHidden, drawing, ready, fullMap, () => {
    if (mapRef.current) mapRef.current.invalidateSize();
  });
  // display:none の間はサイズを取れないので、地図に戻したら測り直させる
  React.useEffect(() => {
    if (mapHidden || !mapRef.current) return;
    const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [mapHidden]);

  // 現在地表示
  const toggleGps = () => {
    if (!window.L || !mapRef.current) return;
    const grp = layersRef.current.gps;
    if (gpsOn) {
      grp.clearLayers();
      setGpsOn(false);
      return;
    }
    if (!navigator.geolocation) {
      p.flash && p.flash("この端末は位置情報に対応していません");
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
      const L = window.L;
      const ll = [pos.coords.latitude, pos.coords.longitude];
      grp.clearLayers();
      L.circleMarker(ll, {
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: "#3B7EA1",
        fillOpacity: 1
      }).addTo(grp).bindTooltip("現在地", {
        permanent: true,
        direction: "top"
      });
      mapRef.current.setView(ll, 16);
      setGpsOn(true);
    }, () => {
      p.flash && p.flash("位置情報を取得できませんでした(権限を確認してください)");
    }, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: {
      ...S.card,
      padding: "10px 10px 12px"
    },
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.mapSegWrap
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setListOnly(false),
    style: {
      ...S.mapSeg,
      ...(listOnly ? {} : S.segOn)
    }
  }, "🗺 地図"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setListOnly(true),
    style: {
      ...S.mapSeg,
      ...(listOnly ? S.segOn : {})
    }
  }, "📋 圃場一覧")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, !listOnly && /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(true),
    style: S.smallSecondary,
    title: "地図を全画面で見る"
  }, "⛶"), /*#__PURE__*/React.createElement("button", {
    onClick: toggleGps,
    style: {
      ...S.smallSecondary,
      ...(gpsOn ? {
        background: "#EAF3FA",
        borderColor: "#3B7EA1",
        color: "#2b5a7a"
      } : {})
    }
  }, "📍 現在地"), /*#__PURE__*/React.createElement("button", {
    onClick: toggleTileMode,
    style: {
      ...S.smallSecondary,
      ...(tileMode === "map" ? {
        background: "#FBF7EC",
        borderColor: "#E4D6AC",
        color: "#8a621f"
      } : {})
    }
  }, tileMode === "photo" ? "🗺 地図表示" : "📷 衛星写真"), !drawing ? /*#__PURE__*/React.createElement("button", {
    onClick: startDraw,
    style: S.smallPrimary
  }, "✏ 圃場を囲む") : /*#__PURE__*/React.createElement("button", {
    onClick: cancelDraw,
    style: S.smallDanger
  }, "やめる"))), !listOnly && /*#__PURE__*/React.createElement(AddressSearchBox, {
    flash: p.flash,
    onFound: (lat, lng) => {
      if (!mapRef.current) return;
      mapRef.current.setView([lat, lng], 17);
    }
  }), !window.L && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "地図ライブラリを読み込めませんでした。オンラインで開き直してください。"), /*#__PURE__*/React.createElement("div", {
    ref: mapWrapRef,
    style: listOnly ? {
      ...S.mapWrap,
      display: "none"
    } : fullMap ? S.mapWrapFull : S.mapWrap
  }, /*#__PURE__*/React.createElement("div", {
    ref: containerRef,
    style: fullMap ? {
      ...S.mapBox,
      borderRadius: 0,
      border: "none"
    } : S.mapBox,
    "data-map-box": ""
  }), fullMap && drawing && /*#__PURE__*/React.createElement("button", {
    // 作図中は下の帯を作図パネルが使うので、抜けるボタンは右上に出す。
    // 作図していないときは下の帯(S.fullBar)にまとめてある。
    onClick: () => setFullMap(false),
    style: S.mapFullExit
  }, "✕ 全画面をやめる")), fullMap && !drawing && /*#__PURE__*/React.createElement("div", {
    style: S.fullBar,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", {
    style: S.fullBarHint
  }, "圃場をタップすると形を直せます"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(false),
    style: S.drawBarBtn
  }, "✕ 全画面"), /*#__PURE__*/React.createElement("button", {
    onClick: startDraw,
    style: S.fullBarPrimary
  }, "✏ 圃場を囲む")), drawing && fullMap && /*#__PURE__*/React.createElement(DrawBarFull, {
    drawPts,
    drawArea,
    drawCrossed,
    addMode,
    changeAddMode,
    delMode,
    changeDelMode,
    areaRef,
    warnRef,
    undoPt,
    histLen,
    resetDrawState,
    fixTwist,
    onCancel: cancelDraw,
    editing: editingFieldId != null,
    newName,
    setNewName,
    newCrop,
    setNewCrop,
    newZone,
    setNewZone,
    saveDraw,
    crops: p.crops,
    areas: p.areas
  }), drawing && !fullMap && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, editingFieldId != null && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      color: "#C74E36",
      fontWeight: "700",
      marginBottom: 4
    }
  }, "✎「", newName || "この圃場", "」を編集中(「この圃場を保存」を押すまでは元の圃場データは変わりません。「やめる」で編集を取り消せます)"), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, addMode ? "地図をタップして圃場の角を順に打ちます(3点以上)。" : "いまは地図をタップしても頂点は増えません。足したいときは下の「頂点を追加」をONにしてください。", "頂点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "。消すときは", /*#__PURE__*/React.createElement("strong", null, "「🗑 頂点を消す」をON"), "にしてから頂点をタップ。辺の中点にある小さな丸を", /*#__PURE__*/React.createElement("strong", null, "ドラッグ"), "すると頂点を足せます(触れただけでは増えません)。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", {
    ref: areaRef
  }, fmt(drawCrossed ? 0 : drawArea, 2)), " a"),
  // 警告行は drawCrossed で出し分けず常に置いておき、display だけを切り替える。
  // ドラッグ中は React を動かせないので、無い要素は出しようがないため。
  /*#__PURE__*/React.createElement("div", {
    ref: warnRef,
    style: {
      ...S.drawWarn,
      display: drawCrossed ? "" : "none"
    }
  }, "⚠ 線が交差しています。このままでは面積を正しく計算できないため登録できません。下の「並び順を直す」を押すか、頂点をドラッグして直してください。"),
  // 警告と同じく、常に置いて display だけを切り替える(ドラッグ中はReactを動かせない)
  /*#__PURE__*/React.createElement("button", {
    onClick: fixTwist,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      display: drawCrossed ? "" : "none"
    }
  }, "🔀 並び順を直す"), /*#__PURE__*/React.createElement("button", {
    onClick: () => changeAddMode(!addMode),
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      ...(addMode ? {
        background: "#FDEBE7",
        borderColor: "#C74E36",
        color: "#8a2f1c",
        fontWeight: 800
      } : {})
    }
  }, addMode ? "✏ 頂点を追加:ON(地図をタップすると増えます)" : "🔒 頂点を追加:OFF(地図をタップしても増えません)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => changeDelMode(!delMode),
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 8,
      ...(delMode ? {
        background: "#FBE9E4",
        borderColor: "#C74E36",
        color: "#8a2f1c"
      } : {})
    }
  }, delMode ? "🗑 頂点を消す:ON(頂点をタップすると消えます)" : "🗑 頂点を消す:OFF"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 8,
      gridTemplateColumns: "1fr 1fr"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: undoPt,
    disabled: histLen === 0,
    style: {
      ...S.secondaryBtn,
      opacity: histLen ? 1 : 0.4
    }
  }, "↩ 1つ戻す"), /*#__PURE__*/React.createElement("button", {
    onClick: resetDrawState,
    disabled: drawPts.length === 0,
    style: {
      ...S.secondaryBtn,
      opacity: drawPts.length ? 1 : 0.4
    }
  }, "全消し")), /*#__PURE__*/React.createElement("input", {
    value: newName,
    placeholder: "圃場名 ※必須",
    onChange: e => setNewName(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 10
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: newCrop,
    placeholder: "作物名(任意)",
    list: "croplist-map",
    onChange: e => setNewCrop(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "croplist-map"
  }, p.crops.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }))), /*#__PURE__*/React.createElement("input", {
    value: newZone,
    placeholder: "地区(任意)",
    list: "arealist-map",
    onChange: e => setNewZone(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "arealist-map"
  }, (p.areas || []).map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: saveDraw,
    disabled: drawPts.length < 3 || !newName.trim() || drawCrossed,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 10,
      opacity: drawPts.length >= 3 && newName.trim() && !drawCrossed ? 1 : 0.4
    }
  }, drawCrossed ? "⚠ 線の交差を直してください" : (editingFieldId != null ? "この圃場を保存(" : "この圃場を登録(") + fmt(drawArea, 2) + " a)"))), listOnly && /*#__PURE__*/React.createElement(FieldMasterPanel, {
    // 一覧は圃場マスタそのもの。囲んでいない圃場も含むので p.fields を渡す
    fields: p.fields,
    upsertField: p.upsertField,
    deleteField: p.deleteField,
    renameFields: p.renameFields,
    areas: p.areas,
    crops: p.crops,
    addCrop: p.addCrop,
    areaUnitKey: p.areaUnitKey,
    hidden: hidden,
    setHidden: setHidden,
    onFocus: f => {
      setListOnly(false);
      if (mapRef.current && f.center) mapRef.current.setView(f.center, 16);
    }
  }));
}

// 設定タブの各カードで使う、開閉できる見出し(タップで展開/折りたたみ)
function collapsibleHead(title, isOpen, onClick) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "transparent",
      border: "none",
      padding: 0,
      marginBottom: isOpen ? 12 : 0,
      cursor: "pointer",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.cardLabel
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "#8a978e",
      flexShrink: 0,
      marginLeft: 8
    }
  }, isOpen ? "▲" : "▼"));
}
function SettingsTab(p) {
  const [newCrop, setNewCrop] = useState("");
  // APIキーは肩越しに見られると悪用されるので、既定では伏せて表示する。
  // 打ち間違いの確認ができないと困るので、目のボタンで一時的に出せるようにする。
  const [showKey, setShowKey] = useState(false);
  const [showAuth, setShowAuth] = useState(false); // 共有パスワードの伏せ字を一時的に外す
  const [openSec, setOpenSec] = useState({});
  const toggleSec = key => setOpenSec(s => ({
    ...s,
    [key]: !s[key]
  }));
  const [openVer, setOpenVer] = useState({});
  const [showLegacy, setShowLegacy] = useState(false); // 古い共有方式の開閉
  // 送信・共有カードの中の段見出し。ボタンが6つ並んでいて
  // どれを押せばいいのか分からなかったのを、番号付きの段に分ける。
  const secHead = (t, first) => /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800,
      color: "#1C2B21",
      marginTop: first ? 4 : 18,
      marginBottom: 8,
      paddingTop: first ? 0 : 14,
      borderTop: first ? "none" : "1px solid #E3E8E0"
    }
  }, t);
  // 農薬データの取り込み状態。例:「6,275件・2026-08-23 取り込み」
  const chemDbStatus = p.chemDbInfo ? Number(p.chemDbInfo.count || 0).toLocaleString() + "件・" + String(p.chemDbInfo.savedAt || "").slice(0, 10) + " 取り込み" : "未取り込み";
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("表示単位", openSec.unit, () => toggleSec("unit")), openSec.unit && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "面積の単位"), /*#__PURE__*/React.createElement("select", {
    value: p.areaUnitKey,
    onChange: e => p.setAreaUnitKey(e.target.value),
    style: S.unitSelect
  }, AREA_UNITS.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.key,
    value: u.key
  }, u.label)))), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "薬量・液量の単位"), /*#__PURE__*/React.createElement("select", {
    value: p.volUnitKey,
    onChange: e => p.setVolUnitKey(e.target.value),
    style: S.unitSelect
  }, VOL_UNITS.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.key,
    value: u.key
  }, u.label)))), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "入力は面積=a、薬量=Lで行い、表示だけこの単位に変換されます。1反=10a、1町=100a、1ha=100a。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("作物マスタ(圃場登録時に選べる作物)", openSec.crop, () => toggleSec("crop")), openSec.crop && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: newCrop,
    placeholder: "作物名を追加(例:キャベツ)",
    onChange: e => setNewCrop(e.target.value),
    style: {
      ...S.fieldInput,
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (newCrop.trim()) {
        p.addCrop(newCrop.trim());
        setNewCrop("");
      }
    },
    disabled: !newCrop.trim(),
    style: {
      ...S.smallPrimary,
      opacity: newCrop.trim() ? 1 : 0.4
    }
  }, "追加")), p.crops.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.empty,
      padding: "16px 8px"
    }
  }, "まだ作物がありません。よく使う作物を登録しておくと、圃場登録で選べます。"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12
    }
  }, p.crops.map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: S.cropChip
  }, c, /*#__PURE__*/React.createElement("button", {
    onClick: () => p.deleteCrop(c),
    style: S.cropChipX,
    "aria-label": "削除"
  }, "✕")))))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("送信・共有", openSec.send, () => toggleSec("send")), openSec.send && /*#__PURE__*/React.createElement(React.Fragment, null, secHead("１　つなぎ先", true), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "送信先URL(Apps ScriptのウェブアプリURL)"), /*#__PURE__*/React.createElement("input", {
    value: p.gasUrl,
    onChange: e => p.setGasUrl(e.target.value),
    placeholder: "https://script.google.com/macros/s/…/exec",
    style: S.fieldInput,
    inputMode: "url",
    autoCapitalize: "off"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.areaGrid,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "記録者名"), /*#__PURE__*/React.createElement("input", {
    value: p.recorder,
    onChange: e => p.setRecorder(e.target.value),
    placeholder: "例:藤本",
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "チームコード(共有用)"), /*#__PURE__*/React.createElement("input", {
    value: p.teamCode,
    onChange: e => p.setTeamCode(e.target.value),
    placeholder: "例:jupiter2026",
    style: S.fieldInput,
    autoCapitalize: "off"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      marginTop: 12
    }
  }, "共有パスワード(GASのSHARED_SECRETと同じ文字列)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    // APIキー欄と同じ考え方。type=password で端末に伏せ字を任せる
    // (自前で●に置き換えると本物の値が消え、空のまま保存する事故になる)
    type: showAuth ? "text" : "password",
    value: p.authKey,
    onChange: e => p.setAuthKey(e.target.value),
    placeholder: "未設定なら空欄のまま",
    style: {
      ...S.fieldInput,
      flex: 1,
      fontFamily: "monospace",
      fontSize: 14
    },
    autoComplete: "off",
    autoCapitalize: "off",
    autoCorrect: "off",
    spellCheck: false
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAuth(v => !v),
    style: {
      ...S.smallSecondary,
      flexShrink: 0
    },
    title: showAuth ? "パスワードを隠す" : "パスワードを表示する",
    "aria-label": showAuth ? "パスワードを隠す" : "パスワードを表示する"
  }, showAuth ? "🙈" : "👁")), /*#__PURE__*/React.createElement("button", {
    onClick: p.testConnection,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 12
    }
  }, "接続テスト"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "チームコードは、一緒に作業する端末で同じ文字列にします。大文字と小文字は区別されます。共有パスワードはGAS側でスクリプトプロパティ SHARED_SECRET を設定しているときだけ使います。未設定なら空欄で動きますが、その場合はURLを知っている人なら誰でも書き込めます。"), secHead("２　データ共有(圃場・薬剤)"), /*#__PURE__*/React.createElement("button", {
    onClick: p.syncShared,
    disabled: p.syncing,
    style: {
      ...S.secondaryBtn,
      width: "100%"
    }
  }, "🔁 今すぐ同期する"), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "自動取得の間隔(作業タブ・地図タブを開いている間)"), /*#__PURE__*/React.createElement("select", {
    value: p.pullSec,
    onChange: e => p.setPullSec(e.target.value),
    style: S.unitSelect
  }, PULL_SEC_CHOICES.map(v => /*#__PURE__*/React.createElement("option", {
    key: v,
    value: v
  }, PULL_SEC_LABELS[v])))), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "短くするほど、他の端末の予定や進捗が早く手元に出ます。そのぶん、スプレッドシート側のスクリプトが回る回数は増えます(端末の台数だけ倍になります)。Apps Script の公式の上限は「1回の実行は最長6分」「同時実行は1ユーザー30まで」で、よく見る「90分/日(個人)・6時間/日(Workspace)」はトリガーの合計実行時間のことで、このアプリが使っているウェブアプリの呼び出しには当たりません。ウェブアプリの1日あたりの呼び出し回数の上限は、公式の表には載っていません(2026-08確認)。ただし制限が無いという意味ではなく、このアプリでは実測していません。まずは30秒で使ってみて、遅ければ短くしてください。画面を裏に回している間と、調合・設定タブを開いている間は取りに行きません。"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "圃場と薬剤は、登録・編集・削除した時点で自動的に送られます。このボタンは、圏外だったときの送り直しと、他の端末が入れた分を今すぐ受け取るためのものです。変わったものだけをやりとりするので、他の端末が足した圃場や薬剤を消しません。"), secHead("３　作業データの送信"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.pushProgress(),
    disabled: p.syncing,
    style: {
      ...S.secondaryBtn,
      width: "100%"
    }
  }, "🚦 進捗を送り直す"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "実績を保存したときと、「散布済」のチェックを入れ外ししたときに自動で送られます。このボタンは圏外だったときの送り直し用です。作業タブの「📤 送信」はこれとは別で、スプレッドシートの「防除記録」に1行ずつ台帳として残します。"), secHead("４　古い方式(通常は使いません)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowLegacy(v => !v),
    style: {
      ...S.smallSecondary,
      width: "100%"
    }
  }, showLegacy ? "閉じる" : "開く"), showLegacy && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.cloudSave,
    disabled: p.syncing,
    style: {
      ...S.smallSecondary,
      padding: "13px 0"
    }
  }, "☁↑ 端末→共有へ保存"), /*#__PURE__*/React.createElement("button", {
    onClick: p.cloudLoad,
    disabled: p.syncing,
    style: {
      ...S.smallSecondary,
      padding: "13px 0"
    }
  }, "☁↓ 共有→端末へ読込")), /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      color: "#A15E08"
    }
  }, "この2つは、圃場・薬剤・作業リストを丸ごと入れ替える古い方式です。他の端末があとから足したものを消します。上の「🔁 今すぐ同期する」で済むので、普段は使わないでください。古い版の端末から移すときだけ使います。")), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "共有・送信される内容は、圃場名・作物・面積・圃場の位置情報(地図で囲んだ緯度経度)・地区・薬剤・作業記録・記録者名と、この端末を区別するための端末ID(初回起動時に作られる意味のない文字列で、機種や電話番号とは無関係です)です。作業者の現在地は送信しません。送信先はあなたが設定したGoogleスプレッドシートだけで、このアプリの作者を含む第三者には送信されません。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("農薬データ", openSec.chemdb, () => toggleSec("chemdb")), openSec.chemdb && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "この端末の状態"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontWeight: 700,
      color: p.chemDbInfo ? "#166534" : "#92400e"
    }
  }, chemDbStatus), /*#__PURE__*/React.createElement("button", {
    onClick: p.importChemDb,
    disabled: p.chemDbBusy,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 12,
      opacity: p.chemDbBusy ? 0.6 : 1
    }
  }, p.chemDbBusy ? "取り込み中… " + (p.chemDbProgress || "") : "⬇ 農薬データを取り込む"), /*#__PURE__*/React.createElement("button", {
    onClick: p.deleteChemDb,
    disabled: p.chemDbBusy || !p.chemDbInfo,
    style: {
      ...S.smallSecondary,
      width: "100%",
      marginTop: 8,
      padding: "13px 0",
      opacity: p.chemDbBusy || !p.chemDbInfo ? 0.5 : 1
    }
  }, "🗑 取り込んだデータを削除"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "農薬の登録番号・名称・成分での検索に使うデータです。先に上の「送信・共有設定」で送信先URLと共有パスワードを設定してください。取り込みはあなたのGoogleドライブに置いた chemdb.json を、あなたのApps Script経由で受け取ります(設置手順はCode.gsの冒頭に書いてあります)。一度取り込めば、以降は圏外でも検索できます。"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "出典: 独立行政法人農林水産消費安全技術センター(FAMIC)「農薬登録情報ダウンロード」を加工して作成。農薬名は各社の商標または登録商標です。取り込んであるのは特定時点のデータで、登録情報は変わります。使用前に必ずラベルを確認してください。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("地図タブの設定", openSec.map, () => toggleSec("map")), openSec.map && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "既定の地図エンジン"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.segWrap,
      marginTop: 6,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setMapEngine("leaflet"),
    style: {
      ...S.seg,
      ...(p.mapEngine === "leaflet" ? S.segOn : {})
    }
  }, "無料地図(Leaflet)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.setMapEngine("google"),
    style: {
      ...S.seg,
      ...(p.mapEngine === "google" ? S.segOn : {})
    }
  }, "Google マップ")), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "Google Maps APIキー"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    // type=password にすると端末が伏せ字にしてくれる(自前で● に置き換えると
    // 本物の値が消えてしまい、保存で空のキーを書き込む事故になる)
    type: showKey ? "text" : "password",
    value: p.gmapKeyInput,
    onChange: e => p.setGmapKeyInput(e.target.value),
    placeholder: "AIzaSy...",
    style: {
      ...S.fieldInput,
      flex: 1,
      fontFamily: "monospace",
      fontSize: 14
    },
    autoCapitalize: "off",
    autoCorrect: "off",
    autoComplete: "off",
    spellCheck: false
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowKey(v => !v),
    style: {
      ...S.smallSecondary,
      flexShrink: 0
    },
    title: showKey ? "キーを隠す" : "キーを表示する",
    "aria-label": showKey ? "キーを隠す" : "キーを表示する"
  }, showKey ? "🙈" : "👁")), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.saveGmapKey(p.gmapKeyInput),
    style: {
      ...S.smallSecondary,
      marginTop: 10
    }
  }, "💾 APIキーを保存"), p.gmapKey && /*#__PURE__*/React.createElement("span", {
    style: {
      ...S.smallLabel,
      marginLeft: 10,
      color: "#2E7D4F"
    }
  }, "✓ 保存済み"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "Google マップに切り替えると、地図タブで衛星写真と道路・地名を同時に表示できます。APIキーはこの端末の中にだけ保存され、ソースコード(GitHub)には一切含まれません。ただし地図を読み込むたびにGoogleのサーバーへは送信されるため、Google Cloud Consoleでドメイン制限(HTTPリファラー制限)を必ず設定してください。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("散布タンク", openSec.tank, () => toggleSec("tank")), openSec.tank && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "タンク容量(L)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    step: "10",
    value: p.tankCapacityL,
    onChange: e => p.setTankCapacityL(e.target.value),
    placeholder: "200",
    style: S.fieldInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "散布車の水タンクの容量です。作業タブでこの日に回る圃場の予定薬液量を上から足していき、容量を超える手前に「⛽ ここで補給」の目印を出します。空欄や0にすると目印は出ず、累計だけを表示します。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("農薬の使用回数", openSec.season, () => toggleSec("season")), openSec.season && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "作期の開始日"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: p.seasonStart,
    onChange: e => e.target.value && p.setSeasonStart(e.target.value),
    style: S.fieldInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "この日以降の散布実績だけを農薬の使用回数として数えます。作期が変わったらこの日付を更新すると、カウントが0からやり直しになります(過去の記録は消えません)。使用回数の上限は薬剤ごとにデータベースタブの🧪薬剤で登録できます。登録していない薬剤は既定の", CHEM_LIMIT_DEFAULT, "回で警告します。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("アプリの更新", openSec.update, () => toggleSec("update")), openSec.update && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.updateNow
  }, "この端末のバージョン ", /*#__PURE__*/React.createElement("strong", null, APP_VERSION)), /*#__PURE__*/React.createElement("button", {
    onClick: p.forceUpdate,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 12
    }
  }, "🔄 最新版に更新する"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "通常は自動で最新版に切り替わりますが、スマホでいつまでも画面が変わらないときはこのボタンを押してください。保存されているデータ(圃場・作業記録・設定・APIキー)は消えません。電波のある場所で実行してください。押すと画面が再読み込みされます。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("データ管理", openSec.data, () => toggleSec("data")), openSec.data && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: p.eraseAllData,
    style: {
      ...S.smallDanger,
      width: "100%",
      padding: "13px 0"
    }
  }, "🗑 この端末のデータをすべて消去"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "圃場・作業記録・APIキーなど、この端末に保存されているすべてのデータを削除します。端末を手放す・譲渡する前に実行してください。送信済みの記録はスプレッドシート側に残ります。この操作は取り消せません。誤タップ防止のため、確認ダイアログのあとに「消去」と入力する画面が出ます。"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("使い方ガイド", openSec.guide, () => toggleSec("guide")), openSec.guide && [{
    title: "🧮 調合タブ(起動画面)",
    desc: "アプリを開いたときの最初の画面です。希釈倍率と総量(または面積×10a散布量)から各薬剤の必要量・水量を自動計算します。薬剤欄の📋ボタン、または「📋 登録薬剤から追加」で、データベースタブに登録した薬剤を名前・種類・剤型・希釈倍率ごと呼び出せます(呼び出した後で倍率だけ変えることもできます)。このタブはタンク1杯分を計算するための電卓です。圃場への薬剤の適用は「作業・記録」タブの「この日に使用した薬剤」で行います。何度も使う組み合わせは「⭐プリセットに保存」で名前を付けて残すと、作業タブから読み込めます。農薬の使用回数が上限に近づくと、画面上部のタイトル直下に警告帯が常時表示されます。上限は薬剤ごとにデータベースタブの🧪薬剤で登録でき、未登録の薬剤は既定3回です。設定タブの「農薬の使用回数」で作期の開始日を設定すると、その日以降の実績だけを数えます(作期が変わったら日付を更新するとカウントがやり直しになります)。"
  }, {
    title: "🚁 作業・記録タブ",
    desc: "日付ごとに回る圃場をリスト化し、実績を入力・送信します。圃場の追加は「圃場を追加」の1か所にまとまっています。登録済みの圃場が一覧で出るので、タップした順に1つずつ追加できます(圃場が多いときは検索欄で絞り込めます)。上の地区のボタンで絞り込むと「＋ 「〇〇地区」の◯圃場をまとめて追加」が出て、その地区を一括で投入できます。予定薬液量は圃場マスタには保存されず、その日「本日の散布投下量(L/10a)」を入力して「面積から一括計算」を押したときだけ計算されます(投下量が未入力の圃場があると一覧上部に注意バナーが出ます)。計算式は圃場ごとに「面積÷10×投下量」で、調合タブの「面積から計算」とまったく同じ式・同じ端数処理(0.01L単位)です。投下量の欄の下に出る「対象◯圃場 ／ 合計◯a → ◯L」は、実際に書き換わる圃場だけを、書き換わる値そのもので合計した予告なので、押した結果と必ず一致します(実績を入力済みの圃場は上書きされません)。集計バーの「合計薬液量」は、実績を入力した圃場だけ実散布量に切り替わるため、まだ実績のない状態の予定合計とは差が出ます。実績が何圃場ぶん混ざっているかは「実績 ◯/◯圃場」で分かります。「この日に使用した薬剤」に、その日使う薬剤名と希釈倍率を入力して圃場に適用します。希釈倍率は散布水量(L/10a)によって変わるため、その日の値をここで入力する形にしています。薬剤名は登録済みマスタから「📋 登録薬剤から追加」で選べ、よく使う組み合わせは「⭐プリセット」「↩前回と同じ薬液」から読み込めます。薬量は各圃場の予定薬液量÷希釈倍率で自動計算されます。入力した薬剤はタブを移動しても保持され、日付を変えると空から始まります。圃場は右の⣿マークを長押ししてドラッグすると散布順を並べ替えられます(誤って動かないよう、左の番号部分では並べ替えできません。実施済みの圃場も並べ替え対象外です)。✎ボタンで圃場名・作物名・面積などをその場で編集できます(データベースのマスタにも反映されます)。「実績入力」ボタンを押すとその場にポップアップが開き、散布量・フライト数を空欄から記録します(入力するのは散布量だけです。散布面積は圃場に登録された面積が自動で記録されるので、面積を直したいときは✎から圃場の面積を編集してください)。実績を入力しても圃場は一覧に残ったまま実際の数値がその場に表示され、「✎ 実績を修正」を押すと入力済みの値が入った状態でポップアップが開き、いつでも直せます。圃場を外したいときは各行の「外す」のほか、「🗑 選択して削除」で複数の圃場を選んでまとめて外したり、「この日をすべて外す」で一括削除できます(どちらも確認画面が出ます。圃場マスタには残ります)。「☁ 全データを送信」で送信が完了すると色が変わり「✓送信済」と表示されます。各圃場には「累計」が出ます。その日に回る順で予定薬液量を足した値で、タンク容量(設定タブの「散布タンク」。既定200L)を超える手前には「⛽ ここで補給」の区切りが入り、その後は累計を数え直します。実績入力済みの圃場は累計に入れないので、これから回る分だけが分かります。並べ替えると累計も補給の位置も計算し直されます。各圃場の「🚗 ナビ」でその圃場までのナビをGoogleマップで開けます(地図タブで囲んで登録した圃場のみ。囲んでいない圃場はボタンが薄く表示されます)。上部の「順送りナビ」は、その日の圃場を並び順に1つずつ案内します。実績を入力すると自動で次の圃場に進み、「⏭ この圃場は飛ばす」で順番を飛ばせます(飛ばした記録は保存されず、日付を変えるとリセットされます)。下部の「記録」欄は一覧表示をせず、CSV出力・印刷のみに使います。"
  }, {
    title: "🗺 地図タブ",
    desc: "衛星写真上で圃場を囲んで登録できます。地図エンジンは設定タブで「無料地図(Leaflet)」と「Google マップ」を切り替えられます(既定は無料地図)。どちらで登録した圃場も共通のデータとして扱われ、エンジンを切り替えても圃場は消えません。「✏ 圃場を囲む」を押してから地図をタップすると頂点が打たれ、打った点はドラッグで位置調整できます。作図パネルの「頂点を追加」をOFFにすると、地図をタップしても頂点が増えません。形を整えている最中に地図を触って離れた場所に点ができるのを防げます(登録済みの圃場をタップして編集を始めたときは最初からOFFです)。頂点を消すときは「🗑 頂点を消す」をONにしてから頂点をタップします。ONの間は全部の頂点が✕になり、タップしたものがその場で消えます(ONの間は「頂点を追加」は自動でOFFになります)。頂点と頂点の間に出る小さな丸をドラッグすると、その辺の途中に頂点を足せるので、四角形以外の形も囲めます(触れただけでは増えません。形を確かめたいときに誤って頂点が増えないようにしてあります)。「↩ 1つ戻す」は追加・移動・削除・挿入を1手ずつ戻せます。3点以上打つと面積が自動計算されます。圃場名を入力して「この圃場を登録」で保存するとデータベースの圃場マスタにも自動登録されます。無料地図では国土地理院の衛星写真と国土地理院の標準地図(道路・地名)を、Googleマップでは衛星写真と道路・地名を同時表示(hybrid)と地図表示を切り替えられます。「📍 現在地」でGPS位置を地図に表示できます。「🔍 住所・地名を入力して地図を移動」に住所や地名を入れると、その場所へ地図がジャンプします(国土地理院の住所検索を使うためAPIキー不要で、無料地図・Googleマップの両方で使えます)。PC・タブレットでは地図がフルワイドで大きく表示されます。「🚗 ナビ」でGoogleマップアプリのナビが起動します。登録済みの圃場は赤い輪郭で表示されます。衛星写真は緑や茶が大半なので、赤が最も輪郭を追いやすいためです。中の作物の様子が見えるよう、塗りは薄く輪郭は濃くしてあります。拡大すると圃場名・作物名・面積の札が出ます。地図は画面の縦幅いっぱいに自動で広がるので、スクロールせずに全体を見られます。「⛶」を押すと見出しやタブバーも隠して完全な全画面になります。全画面で作図していないときは下の帯に「✏ 圃場を囲む」と「✕ 全画面」が出るので、全画面のまま次の圃場を囲めます(登録した圃場をタップすれば、全画面のまま形を直せます)。作図中は右上の「✕ 全画面をやめる」で戻ります。圃場の一覧は上の「📋 一覧」に切り替えると出ます。一覧は地区ごとに折りたためて検索もでき、見出しの「👁 表示中」を押すとその地区を地図から一時的に消せます(端末には保存されないので、アプリを開き直すと元に戻ります)。各行の👁でも1圃場ずつ切り替えられます。Googleマップを使うには設定タブでAPIキーの登録が必要です。"
  }, {
    title: "📋 データベースタブ",
    desc: "圃場マスタ(🌾)・薬剤プリセット(🧪)の2つのサブタブで管理します。圃場の新規登録・編集・削除はすべてここの🌾サブタブで行います(作業タブからの直接登録はできません)。圃場マスタには圃場名・作物名・面積・地区を登録します(予定薬液量はここには持たず、作業タブでその日の投下量から計算します)。「地区」は圃場をまとめるための任意の名前で、一覧の見出し・地図タブの折りたたみ・作業タブの一括追加のすべてに使われます。空欄のままなら「未分類」にまとまります。一覧の「編集」を押すとその場にポップアップが開くので、画面上部まで戻る必要はありません。ここで圃場名や面積を変更すると、作業タブに入っている同じ圃場の表示も同時に更新されます。登録した圃場は作業タブの「圃場を追加」から追加します。回る順番は、追加したあと作業リストで⣿マークをドラッグして並べ替えます(累計薬液量とタンク補給の位置もその並びで計算し直されます)。🧪薬剤サブタブは、薬剤名・種類・剤型を登録しておく単純な名前帳です(希釈倍率は散布水量で変わるため持ちません)。登録しておくと、作業タブの「📋 登録薬剤から追加」で名前・種類・剤型をまとめて呼び出せます。「総使用回数の上限」も登録でき、農薬使用回数の警告に使われます(未登録なら既定3回)。作業タブで使った薬剤も自動でここに貯まります。なお、複数の薬剤をまとめた「組み合わせ」は調合タブの「⭐プリセットに保存」で別に登録でき、作業タブの「薬剤を圃場に適用」で一発適用できます。"
  }, {
    title: "⚙ 設定タブ",
    desc: "面積(a/ha/反/町)と薬量(L/mL/kg/g)の表示単位を切り替えられます。データは常にa・Lで保存され、表示だけ変換されます。作物マスタの管理もここで行います。「散布タンク」では散布車の水タンクの容量を設定でき、作業タブの補給の目印に使われます。送信先URL(GASのウェブアプリURL)は一度設定すれば保存されます。GASを再デプロイするときは「デプロイを管理→編集→新しいバージョン」を使うとURLが変わりません。チームコードを使って複数端末間でデータを共有できます。このガイドとバージョン履歴もここで確認できます。"
  }, {
    title: "📡 送信とバックアップ",
    desc: "作業タブの「☁ 全データを送信」でGoogleスプレッドシートに記録が送られます。圏外でも記録は端末に保存され、電波が戻ると自動で再送されます。送信中に「中止」を押すと途中で止められ、どの圃場から再開するか選べます。設定タブの「☁↑ 端末→共有へ保存」「☁↓ 共有→端末へ読込」でチームコードを使った複数端末間のデータ共有ができます。"
  }].map((item, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      marginBottom: 14,
      borderLeft: "3px solid #2E7D4F",
      paddingLeft: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 800,
      color: "#1C2B21",
      marginBottom: 4
    }
  }, item.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "#4a5a50",
      lineHeight: 1.7
    }
  }, item.desc)))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, collapsibleHead("バージョン履歴", openSec.history, () => toggleSec("history")), openSec.history && [{
    ver: "v8.63",
    date: "2026-08",
    isNew: true,
    notes: ["🐞 更新のたびに本日の作業圃場が一覧から消える不具合を修正しました。スプレッドシートは「2026-08-26」のような文字列をセルに入れた時点で日付として解釈するため、受け取ると「Wed Aug 26 2026…」の形になり、「その日の作業」と一致しなくなっていました(v8.58で作業を受け取るようにしたときから)。進捗地図の日付の絞り込みも同じ理由で外れていました。※スプレッドシート側の Code.gs を差し替えて再デプロイしてください", "🔧 既に日付が化けた状態で端末に残っている作業も、起動時に1度だけ直します"]
  }, {
    ver: "v8.62",
    date: "2026-08",
    notes: ["🔢 圃場一覧の地区の見出しに「🔢 連番」を追加しました。その地区の圃場名を「嘉島1」「嘉島2」…のように連番で付け直せます。丸数字(①)も普通の数字として読むので、①と 52 が混ざっていても番号順に並べ直してから振ります。名前の頭と開始番号を変えられ、実行前に「前 → 後」の一覧が出ます。付け直すのは名前だけで、囲んだ形・面積・作物・作業の記録はそのままです(戻せないので確認画面を出しています)", "📋 連番を振ったあとは、一覧の並びもその番号順になります", "🚦 進捗地図の「対象外」を黄色にしました。灰色だと衛星写真の上で地面と見分けにくいためです(実施済=緑 / 未実施=赤 / 対象外=黄)", "🗺 Googleマップで「地図を移動させるには指 2 本で操作します」が出ないようにしました。指 1 本でそのまま地図を動かせます(全画面でも同じ)", "🚦 進捗地図が、地図タブを一度開くまで白いままになることがある件に手を入れました。地図を作ったあとで入れ物の幅が決まると、0px のまま描かれません。大きさが変わるたびに測り直すようにしました(未再現のため、これで直るかは未確認)", "☁ 入力している間は自動取得を待たせるようにしました。投下量や薬剤を入れている途中に受信が割り込むと、一覧の並びや中身が目の前で入れ替わるためです。入力欄にカーソルがある間と、ポップアップを開いている間は見送り、次の拍子で取りに行きます", "☁ 圃場を登録・編集して送った直後に、その場で取り直すようにしました。次の拍子を待たずに揃います"]
  }, {
    ver: "v8.61",
    date: "2026-08",
    notes: ["🗺 圃場の手入力登録をやめました。登録は地図で囲む1本になります。手入力だと位置のない圃場が増え、進捗地図にもナビにも使えないためです。登録済みの圃場の編集(名前・作物・面積・地区)と削除は、これまでどおり「📋 圃場一覧」の各行からできます"]
  }, {
    ver: "v8.60",
    date: "2026-08",
    notes: ["🚦 進捗地図の札にも面積を出しました。地図タブと同じく、圃場名の下に面積を別の行で出します", "⚙ 自動取得の間隔の説明を直しました。「Apps Script には1日あたりの実行時間の上限がある」と書いていましたが、これは不正確でした。公式の上限は「1回の実行は最長6分」「同時実行は1ユーザー30まで」で、「90分/日・6時間/日」はトリガーの合計実行時間のことで、このアプリが使うウェブアプリの呼び出しには当たりません(2026-08確認)"]
  }, {
    ver: "v8.59",
    date: "2026-08",
    notes: ["🧮 タブの名前を1行に戻しました(「薬剤登録・希釈計算」の形)。2行に分けていたのをやめ、画面の幅に合わせて字の大きさを縮める形にしています(375pxの端末で 1タブ 95px に対して文字 72px。横スクロールなしを実測)"]
  }, {
    ver: "v8.58",
    date: "2026-08",
    notes: ["🚁 その日の作業予定が他の端末でも見られるようになりました。作業リストに圃場を入れた・薬剤を当てた・外した時点で自動的に送られ、受け取る側は作業タブを開いたとき・作業日を切り替えたときに取りに行きます(60秒に1回まで)。v8.57までは送るだけで、サーバーにも進捗地図用の要約しか置いていなかったため、受け取っても予定を組み直せませんでした。※スプレッドシート側の Code.gs を差し替えて再デプロイしてください(「作業」シートに列が7つ増えます)", "👥 他の端末から受け取った作業には記録者名が付き、実施済のものは「✓実施済(他端末)」と出ます。「防除記録」への台帳の送信は、その作業をした端末の役目にしてあります(受け取っただけの端末でも未送信扱いにすると、全員の画面に同じ件数が出て誰が送るべきか分からなくなるため)。こちらで「散布済」を押し直せば、この端末からも台帳に残ります", "🧮 タブの名前を中身が分かる名前にしました。🧮薬剤登録/希釈計算、🚁作業予定/進捗確認、🗺圃場登録/圃場一覧、⚙設定", "📶 見出しの下に「● オンライン / ○ オフライン」と「👥 チーム名」を出しました。チームの表示を押すと設定タブへ飛びます。未設定なら「👥 チーム未設定」と出ます(オンラインの表示は「網に繋がっているか」であって、送信先に届くかまでは分かりません。そちらは設定タブの接続テストで確かめてください)", "🗑 頂点の削除を「🗑 頂点を消す」をONにしている間だけにしました。これまでは頂点をタップすると1回目で✕に変わり、2回目で削除されていたため、形を直しているだけでも✕になって邪魔でした。ONの間は全部の頂点が✕になり、押したものがその場で消えます。ONの間は「頂点を追加」は自動でOFFになり、OFFに戻すと前の状態に戻ります。「↩ 1つ戻す」はこれまでどおりです。全画面の帯では 🗑 がこのモードで、全消しは 🧹 になりました", "📐 全画面でも、頂点をドラッグしている間に面積が動くようになりました。これまでは指を離すまで変わらなかったため、どこまで引けば何aになるかが見えませんでした", "🗺 全画面のまま次の圃場を囲めるようになりました。作図をやめると下に「✏ 圃場を囲む」「✕ 全画面」の帯が出ます。これまでは一度全画面を抜けて「✏ 圃場を囲む」を押し直す必要がありました", "⚠ 並び順だけを入れ替えたときは、中身が変わらないため送信の対象になりません。相手側の並びは前回送った時点のままになります(未解決)"]
  }, {
    ver: "v8.57",
    date: "2026-08",
    notes: ["📋 データベースタブをなくし、タブを5つから4つにしました。圃場の登録・編集は地図タブの「📋 圃場一覧」へ、薬剤とプリセットは調合タブの「🧪 薬剤・プリセット」へ移しています。地図で見ている圃場を直すのに別のタブへ移る必要がありません", "🗺 地図タブの一覧に、地図で囲んでいない圃場も出るようになりました(「・位置未登録」と表示)。囲んだ圃場だけを一覧にしていた頃は、位置のない圃場を直す場所が地図側にありませんでした。行の 📍 で地図のその圃場へ、👁 で地図の表示を切り替えられます", "☁ 薬剤も圃場と同じやり方で共有されるようになりました。登録・編集・削除した時点で自動的に送られ、変わったものだけをやりとりします。これまでは「☁↑ 端末→共有へ保存」で丸ごと上書きするしかなく、他の端末が登録した薬剤が消えるおそれがありました。※スプレッドシート側の Code.gs を新しいものに差し替えて再デプロイしてください(「薬剤マスタ」シートが自動で作られます)", "⚙ 設定タブの「送信・共有」を4つの段に分けました。①つなぎ先 ②データ共有(圃場・薬剤) ③作業データの送信 ④古い方式。ボタンが6つ並んでどれを押せばよいか分からなかったのを改めています。丸ごと上書きする古いボタンは④の中に畳んであります", "⚙ 接続テストが古い版と判定する目安を pushChems に更新しました。進捗地図は動くのに薬剤だけ共有されない状態を見分けられます"]
  }, {
    ver: "v8.56",
    date: "2026-08",
    notes: ["🚁 画面下に固定されていた「▶ 次の圃場／🚁 実績入力」の帯を外しました。同じことが上の「順送りナビ」と各行の「🚁 実績入力」でできるのに、常に画面の下を塞いで地図と一覧を狭めていました", "🚦 進捗地図の色を3つに絞りました。緑=実施済、赤=未実施、灰=その日の作業に入っていない圃場(対象外)。調合済(黄)と未送信(橙)は色をやめ、調合済は赤(未実施)に、未送信は緑(実施済)にまとめています。未送信の件数は地図の上に文字で出ます", "🐞 その日の作業に入れた圃場が対象外(灰)のままになることがある不具合を修正しました。圃場IDを数値と文字列のまま突き合わせていたため、過去の版で作られたデータが混ざると一致せず、作業に入っているのに灰色で描かれていました", "🐞 進捗地図が県全体まで引いて表示され、今日の圃場が点にしか見えないことがある問題を直しました。登録済みの全圃場が入るように寄せていたので、遠くに1枚でも圃場があると引いてしまっていました。今日の作業に入っている圃場だけが入るように寄せます。地図の高さが決まる前に寄せて倍率がでたらめになる状態も直しています", "🚦 「⊙ 今日の圃場へ」を追加しました。地図を動かして見失っても、その日の圃場が入る位置へ戻せます", "🚦 その日の作業に入っているのに地図で囲まれていない圃場があると「地図に出せない圃場 n件(位置未登録)」と出ます。地図に出ない理由が分からないままになるのを防ぐためです。地図タブで囲むと出るようになります", "🗺 進捗地図をGoogleマップでも出せるようにしました。設定タブの地図エンジンの選択が、地図タブだけでなく進捗地図にも効きます(※Googleマップは地図を作るたびに課金対象になり、進捗地図は地図タブとは別の地図なので、開くとそのぶん回数が増えます)", "🚦 作業タブの見た目を整理しました。同じ「実績 n/m」が3か所に出ていたのを進捗バー1か所にまとめ、進捗地図のときは一覧向けの部品(順送りナビ・本日の薬剤・投下量の警告)を出さないようにしました。集計も大きなタイル3枚から1行に畳みます。地図の操作は地図のすぐ上に1行、凡例と取得時刻は地図の下に移しました(地図の上端 実測 526px → 462px)"]
  }, {
    ver: "v8.55",
    date: "2026-08",
    notes: ["🚦 進捗タブをなくし、作業タブに入れました。作業日の下の「📋 作業一覧／🚦 進捗地図」で切り替えます。作業日・圃場数・合計面積・合計薬液量はどちらでも共通で出ます。選んだ表示は端末に残ります", "🚦 地図の色を2色に整理しました。赤=未実施、緑=実施済、灰=その日の作業に入っていない圃場(対象外)です。これまでの黄(調合済)・橙(未送信)は、遠目に赤とも緑とも読めなかったため色をやめ、記号(・=調合済、△=未送信)だけで示すようにしています", "🚦 進捗地図を開いている間は45秒ごとに自動で取り直します。他の端末で「散布済」にチェックが入ると、押した端末からはその場で送られるので、こちらは待っていれば色が変わります。閉じている間・画面が裏に回っている間は取りに行きません", "⚙ 進捗が取れないときのエラーで「invalid payload」と出ていた場合に、スプレッドシート側のCode.gsが古いことが分かる案内を出すようにしました", "⚙ 設定タブの「接続テスト」で、動いているスクリプトが古い版かどうかを見分けるようにしました。Code.gsを貼り替えただけではウェブアプリは古い版を返し続けるため、「つながっているのに進捗が取れない」の原因がこれで分かります", "☁ 圃場が自動で共有されるようになりました。地図で囲んで登録したとき・圃場を直したとき・消したときに、その場で送ります(1.5秒ほどまとめてから送るので、続けて何枚登録しても送信は1回です)。受け取る側は、アプリを開いたときと地図タブを開いたときに自動で取りに行きます(60秒に1回まで)。v8.54までは設定タブの「🔁 圃場を同期」を両方の端末で押さないと渡らず、押し忘れると『作図したのに他の端末に出ない』が起きていました", "☁ 圏外のときは未送信のまま残ります。電波が戻ってから設定タブの「🔁 圃場を同期」を押せば送り直せます(このボタンはこれまでどおり使えます)", "🗺 全画面で圃場を登録したあと、そのまま次の圃場を囲める状態に戻るようにしました。全画面を抜けて「✏ 圃場を囲む」を押し直す必要はありません。1行バーが「0点」に戻ったら次を囲めます。やめるときは「✕」を押してください(登録済みの圃場を編集していたときは、これまでどおり1枚で終わります)"]
  }, {
    ver: "v8.54",
    date: "2026-08",
    notes: ["🗺 全画面で圃場を囲むときの操作欄を、画面下の1行に畳みました。これまでは説明文・入力欄・登録ボタンで画面の半分近くを占めて地図が見えませんでした(実測 555px → 61px)", "🗺 圃場名・作物名・地区の入力は「✓ 登録」を押したときにポップアップで出るようになりました。地図を見ている間は出ません", "🗺 全画面の1行バーからも「🔀 並び順」(線の交差を直す)・「↩」(1つ戻す)・「🗑」(全消し)・「✕」(作図をやめる)が使えます"]
  }, {
    ver: "v8.53",
    date: "2026-08",
    notes: ["🚁 作業タブの各圃場に「散布済」チェックを追加しました。チェックを入れると進捗マップの色が変わり、外すと元に戻ります。散布量を入れなくても「終わった」ことだけ先に記録できます", "🚁 チェックを外すと実績も取り消されます。スプレッドシートの「防除記録」も状態が『調合済』に戻り、実散布量と報告日が消えます(行は消しません。調合した事実は残ります)", "🚁 「今日の準備」に「✓ 投下量から実績を一括入力」を追加しました。散布済にした圃場のうち、実散布量がまだ空のものだけに『面積÷10×投下量』を入れます。手で入れた値は上書きしません", "🚦 進捗マップの期間切替(当日/7日間/シーズン)をやめ、作業タブで選んでいる日の作業だけを見る形にしました", "🐞 チェックを続けて操作したとき、片方しか反映されない・外したはずの実績がサーバー側に残り続ける不具合を修正しました。画面の再描画を待たずに操作すると古いデータを元に保存され、更新時刻が過去へ戻って『送信済みなのに中身が違う』状態で固まっていました"]
  }, {
    ver: "v8.52",
    date: "2026-08",
    notes: ["🗺 線が交差したときに「🔀 並び順を直す」ボタンが出るようになりました。頂点の座標は1つも動かさず、外周をたどる順に並べ替えるだけです。押したあと「↩ 1つ戻す」で元に戻せます。※大きくへこんだ形の圃場では意図した形と変わることがあるので、結果を見てから登録してください", "🗺 全画面のまま圃場を囲めるようになりました。これまでは作図を始めると全画面が解除されていました。全画面のときは操作パネルが下から重なり、「この圃場を登録」は常に画面の下端に出ます", "🚦 進捗マップに「◉ 対象だけ／○ 全圃場」の切り替えを追加しました。その期間に作業がある圃場だけを出せます(既定は全圃場)", "🐞 作業をその日のリストから外したとき、他の端末の進捗マップでその圃場が実績済のまま残る不具合を修正しました。外した時点で送るようにしています"]
  }, {
    ver: "v8.51",
    date: "2026-08",
    notes: ["🚦 進捗マップを追加しました。実績を入力した圃場が緑に変わり、チームの誰がどこまで終えたかを1枚の地図で見られます。位置を作図する地図タブとは別のタブなので、散布中に触っても圃場の形が変わることはありません。更新は「🔄 最新を取得」を押したときだけです", "🚦 実績を保存すると、進捗ぶんが自動でスプレッドシートへ送られます。圏外だったときは未送信のまま残り、設定タブの「🚦 進捗を送信」で送り直せます。地図では未送信の実績を橙で表示します", "☁ 設定タブに「🔁 圃場を同期」を追加しました。変わった圃場だけを送って受け取るので、他の人が足した圃場や実績を消しません。従来の「☁↑ 端末→共有へ保存」は全部を置き換える方式で、同時に作業していると消える事故と、圃場が増えると保存できなくなる上限がありました。今後はこちらをお使いください", "⚙ スプレッドシート側に「圃場マスタ」「作業」シートが自動で追加されます。既存の「防除記録」シートはそのまま残り、内容も変わりません。Code.gsを最新に差し替えて「新バージョン」でデプロイし直してください"]
  }, {
    ver: "v8.50",
    date: "2026-08",
    notes: ["🐞 v8.49の容量削減で面積がわずかにずれてしまう問題を修正しました。位置情報を丸める桁数が粗く、実測で4枚に1枚以上の圃場で表示面積が0.01a単位で変わっていました。桁数を上げ(最大ずれ 0.0147a→0.0002a)、面積は丸める前の座標から計算するようにしたので、作図中に見えていた面積がそのまま保存されます", "🗺 地図の面積表示が、圃場に登録された面積を出すようになりました。これまでは地図だけ囲んだ形から計算し直した数字を出していたため、データベースで面積を手直しすると地図と食い違っていました。散布量の計算に使われるのは登録面積なので、そちらに揃えています", "🗺 地図の面積が表示単位(a/ha/反/町)に従うようになりました。これまで地図だけアール固定で、反や町に設定していても変わりませんでした", "🗺 登録面積と囲んだ形の面積が1%以上ずれている圃場は、一覧に「(囲んだ形は ◯◯)」と併記して、食い違いが隠れないようにしました", "🗺 地図で圃場をタップして形を変えずに保存したとき、手入力した面積が計算値で上書きされないようにしました"]
  }, {
    ver: "v8.49",
    date: "2026-08",
    isNew: false,
    notes: ["🐞 チーム共有の「端末→共有へ保存」が「データが大きすぎます」で保存できなくなる不具合を修正しました。圃場の位置情報が必要以上に細かい桁数(小数17桁)で保存されており、圃場を増やすほど容量を食っていました", "小数第7位(約1.1cm)までに丸めるようにしました。GPSの誤差は数mあるため実用上の精度は変わりません。面積の表示(0.01a単位)も変わりません", "共有データの容量が約34%減り、保存できる圃場数の目安が約26圃場から約40圃場に増えます(1圃場40頂点の場合)", "「データが大きすぎます」と出たときの案内を直しました。これはGASの版とは関係がないのに「GASを最新版に更新してください」と表示しており、何度GASを貼り直しても直らない案内になっていました。今は実際の文字数と上限を表示します"]
  }, {
    ver: "v8.48",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 「頂点を追加」のON/OFFボタンを付けました。OFFにすると地図をタップしても頂点が増えないので、形を整えている最中に離れた場所へ点ができて消す、という手間がなくなります", "🗺 登録済みの圃場をタップして編集を始めたときは、最初からOFFで開きます(形を直しに来た場面なので)。新しく囲むときはONで始まります", "🗺 頂点の丸をさらに小さくしました(頂点20px→16px、辺の中点12px→9px)"]
  }, {
    ver: "v8.47",
    date: "2026-08",
    isNew: false,
    notes: ["🔄 更新の取りこぼしを減らしました。アイコンなど「無くても動くファイル」の取得に失敗しただけで更新全体が止まり、何度開き直しても古いままになることがありました", "🔄 本体ファイルの取得に失敗したときは1回だけ取り直すようにしました。電波の弱い圃場での更新が通りやすくなります", "※GitHubへの反映には数分かかります。更新した直後に開くとまだ古い版が出ることがあるので、少し待ってから開き直してください。それでも変わらないときは設定タブの「アプリの更新」→「🔄 最新版に更新する」を押してください"]
  }, {
    ver: "v8.46",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 圃場を囲むときの頂点の丸を小さくしました。以前は隣同士が重なって細かい位置合わせがしづらい大きさでした", "🗺 辺の中点の丸は、ドラッグしたときだけ頂点が増えるようにしました。これまでは触れただけ・指が乗っただけで頂点が増えてしまい、そのたびに消す手間がかかっていました", "🗺 登録済みの圃場の色を蛍光イエローから赤に変えました。衛星写真は緑や茶が大半なので、赤のほうが輪郭を追いやすいためです", "🗺 圃場の塗りをさらに薄く、輪郭をより濃くしました。中の作物の様子を見ながら形を確かめられます"]
  }, {
    ver: "v8.45",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 地図タブで、既に囲んで登録済みの圃場をタップすると、その場で頂点を動かして編集し直せるようになりました。これまでは登録後に形や位置を直す手段がありませんでした。名前・作物・地区も一緒に読み込まれ、「この圃場を保存」で同じ圃場として上書き保存されます(新規の圃場として重複登録されることはありません)"]
  }, {
    ver: "v8.44",
    date: "2026-08",
    isNew: false,
    notes: ["🧪 農薬データを、アプリに同梱する形から「設定タブから取り込む」方式に変更しました。設定タブの「農薬データ」→「⬇ 農薬データを取り込む」で、あなたのGoogleドライブに置いたデータをこの端末に取り込みます。一度取り込めば、これまでどおり圏外でも登録番号・農薬名・成分名で検索できます", "取り込んだデータは端末内(IndexedDB)に保存されます。記録や圃場の保存領域とは別なので、これまでの保存データを圧迫しません", "取り込みには送信先URLと共有パスワードの設定が必要です。まだ取り込んでいない状態で農薬検索を開くと、その旨の案内が出ます", "データの準備・設置手順は、同梱の README とCode.gsの冒頭コメントに書いてあります"]
  }, {
    ver: "v8.43",
    date: "2026-08",
    isNew: false,
    notes: ["📐 圃場を囲むとき、頂点を動かしている間も面積の数字がその場で変わるようになりました。指を離すまで待たなくてよいので、実際の面積に合わせて形を調整しやすくなります", "辺の中点の丸を引っぱって頂点を足すときも同じように追従します。線が交差した瞬間の警告表示も、指を離す前に出るようになりました"]
  }, {
    ver: "v8.42",
    date: "2026-08",
    isNew: false,
    notes: ["🔐 設定タブに「共有パスワード」を追加しました。GAS側に同じ文字列を設定しておくと、その文字列を入れた端末からしか記録を書き込めなくなります(未設定のままでも今までどおり使えます)", "接続テストで共有パスワードが未設定のときは「URLを知る人は誰でも書き込めます」と表示するようにしました", "送信先URLがApps ScriptのURLの形になっていないときに警告を出すようにしました。打ち間違いで別のサーバーへ記録を送ってしまうのを防ぎます(保存自体は止めません)", "🔐 設定タブの共有欄に、実際に送信される項目(圃場名・作物・面積・圃場の位置情報・地区・薬剤・作業記録・記録者名)と、送信先があなたのGoogleスプレッドシートだけであることを明記しました", "📄 CSV書き出しで、圃場名や備考が「=」などで始まっていてもExcelが計算式として扱わないようにしました", "🗺 無料地図の「道路・地名」を国土地理院の標準地図に変更しました。これまで使っていたOpenStreetMapの配信サーバーは、こうしたアプリからの継続利用が認められていないためです。見た目と使い方は変わりません", "📚 農薬検索の画面に、データの出典(FAMIC 農薬登録情報)と「登録情報は変わるので使用前にラベルを確認してください」の注意を常時表示するようにしました", "📋 アグリノート転記の画面に、アグリノートがウォーターセル株式会社の商標である旨を明記しました"]
  }, {
    ver: "v8.41",
    date: "2026-08",
    isNew: false,
    notes: ["🔒 設定タブの Google Maps APIキーを伏せ字で表示するようにしました。肩越しに見られたり、画面を撮った写真からキーが漏れるのを防ぎます", "👁 目のボタンを押すと一時的に表示できます(打ち間違いの確認用)。設定タブを離れるとまた伏せ字に戻ります"]
  }, {
    ver: "v8.40",
    date: "2026-08",
    isNew: false,
    notes: ["🐞 Googleマップの読み込みに1回失敗すると、アプリを開き直すか設定で地図を切り替え直すまで復帰できなかった不具合を修正しました", "🔄 読み込みに失敗したときに「再読み込み」ボタンを出すようにしました", "📶 電波が戻ったときと、地図タブに戻ってきたときに自動で読み込みをやり直します", "Googleの地図は開くたびに通信が必要なことを、エラー画面で説明するようにしました(電波のない場所では無料地図をお使いください)"]
  }, {
    ver: "v8.39",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 一度開いた地図を、他のタブへ移っても残しておくようにしました。タブを行き来しても地図が作り直されないので、戻ったときの表示が速くなり、見ていた場所・拡大率もそのまま保たれます", "💰 Googleマップを使う場合、地図を作るたびに課金対象(Map load)になります。この変更で、アプリを開いている間は原則1回だけになります", "地図タブを一度も開かなければ地図は読み込まれません", "地区の非表示はタブを離れても保たれるようになりました(アプリを開き直すと元に戻ります)"]
  }, {
    ver: "v8.38",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 住所検索で移動したとき、どこに移動したのかを画面に出すようにしました。住所検索はあいまい一致なので、打った文字と違う場所に飛んでも気づけないおそれがあったためです", "🐞 共有データから読み込んだ記録に水量が入っていないとき、記録欄に「水 NaN L」と出ていた不具合を修正(「—」表示になります)", "🧪 計算部分の自己テスト(86項目)を tools/selftest.cjs に追加しました。面積・薬液量・タンク補給・転記のまとめ方などを、配布する app.js そのままに対して検証できます"]
  }, {
    ver: "v8.37",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 地図タブに住所・地名で検索して移動できる欄を追加しました。国土地理院の住所検索を使うのでAPIキー不要で、無料地図・Googleマップのどちらでも使えます"]
  }, {
    ver: "v8.36",
    date: "2026-08",
    isNew: false,
    notes: ["🐞 「面積から一括計算」の予告で、面積が未入力の圃場まで「実績入力済み」として数えていた表示を修正。実績入力済みと面積未入力を分けて出すようになり、ボタンを押した後のメッセージと理由が一致します", "🧹 使われていないコードを整理しました(呼び出されていない薬剤適用の処理2つ、渡されるだけで使われていなかった項目9か所、廃止したコースの見た目の設定、使われていない地図ラベルのCSS)", "🗺 地図の高さを画面に合わせる処理がGoogle版・無料地図版で二重に書かれていたので1つにまとめました。動きは変わりません"]
  }, {
    ver: "v8.35",
    date: "2026-08",
    notes: ["🗺 地図の圃場を1色(蛍光イエロー)に戻しました。登録済みの圃場が地図で分かれば十分なので、作業状況による3色の塗り分けと凡例をやめています", "🗺 地図タブの一覧からも、色見本と「未予定/予定あり/散布済み」の表示を外しました。圃場名と面積だけの見やすい一覧になります", "地区ごとの折りたたみ・検索・表示/非表示の切り替えはそのままです"]
  }, {
    ver: "v8.34",
    date: "2026-08",
    notes: ["📋 「プリセット」タブの名前を「データベース」に変えました", "🧮 面積から薬液量を出す計算を1か所にまとめ、調合タブと作業タブで式も端数処理(0.01L単位)も同じになるようにしました", "🐞 「面積から一括計算」の下に出る予告が、押した結果と食い違っていた不具合を修正。実績入力済みの圃場は上書きされないのに、その圃場の面積まで含めて概算していました(実測では予告339.9Lに対し実際は288.09L)。修正後は対象の圃場だけを実際の値で合計するので、予告と結果が必ず一致します", "🧮 集計バーの「合計薬液量」に「実績 ◯/◯圃場」を添えました。実績を入力した圃場は実散布量で数えるため、予定だけの合計とは差が出ます。その差がどこから来ているのかが分かるようにしています"]
  }, {
    ver: "v8.33",
    date: "2026-08",
    notes: ["🗺 地図の圃場の色を蛍光色にしました。未予定はグレーだと衛星写真に埋もれて見えなかったため蛍光イエローに、予定ありは蛍光シアン、散布済みは蛍光グリーンにし、輪郭線も太くしています", "🗺 未予定だけ塗りを薄くしてあります。大半の圃場が未予定になる日が多いため、同じ濃さだと予定あり・散布済みが埋もれてしまうためです", "🗺 圃場名・作物名・面積の札が出はじめる倍率を1段下げました。これまでは初期表示から1段でも縮小すると札が消えていました", "🐞 圃場名の札の見た目の指定が地図ライブラリ側の指定に負けていて、まったく効いていなかった不具合を修正。白い枠付きの札から、黒地に白文字の読みやすい札になります"]
  }, {
    ver: "v8.32",
    date: "2026-08",
    notes: ["🗺 地図が画面の縦幅いっぱいに自動で広がるようになりました。これまでは画面をスクロールしないと地図の下側が見えない状態でした。端末の回転やアドレスバーの出入りにも追従します", "🗺 「⛶」ボタンを追加。見出しもタブバーも隠して地図だけの全画面にできます(「✕ 全画面をやめる」で戻ります)", "🗺 地図を見ているときは下の圃場一覧を出さないようにしました。一覧は「📋 一覧」に切り替えたときだけ出ます", "🗺 「地図／一覧」の切替を見出しの位置に移し、地図に使える高さを広げました"]
  }, {
    ver: "v8.31",
    date: "2026-08",
    notes: ["🌾 圃場に「地区」を登録できるようにしました。プリセットの圃場一覧・地図タブの一覧が地区ごとの見出しでまとまり、圃場が増えても探しやすくなります", "🚁 作業タブの「圃場を追加」に地区のボタンを追加。地区で絞り込んで「まとめて追加」を押すと、その地区の圃場を一度にこの日のリストへ入れられます", "🗺 地図の圃場を作業日の状況で塗り分けるようにしました(グレー=未予定、青=予定あり、緑=散布済み)。地図の下に凡例が出ます", "🗺 地図タブの一覧を地区ごとに折りたためるようにし、検索欄を追加。地区ごと・圃場ごとに地図の表示/非表示も切り替えられます", "🗺 「📋 一覧」ボタンで地図を隠し、一覧を画面いっぱいに表示できるようにしました", "🚜 圃場コースを廃止しました。役割は「地区でまとめる」と「作業リストの並べ替え」に引き継がれています。登録済みのコース名は圃場の地区として自動で引き継がれ、元のコースのデータも端末に残してあります", "🐞 コース保存時にIDが重複しうる不具合がありましたが、コースの廃止にともない解消しました"]
  }, {
    ver: "v8.30",
    date: "2026-08",
    notes: ["🗺 圃場を囲むときに線が交差していると警告を出し、そのままでは登録できないようにしました。ねじれた形は面積が実際よりはるかに小さく計算され(交点が真ん中なら0a)、その面積が予定薬液量やAgriNoteの転記にそのまま流れていました", "🧮 作業タブの集計バーの「合計薬量」を「合計薬液量」に改名し、集計もAgriNote転記と同じ基準(実績があれば実散布量)に揃えました。これまでは実績を入力した後も予定量で足していたため、転記画面の数字と合いませんでした", "📋 AgriNoteのまとめ方に剤型を加えました。同じ薬剤名・同じ倍率でも水和剤(kg)と乳剤(mL)は単位が違うため、1つにまとめると先に出た方の単位に引きずられていました", "🧪 薬剤マスタの名前の照合を、農薬使用回数と同じ全角・半角の統一ルールに揃えました。半角カナで登録すると同じ薬剤が二重に登録される・剤型が引き継がれない・検索で見つからない、が直ります", "📤 CSV出力で、圃場名や備考にカンマ・改行が入っていると列がずれる不具合を修正", "🐞 まとめ散布で記録したとき、個別に入力していた古いフライト内訳が残って実散布量と食い違う不具合を修正", "☁ 共有データの読み込みで、壊れた形のデータを取り込んでアプリが動かなくなることがないようにしました"]
  }, {
    ver: "v8.29",
    date: "2026-08",
    notes: ["🐞 まとめ散布(連続散布)の面積比按分で、圃場と散布量の組み合わせが入れ替わる不具合を修正。一覧の並びと違う順に圃場をタップして選ぶと、確認画面に出た数字と保存される数字が食い違っていました", "🐞 農薬の使用回数で、半角カナと全角カナの薬剤名が別の薬剤として数えられ、上限の警告が出ないことがある不具合を修正", "🐞 圃場名を変更すると、その圃場の農薬使用回数が変更前と変更後に分かれて数えられる不具合を修正(圃場の登録そのもので数えるようにしました)", "🐞 農薬使用回数の作期の判定を、実績を入力した日ではなく散布した日で行うように修正。後日まとめて実績を入力したとき、前作期の記録が今作期に混ざっていました"]
  }, {
    ver: "v8.28",
    date: "2026-08",
    isNew: false,
    notes: ["🗺 地図の「圃場を囲む」を作り直しました。頂点をつかんでも動かせない不具合を修正しています", "🐞 頂点をドラッグしても動かなかった原因を修正。ドラッグ中に頂点そのものが作り直されていたため、つかんだ手から外れていました", "✕ 頂点を1つずつ消せるように。頂点をタップすると「✕」に変わり、もう一度タップで削除します(1回の誤タップでは消えません)。作図パネルからも消せます", "➕ 辺の途中に頂点を足せるように。頂点と頂点の間に出る小さな丸をタップ、またはドラッグすると、その位置に頂点が入ります。四角形以外の複雑な形も囲めます", "↩ 「1つ戻す」が、追加だけでなく移動・削除・挿入も1手ずつ戻せるようになりました(最大50手)", "🐞 スマホでドラッグが途中で中断されたとき(画面のスクロールにブラウザが割り込んだ場合など)、作図中の地図が固まって以後何も反映されなくなる不具合を修正"]
  }, {
    ver: "v8.27",
    date: "2026-08",
    isNew: false,
    notes: ["⛽ 作業タブの各圃場に「累計」を表示。その日に回る順で予定薬液量を上から足していくので、どの圃場まででどれだけ使うのかが一目で分かります", "⛽ タンク容量を超える手前に「⛽ ここで補給(タンク1杯目 180L / 200L)」の区切りを表示。補給の後は累計を数え直し、2杯目・3杯目として続けます", "圃場を並べ替えると累計と補給の位置がその場で計算し直されます", "実績入力済みの圃場は散布も補給も済んでいる前提で累計に入れません(これから回る分だけが分かります)", "⚙ 設定タブに「散布タンク」を新設。タンク容量を変更できます(既定200L)。空欄や0にすると補給の目印は出ず、累計だけを表示します", "1つの圃場だけでタンク容量を超える場合は「⚠ この圃場だけでタンク容量を超えます」と表示します"]
  }, {
    ver: "v8.26",
    date: "2026-08",
    isNew: false,
    notes: ["🚗 作業タブの各圃場に「🚗 ナビ」を追加。その圃場までのナビをGoogleマップで開けます(地図タブで囲んで登録した圃場の位置を使います)", "🚗 その日の圃場を散布する順に1つずつ回る「順送りナビ」を追加。作業タブの上部に「次の圃場」が出るので、ナビを開いて向かい、実績を入力すると自動で次の圃場に進みます", "「⏭ この圃場は飛ばす」で順番を飛ばせます(飛ばした記録はその日の画面内だけのもので、保存されません。「↩ 飛ばした圃場を戻す」で元に戻せます)", "回る順は作業タブの並び順そのままです。⣿マークのドラッグで並べ替えると、ナビの順番もそのとおりになります", "まだ地図で囲んでいない圃場のナビボタンは薄く表示され、押すと登録方法を案内します"]
  }, {
    ver: "v8.25",
    date: "2026-08",
    isNew: false,
    notes: ["🐞 データベースタブの「登録番号・名称で検索して登録」で、検索し直しても前の検索結果の行が残り、無関係な薬剤が混ざって表示される不具合を修正", "🐞 同じ農薬が2回以上表示される不具合を修正。農薬データは有効成分ごとに行が分かれているため(例: ベジセイバーはペンチオピラドとTPNの2行)、登録番号ごとに1件へまとめ、成分は「ペンチオピラド・TPN」のように並べて表示します", "🔍 検索結果を「完全一致 → 前方一致 → 部分一致」の順に並べ替え。「ベジセイバー」で検索するとベジセイバーが先頭に出ます", "🔍 候補が多いときの打ち切り(200件)を並べ替えの後に行うように変更。探している薬剤が打ち切りで消える場合があったのを直しました"]
  }, {
    ver: "v8.24",
    date: "2026-08",
    isNew: false,
    notes: ["📋 作業タブの記録に「アグリノート」ボタンを追加。アグリノートへ手で書き写すための数字を、そのまま貼れる形にまとめて表示します", "「同じ日 × 同じ調合」の記録が1グループにまとまり、アグリノートの1レコードに対応します", "圃場一覧・散布液量の合計・農薬ごとの希釈倍数と使用量を表示し、⧉ボタンで1つずつコピーできます", "使用量はアグリノートと同じ計算(散布液量 ÷ 希釈倍数)で出すので、貼り付けた数字がアグリノート側の自動計算と一致します", "剤型から単位を判断し、粉剤・粒剤・水和剤などは kg、液剤は mL で表示します(アグリノートで単位の警告が出るのを防ぐため)", "同じ圃場に同じ日・同じ調合の記録が2件あるときは、圃場と面積は1回だけ数え、散布液量だけ合算します(アグリノートでは圃場を1回しか選べないため)", "🔢 データベースタブの🧪薬剤に「登録番号・名称で検索して登録」を追加。農薬の登録番号・農薬名・成分名で検索して、そのまま薬剤に登録できます", "農薬の種類と剤型は検索結果から自動で入るため、手で選び直す必要がありません", "農薬データ(約6,300件)はアプリに同梱しているので、圏外でも検索できます", "半角カナで入力しても全角カナの農薬名が見つかります。登録済みの薬剤は「✓登録済」と表示され、二重登録になりません", "🐞 希釈倍数の「16」と「16.0」、半角カナと全角カナの薬剤名が別の調合として扱われ、転記が二度手間になる不具合を修正", "🐞 数値の末尾のゼロを消す処理に誤りがあり、桁によっては「100」が「1」と表示されうる不具合を修正", "🐞 作業日が入っていない記録があると画面が表示できなくなる不具合を修正"]
  }, {
    ver: "v8.22",
    date: "2026-08",
    isNew: false,
    notes: ["☁ 送信が「作業日で選んでいる日」ぶんだけに限定されました(これまでは未送信のデータが日付に関係なく一斉に送られていました)", "送信ボタン・見出し・画面右上のバッジに日付と件数を表示(例:8月7日(金)の未送信 3件を送信)", "他の日にも未送信が残っているときは、件数と「作業日を切り替えてください」の案内を表示", "電波が戻ったときの自動送信も、選んでいる日ぶんだけを送るように変更", "🎨 「この日の薬剤」パネルを2つのゾーンに色分け。「① 何を撒くか(薬剤)」は青、「② どこに撒くか(圃場)」は緑にして、どちらの操作をしているか一目で分かるように(これまで全体が同じ緑系で工程が読み取りにくかったため)", "🚁 薬剤の適用先をプルダウンからチェックリストに変更。圃場を複数チェックしてまとめて適用できます(1日のうちで場所によって薬剤が変わる場合、チェックを付け替えて何度でも適用できます)", "「未実施すべて」「この日すべて」「選択解除」のボタンで一括選択。開いたときは未実施の圃場が最初から選ばれています", "各行に現在入っている薬剤名と、予定薬液量(実績入力済みなら実散布量)を表示", "🚁 実績入力済みの圃場にも、あとから薬剤を適用できるように。適用先の一覧に✅付きで出ます", "実績入力済みの圃場に適用したときは、予定薬液量ではなく実散布量を基準に薬量を計算します", "あとから適用した薬剤は、次回の送信でスプレッドシートの薬剤欄(薬剤数・薬剤内容・総量・水量)が上書きされます(行は増えません)", "📊 スプレッドシートで散布日ごとに行の背景色が変わるように(5色を循環)", "📊 送信データと列名がズレていた問題の修正用に、Code.gs に fixHeaders() を追加"]
  }, {
    ver: "v8.21",
    date: "2026-07",
    isNew: false,
    notes: ["🧪 薬剤マスタを単純化。薬剤名・種類・剤型・使用回数の上限だけの名前帳にし、希釈倍率と10aあたり薬量の登録をやめました", "🚁 作業タブに「この日に使用した薬剤」を新設。その日使う薬剤名と希釈倍率をその場で入力して圃場に適用できます(散布水量が変わってもその日の倍率を入れるだけ)", "入力した薬剤はタブを移動しても保持され、日付を変えると空から始まります", "⭐プリセット・↩前回と同じ薬液は「読み込み」として当日の薬剤欄を埋める形になりました", "調合タブは「タンク1杯分の電卓」として役割を明確化", "🧮 調合タブの「↩ この薬液を控える」を廃止。作業タブの「薬剤を圃場に適用」に「🧮 いま調合タブで計算中の薬液」が出るようになり、保存操作なしでそのまま適用できます", "圃場に薬剤を適用すると、自動で「前回薬液」として控えられるように(控え忘れが起きない)", "⚠ 農薬使用回数の上限を薬剤ごとに登録できるように(データベースタブの🧪薬剤)", "⚠ 設定タブに「農薬の使用回数」を新設。作期の開始日を設定すると、その日以降の実績だけを数えます", "🐞 プリセット保存の不具合を修正(空の薬剤行が混ざる・同名で増え続ける・空白名で保存できる・ID採番)", "使われていない旧コード(調合タブの圃場選択の名残)を削除", "集計バーの「残り圃場」を「圃場数」に変更。合計面積・合計薬量も実績入力済みを含めたその日の合計に統一(見出しの「合計」と中身を一致)", "🚁 作業タブの「圃場を検索」を廃止し、「圃場を追加」に統合。「🚜 コースから」と「🌾 圃場を選んで」を切り替えて追加できるように", "「🌾 圃場を選んで」では検索しなくても登録済みの圃場が一覧で出て、タップで追加できるように", "🔄 更新が自動で反映されるように修正(これまではスマホで2回開き直すか、アプリを完全終了しないと切り替わらなかった)", "ホーム画面アプリを前面に戻したときにも新しいバージョンを確認するように", "設定タブに「アプリの更新」を新設。「🔄 最新版に更新する」ボタンで確実に切り替えられます(保存データは消えません)", "🐞 デプロイ直後に更新すると、古いファイルをキャッシュに取り込んでしまう不具合を修正"]
  }, {
    ver: "v8.20",
    date: "2026-07",
    isNew: false,
    notes: ["🚁 実績入力しても作業タブから消えず、そのまま一覧に残って編集できるように変更", "実績値(散布量・面積・備考)をその場に表示。「✎ 実績を修正」を押すと入力済みの値を復元して編集可能に", "送信が完了した圃場だけ色が変わり「✓送信済」と表示(未送信は「実績入力済(未送信)」)", "実績入力(散布量)の初期値を空欄に変更(誤った数値の入力保存を防止)", "作業タブの圃場名・作物名・面積の編集ボタンが実績入力済みの圃場でも使えるように", "予定薬液量を圃場マスタから廃止。「本日の投下量」入力で計算した当日限りの値のみを使用し、日をまたいだ古い値の誤使用を防止", "投下量が未入力の圃場があるとき、作業タブに常時注意バナーを表示", "データベースの圃場マスタ・作業タブの✎編集から「予定薬液量」欄を削除(面積のみ)", "作業タブ下部の「記録」は一覧表示をやめ、CSV出力・印刷のみに整理", "🔒 地図ラベル(圃場名・作物名)の表示方法を修正し、記号を含む名前でも安全に表示されるように", "APIキーの説明文を修正(Google読み込み時に送信される点を明記)", "APIキー入力欄でブラウザの自動入力候補が出ないように変更", "農薬使用回数警告に「簡易的な目安・作期リセットなし」の注記を追加", "「この端末のデータをすべて消去」に誤タップ防止の二段階確認(「消去」と入力)を追加", "作業リストのドラッグ並べ替えで、つかんでいる圃場名がその場に浮かんで見えるように改善", "並べ替えは右の⣿マークのみで行うように変更し、左の番号に触れて誤って動いてしまわないように修正", "設定タブの各項目をバージョン履歴と同じように開閉式にし、タップするまで折りたたまれているように変更", "🌾 プリセットの圃場「編集」をポップアップ化。画面上部まで戻らずその場で編集できるように変更", "圃場名・面積の変更が、作業タブに入っている同じ圃場にも同時に反映されるように", "🐞 コース一括投入などで作業・圃場のIDが重複し、別の圃場を書き換えてしまう不具合を修正(25圃場で約26%発生)", "使われていない処理(旧並べ替え・旧圃場追加・未使用フラグ)を整理", "🚁 作業タブの実績入力・実績修正をポップアップ化(その場で開くので画面を動かさずに入力できる)", "作業タブの✎圃場編集もポップアップ化", "🗑 作業リストに「選択して削除」を追加。チェックした圃場だけ外す・この日をすべて外すが可能に", "まとめ散布と選択削除は同時に動かないようにし、モードを切り替えると選択がリセットされるように", "🗺 地図タブで下のタブバーが地図に隠れる不具合を修正", "実績入力を散布量のみに簡素化。散布面積は圃場の登録面積が自動で記録されるように(面積の修正は✎から)", "まとめ散布にあった、入力しても記録に反映されない面積欄を削除", "🧪 薬剤を1つずつプリセット登録できるように(薬剤名・種類・剤型・希釈倍率)", "調合タブの📋ボタンから、登録した薬剤を種類・倍率ごとそのまま呼び出せるように(呼び出し後に倍率だけ変更も可能)", "🚜 コースの編集画面を「コースの順番」と「追加できる圃場」に分割。⣿ドラッグで順番の入れ替え、「外す」で除外ができるように", "コース編集に圃場の検索を追加。圃場数が多くても探しやすく", "🐞 コース編集をキャンセルした後に新規作成すると既存コースを上書きしてしまう恐れがあった箇所を修正"]
  }, {
    ver: "v8.19",
    date: "2026-07",
    isNew: false,
    notes: ["🌐 Google マップに対応(設定タブでLeaflet/Googleを切替可能)", "Google版でも圃場を囲む・頂点ドラッグ・面積計算・ナビが利用可能", "衛星写真+道路名を同時表示(hybridモード)", "APIキーは設定タブで入力し、この端末にのみ保存(ソースコードに含めない設計)", "設定タブに「この端末のデータを消去」ボタンを追加(端末譲渡・売却前に利用)"]
  }, {
    ver: "v8.18",
    date: "2026-07",
    isNew: false,
    notes: ["🏠 ホームタブを廃止し調合タブに戻す", "⚠ 農薬警告をヘッダー直下の帯に統合(全タブで常時表示)", "地図タブをPC・デスクトップでフルワイド表示に対応", "使い方ガイドをv8.18の構成に完全更新"]
  }, {
    ver: "v8.17",
    date: "2026-07",
    isNew: false,
    notes: ["バージョン履歴を折りたたみ式に(タップで開閉)", "最新バージョンに「New」バッジを追加"]
  }, {
    ver: "v8.16",
    date: "2026-07",
    isNew: false,
    notes: ["農薬使用回数警告機能追加(上限3回)", "圃場登録をデータベースタブに一本化"]
  }, {
    ver: "v8.15",
    date: "2026-07",
    isNew: false,
    notes: ["設定タブに使い方ガイド・バージョン履歴を追加", "地図タブのレスポンシブ改善・OSM切替追加"]
  }, {
    ver: "v8.14",
    date: "2026-07",
    isNew: false,
    notes: ["作業リストをシンプルに整理(実績入力に変更)", "圃場名を大きく太く・作物名を非表示に"]
  }, {
    ver: "v8.13",
    date: "2026-07",
    isNew: false,
    notes: ["地図を大きく・最大ズームアップ・頂点ドラッグ調整", "作業リストの並べ替えをドラッグ&ドロップに"]
  }, {
    ver: "v8.12",
    date: "2026-07",
    isNew: false,
    notes: ["作業タブに薬剤適用(全圃場一括/個別/プリセット)を新設"]
  }, {
    ver: "v8.11",
    date: "2026-07",
    isNew: false,
    notes: ["🗺 地図タブ新設(衛星写真・圃場登録・ナビ・GPS)"]
  }, {
    ver: "v8.10",
    date: "2026-07",
    isNew: false,
    notes: ["⚙ 設定タブ追加、送信中止・再開、共有シート方式"]
  }, {
    ver: "v8.9",
    date: "2026-07",
    isNew: false,
    notes: ["10aあたり投下量から予定薬液量を一括計算"]
  }, {
    ver: "v8.8",
    date: "2026-07",
    isNew: false,
    notes: ["前回と同じ薬液・未送信バッジ・自動リトライ"]
  }].map(v => {
    const open = openVer[v.ver] != null ? openVer[v.ver] : v.isNew;
    return /*#__PURE__*/React.createElement("div", {
      key: v.ver,
      style: {
        marginBottom: 6,
        border: "1px solid #E4EAE0",
        borderRadius: 10,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setOpenVer(s => ({
        ...s,
        [v.ver]: !open
      })),
      style: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "11px 14px",
        background: open ? "#EDF5EE" : "#fff",
        border: "none",
        cursor: "pointer",
        textAlign: "left"
      }
    }, v.isNew && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: "#fff",
        background: "#C74E36",
        borderRadius: 6,
        padding: "2px 7px",
        flexShrink: 0
      }
    }, "New"), /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.versionTag,
        fontSize: 13,
        flexShrink: 0
      }
    }, v.ver), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "#8a978e",
        flex: 1
      }
    }, v.date), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 16,
        color: "#8a978e",
        marginLeft: "auto"
      }
    }, open ? "▲" : "▼")), open && /*#__PURE__*/React.createElement("ul", {
      style: {
        paddingLeft: 20,
        margin: "4px 0 10px"
      }
    }, v.notes.map((n, i) => /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        fontSize: 13,
        color: "#4a5a50",
        lineHeight: 1.8
      }
    }, n))));
  })));
}

// ═══════════════════ 全画面で作図するときの操作バー ═══════════════════
// 通常表示の作図パネルをそのまま全画面に出すと、画面の半分近くを占めて
// 肝心の地図が見えなくなる(説明文2行・大きなトグル・入力欄3つ・登録ボタン)。
// 全画面のときは1行に畳み、圃場名などの入力は「登録」を押したときだけ
// ポップアップで出す。地図を見ながら使う操作(頂点の追加・戻す・全消し)だけを残す。
//
// 作物名・地区の候補(datalist)はこの中に持つ。通常のパネルの中にある候補を
// 参照すると、全画面ではそのパネルごと描画されないため候補が出なくなる。
function DrawBarFull(p) {
  const [nameOpen, setNameOpen] = React.useState(false);
  const ready = p.drawPts.length >= 3 && !p.drawCrossed;
  const iconBtn = (label, onClick, disabled, title) => /*#__PURE__*/React.createElement("button", {
    onClick,
    disabled: !!disabled,
    title,
    "aria-label": title,
    style: {
      ...S.drawBarBtn,
      opacity: disabled ? 0.35 : 1
    }
  }, label);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.drawBarFull
  }, /*#__PURE__*/React.createElement("div", {
    style: S.drawBarInfo,
    className: "num"
  }, p.drawPts.length, "点 ／ ", /*#__PURE__*/React.createElement("strong", {
    // ドラッグ中は React を動かせないので、この要素の中身を
    // 直接書き換えて面積を動かす(useLiveAreaReadout)。
    // v8.58までは ref を通常パネルにしか付けていなかったので、
    // 全画面だと指を離すまで面積が変わらなかった。
    ref: p.areaRef
  }, fmt(p.drawCrossed ? 0 : p.drawArea, 2)), " a", /*#__PURE__*/React.createElement("span", {
    ref: p.warnRef,
    style: {
      color: "#C74E36",
      fontWeight: 800,
      display: p.drawCrossed ? "" : "none"
    }
  }, " ⚠交差")),
  // 交差しているときだけ出す。全画面には説明を置く余地がないので、
  // 押せば直るボタンそのものを見せる
  p.drawCrossed ? iconBtn("🔀 並び順", p.fixTwist, false, "頂点の並び順を直す") : null, iconBtn(p.addMode ? "✏ ON" : "🔒 OFF", () => p.changeAddMode(!p.addMode), false, p.addMode ? "地図をタップすると頂点が増えます" : "地図をタップしても頂点は増えません"), iconBtn("↩", p.undoPt, p.histLen === 0, "1つ戻す"), /*#__PURE__*/React.createElement("button", {
    // ここは「全消し」ではなく「頂点を消すモード」。
    // ON の間は頂点をタップするとその頂点が消える。
    onClick: () => p.changeDelMode(!p.delMode),
    title: p.delMode ? "頂点をタップすると消えます" : "頂点を消すモードにする",
    "aria-label": "頂点を消す",
    style: {
      ...S.drawBarBtn,
      ...(p.delMode ? {
        background: "#FBE9E4",
        borderColor: "#C74E36",
        color: "#8a2f1c"
      } : {})
    }
  }, p.delMode ? "🗑 ON" : "🗑"), iconBtn("🧹", p.resetDrawState, p.drawPts.length === 0, "全消し"), iconBtn("✕", p.onCancel, false, "作図をやめる"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNameOpen(true),
    disabled: !ready,
    style: {
      ...S.drawBarSave,
      opacity: ready ? 1 : 0.35
    }
  }, p.editing ? "✓ 保存" : "✓ 登録")), nameOpen && /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    onClick: () => setNameOpen(false)
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, p.editing ? "圃場を保存" : "圃場を登録"), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel,
    className: "num"
  }, "頂点 ", p.drawPts.length, "点 ／ 面積 ", fmt(p.drawArea, 2), " a"), /*#__PURE__*/React.createElement("input", {
    value: p.newName,
    placeholder: "圃場名 ※必須",
    autoFocus: true,
    onChange: e => p.setNewName(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 10
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: p.newCrop,
    placeholder: "作物名(任意)",
    list: "croplist-full",
    onChange: e => p.setNewCrop(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "croplist-full"
  }, (p.crops || []).map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }))), /*#__PURE__*/React.createElement("input", {
    value: p.newZone,
    placeholder: "地区(任意)",
    list: "arealist-full",
    onChange: e => p.setNewZone(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "arealist-full"
  }, (p.areas || []).map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      p.saveDraw();
      setNameOpen(false);
    },
    disabled: !p.newName.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 14,
      opacity: p.newName.trim() ? 1 : 0.4
    }
  }, p.editing ? "この圃場を保存(" : "この圃場を登録(", fmt(p.drawArea, 2), " a)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNameOpen(false),
    style: {
      ...S.smallSecondary,
      width: "100%",
      marginTop: 8
    }
  }, "地図に戻る"))));
}

// ═══════════════════ 進捗マップ(作業タブの「🚦 進捗地図」) ═══════════════════
// 作業タブの中で、作業一覧と切り替えて出す。圃場の位置を作図・編集する地図タブとは
// 別物で、その日の進み具合だけを見る。編集の操作は一切置いていない。散布の最中に
// 地図を触って、囲んだ形を壊す事故を避けるため(作図・編集は地図タブでしかできない)。
//
// 色は3つだけ。緑=実施済、赤=未実施、灰=その日の作業に入っていない圃場(対象外)。
// 屋外の直射日光下では中間の色(調合済の黄・未送信の橙)が赤とも緑とも読めず、
// 凡例も5つになって読む手間が増えていたので、v8.56で3つに絞った。
// 「調合済だがまだ散布していない」は未実施(赤)に含める。散布したかどうかだけが
// 現場で要る情報で、調合済かどうかは作業一覧側で分かる。
// 「実施済だがこの端末から未送信」も実施済(緑)。件数は地図の上に文字で出す。
const PROGRESS_STATES = {
  done: {
    fill: "#2E7D4F",
    stroke: "#14532B",
    mark: "✓",
    label: "実施済"
  },
  planned: {
    fill: "#D81111",
    stroke: "#7A0B0B",
    mark: "",
    label: "未実施"
  },
  none: {
    // 灰色だと衛星写真の上で地面と見分けにくい。
    // 黄色なら緑(実施済)・赤(未実施)のどちらとも見違えない。
    fill: "#E3B505",
    stroke: "#8A6D00",
    mark: "",
    label: "対象外"
  }
};
// 同じ圃場に複数の作業がぶら下がることがある(午前と午後で分けた等)。
// そのときは「いちばん進んでいる状態」を圃場の色にする。
const PROGRESS_RANK = {
  none: 0,
  planned: 1,
  done: 2
};
const PROGRESS_ORDER = ["done", "planned", "none"];
// サーバーから来る状態は planned / mixed / done の3種類(Code.gs の「状態」列)。
// 地図は実施済かどうかしか見ないので、ここで2つに寄せる。
const toMapStatus = st => st === "done" || st === "local" ? "done" : "planned";
// 進捗地図を開いている間の自動取得の間隔。短くするほど他の端末の実績が早く
// 映るが、そのぶんGASの実行回数と通信量が増える。45秒は未計測の暫定値。
// 圃場名の札を出しはじめる倍率。Leaflet版とGoogle版で揃える
const PROGRESS_LABEL_MIN_ZOOM = 15;

// ── 進捗地図の中身(Leaflet版) ──
// 見出し・凡例・件数は親(ProgressMapTab)が持ち、ここは地図そのものだけを描く。
// 地図タブと同じく、無料地図(Leaflet)とGoogleマップを設定で切り替えられる。
// 親とは apiRef({ resize, fit })でやり取りする。地図の実体はライブラリごとに
// 別物なので、共通の関数名だけを約束して中身は各自が持つ。
function ProgressLeafletCanvas(p) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const fitRef = React.useRef([]); // 直近に描いた「その日の圃場」のポリゴン
  const fittedRef = React.useRef(false); // 最初の1回だけ自動で寄せる
  const [ready, setReady] = React.useState(false);
  const [zoom, setZoom] = React.useState(15);

  const fit = () => {
    const L = window.L;
    const pts = (fitRef.current || []).flat();
    if (!L || !mapRef.current || pts.length === 0) return;
    try {
      mapRef.current.fitBounds(L.latLngBounds(pts), {
        padding: [24, 24],
        maxZoom: 17
      });
    } catch (e) {
      // 座標が壊れている圃場が混ざっている場合。表示位置だけの話なので
      // ここで落とさず、今の表示のままにする
    }
  };

  React.useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const withPoly = (p.fields || []).filter(f => f.center);
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      maxZoom: 21
    }).setView(withPoly.length ? withPoly[0].center : [35.0, 137.0], withPoly.length ? 16 : 5);
    // タイルは地図タブと同じ国土地理院タイル(出典表示も同じ)。
    // 進捗地図のためだけに別の配信元を足さない
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
      attribution: "地理院タイル",
      maxZoom: 21,
      maxNativeZoom: 18
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("zoomend", () => setZoom(map.getZoom()));
    mapRef.current = map;
    setZoom(map.getZoom());
    setReady(true);
    setTimeout(() => map.invalidateSize(), 200);
    if (p.apiRef) p.apiRef.current = {
      resize: () => mapRef.current && mapRef.current.invalidateSize(),
      fit
    };
    return () => {
      map.remove();
      mapRef.current = null;
      if (p.apiRef) p.apiRef.current = null;
    };
  }, []);

  // 「⊙ 今日の圃場へ」。親が数字を1つ増やして知らせる
  React.useEffect(() => {
    if (p.fitSeq) fit();
  }, [p.fitSeq]);

  React.useEffect(() => {
    if (!ready || !window.L || !layerRef.current) return;
    const L = window.L;
    const grp = layerRef.current;
    grp.clearLayers();
    const showLabel = zoom >= PROGRESS_LABEL_MIN_ZOOM;
    // 寄せる範囲は「その日の作業に入っている圃場」だけにする。登録済みの
    // 全圃場で寄せると、遠くに1枚でも登録があるだけで地図が県単位まで
    // 引いてしまい、今日の圃場が点にしか見えなくなる。
    const targetBounds = [];
    (p.fields || []).forEach(f => {
      if (!f.polygon || f.polygon.length < 3) return;
      // キーは文字列で統一(statusByField 側と揃える)。数値と文字列が混ざると
      // 突き合わせに失敗して、作業に入っている圃場まで対象外(灰)になる
      const st = p.statusByField.get(String(f.id));
      const key = st ? st.status : "none";
      if (p.onlyTarget && key === "none") return;
      const c = PROGRESS_STATES[key] || PROGRESS_STATES.none;
      const poly = L.polygon(f.polygon, {
        color: c.stroke,
        weight: key === "none" ? 1.5 : 3,
        fillColor: c.fill,
        fillOpacity: key === "none" ? 0.3 : 0.55
      }).addTo(grp);
      if (key !== "none") targetBounds.push(f.polygon);
      if (showLabel) {
        // 圃場名は他の端末から受け取った文字列でもあるので、必ずエスケープしてから
        // 札のHTMLに入れる(そのまま入れるとXSSになる)
        // 地図タブと同じ形。名前と面積を行で分ける。
        // 名前に数字が入る圃場だと、同じ行に並べた面積と続きの数字に見える。
        poly.bindTooltip('<span class="fl-name">' + escapeHtml((c.mark ? c.mark + " " : "") + f.name) + '</span><span class="fl-area">' + escapeHtml(fieldAreaText(f, p.areaUnitKey)) + '</span>', {
          permanent: true,
          direction: "center",
          className: "field-label"
        });
      }
      poly.on("click", () => p.onSelect({
        field: f,
        st: st || null
      }));
    });
    fitRef.current = targetBounds;
    // 初回だけ自動で寄せる。以後は動かさない(見ている場所が勝手に飛ぶため)。
    // 地図の高さは表示後に実測して入るので、まだ大きさが入っていないうちに
    // 寄せると倍率がでたらめになる。大きさが入るまでは寄せずに待つ。
    if (!fittedRef.current && targetBounds.length && mapRef.current.getSize().y > 80) {
      fittedRef.current = true;
      fit();
    }
  }, [ready, p.fields, p.statusByField, zoom, p.onlyTarget, p.areaUnitKey]);
  // 地図を作ったあとで入れ物の幅が決まることがある。
  // そのとき地図は 0px のままで、タイルも形も出ない。
  // 他のタブを往復すると直るのは、その拍子に大きさが測り直されるから。
  // 大きさが変わるたびに自分で測り直す。
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastW = 0,
      lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!mapRef.current || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      if (w < 20 || h < 20) return;
      mapRef.current.invalidateSize();
      // 幅が0の間は寄せられないので、大きさが決まった時点でもう一度寄せる
      if (!fittedRef.current) {
        fit();
        fittedRef.current = (fitRef.current || []).length > 0;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);


  return /*#__PURE__*/React.createElement("div", {
    ref: containerRef,
    style: p.style,
    "data-map-box": ""
  });
}

// ── 進捗地図の中身(Googleマップ版) ──
// ★Googleマップは地図を作るたびに課金対象(Map load)になる。地図タブとは別の
//   地図なので、作業タブで進捗地図を開くとそのぶん回数が増える。無料地図
//   (Leaflet)のままなら増えない。設定タブで選べる。
function ProgressGoogleCanvas(p) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const overlaysRef = React.useRef([]);
  const fitRef = React.useRef([]);
  const fittedRef = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [zoom, setZoom] = React.useState(15);
  const [loadErr, setLoadErr] = React.useState(false);

  const fit = () => {
    const g = window.google && window.google.maps;
    const pts = (fitRef.current || []).flat();
    if (!g || !mapRef.current || pts.length === 0) return;
    try {
      const b = new g.LatLngBounds();
      pts.forEach(pt => b.extend({
        lat: pt[0],
        lng: pt[1]
      }));
      mapRef.current.fitBounds(b, 24);
    } catch (e) {
      // 座標が壊れている圃場が混ざっている場合。表示位置だけの話なので
      // ここで落とさず、今の表示のままにする
    }
  };

  React.useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(p.gmapKey).then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const g = window.google.maps;
      const withPoly = (p.fields || []).filter(f => f.center);
      const map = new g.Map(containerRef.current, {
        center: withPoly.length ? {
          lat: withPoly[0].center[0],
          lng: withPoly[0].center[1]
        } : {
          lat: 35.0,
          lng: 137.0
        },
        zoom: withPoly.length ? 16 : 5,
        mapTypeId: "hybrid",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // 既定だとスマホで指 1 本で動かそうとしたときに
        // 「地図を移動させるには指 2 本で操作します」と出て地図が動かない。
        // このアプリは地図が主役で、背後のページをスクロールさせたい場面がないので、
        // 1 本指でそのまま動かせる greedy にする。
        gestureHandling: "greedy",
        // 進捗を見るだけの地図なので、作図で要る細かい操作は載せない
        clickableIcons: false
      });
      map.addListener("zoom_changed", () => setZoom(map.getZoom()));
      mapRef.current = map;
      setZoom(map.getZoom());
      setReady(true);
      if (p.apiRef) p.apiRef.current = {
        resize: () => {
          if (mapRef.current && window.google) window.google.maps.event.trigger(mapRef.current, "resize");
        },
        fit
      };
    }).catch(() => {
      if (!cancelled) setLoadErr(true);
    });
    return () => {
      cancelled = true;
      overlaysRef.current.forEach(o => o.setMap && o.setMap(null));
      overlaysRef.current = [];
      mapRef.current = null;
      if (p.apiRef) p.apiRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (p.fitSeq) fit();
  }, [p.fitSeq]);

  React.useEffect(() => {
    if (!ready || !mapRef.current || !window.google) return;
    const g = window.google.maps;
    overlaysRef.current.forEach(o => o.setMap && o.setMap(null));
    overlaysRef.current = [];
    const showLabel = zoom >= PROGRESS_LABEL_MIN_ZOOM;
    const targetBounds = [];
    (p.fields || []).forEach(f => {
      if (!f.polygon || f.polygon.length < 3) return;
      const st = p.statusByField.get(String(f.id));
      const key = st ? st.status : "none";
      if (p.onlyTarget && key === "none") return;
      const c = PROGRESS_STATES[key] || PROGRESS_STATES.none;
      const poly = new g.Polygon({
        paths: f.polygon.map(pt => ({
          lat: pt[0],
          lng: pt[1]
        })),
        strokeColor: c.stroke,
        strokeWeight: key === "none" ? 1.5 : 3,
        fillColor: c.fill,
        fillOpacity: key === "none" ? 0.3 : 0.55,
        map: mapRef.current,
        clickable: true
      });
      poly.addListener("click", () => p.onSelect({
        field: f,
        st: st || null
      }));
      overlaysRef.current.push(poly);
      if (key !== "none") targetBounds.push(f.polygon);
      if (showLabel) {
        const ctr = f.center || polygonCenter(f.polygon);
        // 透明アイコン+ラベルだけのマーカー。Googleマップ側は文字列として
        // 扱うのでHTMLにはならない(Leaflet側のエスケープに当たる処理は不要)
        const label = new g.Marker({
          position: {
            lat: ctr[0],
            lng: ctr[1]
          },
          map: mapRef.current,
          icon: {
            path: 0,
            scale: 0
          },
          label: {
            text: (c.mark ? c.mark + " " : "") + f.name,
            color: "#fff",
            fontSize: "12px",
            fontWeight: "700",
            className: "gm-field-label"
          }
        });
        overlaysRef.current.push(label);
        // Googleの札はHTMLも改行も入れられないので、面積は別の札にして
        // CSS(gm-field-area)で名前の下へずらす。地図タブと同じやり方。
        const areaLabel = new g.Marker({
          position: {
            lat: ctr[0],
            lng: ctr[1]
          },
          map: mapRef.current,
          icon: {
            path: 0,
            scale: 0
          },
          label: {
            text: fieldAreaText(f, p.areaUnitKey),
            color: "#BFE3CD",
            fontSize: "11px",
            fontWeight: "600",
            className: "gm-field-area"
          }
        });
        overlaysRef.current.push(areaLabel);
      }
    });
    fitRef.current = targetBounds;
    if (!fittedRef.current && targetBounds.length) {
      fittedRef.current = true;
      fit();
    }
  }, [ready, p.fields, p.statusByField, zoom, p.onlyTarget, p.areaUnitKey]);
  // 地図を作ったあとで入れ物の幅が決まることがある。
  // そのとき地図は 0px のままで、タイルも形も出ない。
  // 他のタブを往復すると直るのは、その拍子に大きさが測り直されるから。
  // 大きさが変わるたびに自分で測り直す。
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastW = 0,
      lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!mapRef.current || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      if (w < 20 || h < 20) return;
      window.google.maps.event.trigger(mapRef.current, "resize");
      // 幅が0の間は寄せられないので、大きさが決まった時点でもう一度寄せる
      if (!fittedRef.current) {
        fit();
        fittedRef.current = (fitRef.current || []).length > 0;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);


  if (loadErr) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        ...p.style,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.empty
    }, "Googleマップを読み込めませんでした。APIキーと電波を確かめてください。"));
  }
  return /*#__PURE__*/React.createElement("div", {
    ref: containerRef,
    style: p.style,
    "data-map-box": ""
  });
}

function ProgressMapTab(p) {
  const mapWrapRef = React.useRef(null);
  // 地図の実体(Leaflet/Google)とのやり取り口。{ resize, fit } を子が入れる
  const apiRef = React.useRef(null);
  const [fitSeq, setFitSeq] = React.useState(0);
  const [fullMap, setFullMap] = React.useState(false);
  // 既定は全部出す。周りの圃場が見えていないと、どこを見ているのか分からなくなるため。
  // 圃場が多くて対象が埋もれるときのために、絞り込めるようにしてある。
  const [onlyTarget, setOnlyTarget] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [sel, setSel] = React.useState(null);
  // 最後に取れた内容は端末に残す。圏外では取り直せないので、
  // 「いつ時点のものか」を添えてそのまま出す(古い情報を今の状態として見せない)
  const [snap, setSnap] = React.useState(() => load("tankmix:progresssnap", {
    items: [],
    at: "",
    from: "",
    to: ""
  }));
  // 「⊙ 今日の圃場へ」。地図の実体は子が持っているので、数字を1つ増やして頼む
  const fitToTargets = () => setFitSeq(n => n + 1);

  // 期間は選ばせない。見たいのは「作業タブで選んでいる日の圃場が済んだかどうか」で、
  // 日付を別に選べると作業タブと食い違って、どちらが本当か分からなくなる。
  const from = p.workDate;
  const to = p.workDate;
  // 地図エンジンは地図タブと共通の設定を使う。進捗地図だけ別の地図にすると
  // 見え方がタブごとに変わって混乱する。Googleを選んでいてAPIキーがないときは
  // 地図を出せないので、地図タブと同じ案内を出す。
  const useGoogle = p.mapEngine === "google";

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setErr("");
    const r = await p.fetchProgress(from, to);
    setLoading(false);
    if (!r || r.error) {
      const e = r && r.error;
      setErr(e === "設定" ? "設定タブで「送信先URL」と「チームコード」を入れてください" : e === "通信" ? "取得できません。電波の届く場所でもう一度お試しください" : e === "GAS" || e === "invalid payload" ? "スプレッドシート側のスクリプトが古い版です。Code.gs を貼り直して「新バージョン」でデプロイしてください" :e === "auth" ? "共有パスワードが違います。設定タブで確認してください" : "取得できません(" + (e || "不明") + ")");
      return;
    }
    const next = {
      items: r.items || [],
      at: new Date().toISOString(),
      from,
      to
    };
    setSnap(next);
    save("tankmix:progresssnap", next);
  };

  // ── 開いている間は自動で取り直す ──
  // 他の端末で「散布済」にチェックが入ると、その端末からは即座に送られる
  // (toggleDone が pushProgress まで行う)。こちらが取りに行かないと色が
  // 変わらないので、進捗地図を出している間だけ一定間隔で取り直す。
  // 閉じている間・画面が裏に回っている間は取りに行かない(通信量とGASの
  // 実行回数を増やさないため)。表に戻ってきたときは即座に1回取り直す。
  // 進捗地図の取り直しも設定の間隔に合わせる。
  // ここだけ別の間隔だと、設定を短くしても地図の色だけ遅れる。
  const refreshMs = (p.pullSec || 45) * 1000;
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  React.useEffect(() => {
    if (!p.active) return;
    refreshRef.current();
    const tick = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    const id = setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [p.active, from, to, refreshMs]);

  // ── 圃場ごとの状態を決める ──
  // サーバーから来た内容を土台にし、この端末にしかない未送信の実績を上へ重ねる。
  // 自分で入れた実績が、送信するまで地図に出ないのはかえって迷うため。
  const statusByField = React.useMemo(() => {
    const m = new Map();
    const put = (fieldId, st) => {
      // 圃場IDはサーバー経由だと数値、端末側も数値だが、過去の版で文字列に
      // なったデータが混ざりうる。取り違えると同じ圃場が2件に割れて、
      // 片方が地図に出ない。キーは文字列に揃えて突き合わせる。
      const key = String(fieldId);
      const cur = m.get(key);
      if (!cur || PROGRESS_RANK[st.status] > PROGRESS_RANK[cur.status]) m.set(key, st);
    };
    (snap.items || []).forEach(it => put(it.fieldId, {
      status: toMapStatus(it.status || "planned"),
      by: it.by || "",
      at: it.at || "",
      sprayedL: it.sprayedL || 0,
      areaA: it.areaA || "",
      pending: false
    }));
    (p.works || []).forEach(w => {
      if (!w.workDate || w.workDate < from || w.workDate > to) return;
      put(w.fieldId, {
        status: w.reported ? "done" : "planned",
        by: p.recorder || "",
        at: w.reportDate || "",
        sprayedL: parseFloat(w.sprayedL) || 0,
        areaA: w.reportAreaA || "",
        // この端末で入れたが、まだ送れていない実績。色は変えず件数だけ出す
        pending: !!(w.reported && w.updatedAt && w.updatedAt !== w.pushedAt)
      });
    });
    return m;
  }, [snap, p.works, from, to, p.recorder]);

  const counts = React.useMemo(() => {
    const c = {
      done: 0,
      planned: 0,
      pending: 0,
      total: 0,
      areaA: 0,
      // その日の作業に入っているのに、地図で囲まれていない圃場。
      // 数えて出さないと「登録したのに地図に出ない」の理由が分からない
      noPolygon: 0
    };
    const hasPoly = new Map((p.fields || []).map(f => [String(f.id), !!(f.polygon && f.polygon.length >= 3)]));
    statusByField.forEach((v, key) => {
      c.total++;
      c[v.status] = (c[v.status] || 0) + 1;
      if (v.pending) c.pending++;
      if (v.status === "done") c.areaA += parseFloat(v.areaA) || 0;
      if (!hasPoly.get(key)) c.noPolygon++;
    });
    return c;
  }, [statusByField, p.fields]);

  // 地図の初期化・塗り分け・寄せはすべて子(ProgressLeafletCanvas /
  // ProgressGoogleCanvas)が持つ。ここは取得した状態と見出しだけを扱う。

  const legend = /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      flexWrap: "wrap",
      gap: 8
    }
  }, PROGRESS_ORDER.map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 12.5,
      fontWeight: 700,
      color: "#3d4a42"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 15,
      height: 15,
      borderRadius: 4,
      background: PROGRESS_STATES[k].fill,
      border: "2px solid " + PROGRESS_STATES[k].stroke,
      display: "inline-block"
    }
  }), PROGRESS_STATES[k].mark ? PROGRESS_STATES[k].mark + " " : "", PROGRESS_STATES[k].label)));

  const fetchedLabel = snap.at ? new Date(snap.at).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }) : "未取得";

  return /*#__PURE__*/React.createElement(React.Fragment, null,
  // 地図の操作は地図のすぐ上に1行だけ。以前は件数や凡例も含めた
  // カードを地図の上に置いていたため、地図が画面の下半分から始まっていた。
  /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
      marginBottom: 8
    },
    className: "no-print"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOnlyTarget(!onlyTarget),
    style: {
      ...S.mapSeg,
      ...(onlyTarget ? S.segOn : {})
    },
    title: "その日の作業に入っている圃場だけを地図に出す"
  }, onlyTarget ? "◉ 対象だけ" : "○ 全圃場"), /*#__PURE__*/React.createElement("button", {
    onClick: fitToTargets,
    style: S.mapSeg,
    title: "その日の作業に入っている圃場が全部入るまで寄せ直す"
  }, "⊙ 今日の圃場へ"), /*#__PURE__*/React.createElement("button", {
    onClick: refresh,
    disabled: loading,
    style: {
      ...S.smallSecondary,
      marginLeft: "auto"
    }
  }, loading ? "取得中…" : "🔄 最新を取得")), err && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      color: "#C74E36",
      marginBottom: 8,
      fontWeight: 700
    }
  }, err), useGoogle && !p.gmapKey && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "Googleマップを使うにはAPIキーの設定が必要です。設定タブで入力してください。"), !useGoogle && !window.L && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "地図ライブラリを読み込めませんでした。オンラインで開き直してください。"), /*#__PURE__*/React.createElement("div", {
    ref: mapWrapRef,
    style: fullMap ? S.mapWrapFull : S.mapWrap
  }, /*#__PURE__*/React.createElement(useGoogle && p.gmapKey ? ProgressGoogleCanvas : ProgressLeafletCanvas, {
    // 地図の実体を入れ替える。key を分けておかないと、設定を切り替えたとき
    // React が同じ位置のコンポーネントとして使い回し、前の地図のDOMが残る
    key: useGoogle && p.gmapKey ? "google" : "leaflet",
    fields: p.fields,
    statusByField,
    onlyTarget,
    onSelect: setSel,
    apiRef,
    fitSeq,
    gmapKey: p.gmapKey,
    areaUnitKey: p.areaUnitKey,
    style: fullMap ? {
      ...S.mapBox,
      borderRadius: 0,
      border: "none"
    } : S.mapBox
    }), fullMap ? /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(false),
    style: S.mapFullExit
  }, "✕ 全画面をやめる") : null), !fullMap && /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(true),
    style: {
      ...S.smallSecondary,
      marginTop: 8
    }
  }, "⛶ 地図を全画面で見る"), !fullMap && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      marginTop: 8,
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center"
    },
    className: "num"
  }, legend, /*#__PURE__*/React.createElement("span", null, "最終取得 ", fetchedLabel, " ／ ", Math.round(refreshMs / 1000), "秒ごとに自動更新"), counts.pending > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#A15E08",
      fontWeight: 700
    }
  }, "未送信 ", counts.pending), counts.noPolygon > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#7A0B0B",
      fontWeight: 700
    },
    title: "地図タブで囲むと、この地図にも出るようになります"
  }, "地図に出せない圃場 ", counts.noPolygon, "件(位置未登録)")), sel && /*#__PURE__*/React.createElement("div", {
    style: S.modalOverlay,
    onClick: () => setSel(null)
  }, /*#__PURE__*/React.createElement("div", {
    style: S.modalBox,
    "data-modal": "",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, sel.field.name), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, sel.field.crop || "作物未設定", " ／ ", dispArea(parseFloat(sel.field.areaA) || 0, p.areaUnitKey), areaSuffix(p.areaUnitKey)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 16,
      fontWeight: 800
    }
  }, sel.st ? (PROGRESS_STATES[sel.st.status] || PROGRESS_STATES.none).label : "この期間の作業はありません"), sel.st && sel.st.status === "done" && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.smallLabel,
      marginTop: 6
    },
    className: "num"
  }, sel.st.sprayedL > 0 ? "実散布量 " + fmt(sel.st.sprayedL, 1) + " L／" : "", "入力者 ", sel.st.by || "(不明)", sel.st.at ? " ／ " + sel.st.at : ""), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSel(null),
    style: {
      ...S.smallSecondary,
      width: "100%",
      marginTop: 14
    }
  }, "閉じる"))));
}

// ═══════════════════ スタイル ═══════════════════
const S = {
  page: {
    minHeight: "100vh",
    background: "#F0F3EC",
    color: "#1C2B21",
    fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif",
    paddingBottom: 88
  },
  header: {
    padding: "18px 16px 4px",
    maxWidth: 640,
    margin: "0 auto"
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: "0.2em",
    fontWeight: 700,
    color: "#2E7D4F"
  },
  title: {
    fontSize: 27,
    fontWeight: 800,
    margin: "2px 0 0",
    letterSpacing: "-0.01em"
  },
  main: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "10px 12px 0",
    display: "flex",
    flexDirection: "column",
    gap: 12
  },
  mainFull: {
    width: "100%",
    maxWidth: "100%",
    margin: "0",
    padding: "10px 12px 0",
    display: "flex",
    flexDirection: "column",
    gap: 12
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(28,43,33,0.5)",
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16
  },
  modalBox: {
    background: "#fff",
    borderRadius: 14,
    padding: "16px 16px 18px",
    border: "1.5px solid #D8E0D2",
    boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
    width: "100%",
    maxWidth: 440,
    maxHeight: "88vh",
    overflowY: "auto"
  },
  toast: {
    position: "fixed",
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1000,
    background: "#1C2B21",
    color: "#fff",
    padding: "12px 20px",
    borderRadius: 26,
    fontSize: 15,
    fontWeight: 700,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
    maxWidth: "92%"
  },
  card: {
    background: "#fff",
    borderRadius: 14,
    padding: "16px 16px 18px",
    border: "1.5px solid #D8E0D2",
    boxShadow: "0 2px 8px rgba(28,43,33,0.05)"
  },
  cardLabel: {
    fontSize: 13,
    letterSpacing: "0.12em",
    fontWeight: 700,
    color: "#66756a",
    marginBottom: 12
  },
  segWrap: {
    display: "flex",
    background: "#EDF1EA",
    borderRadius: 10,
    padding: 3,
    marginBottom: 14
  },
  seg: {
    flex: 1,
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 700,
    border: "none",
    background: "transparent",
    color: "#66756a",
    borderRadius: 8,
    cursor: "pointer"
  },
  segOn: {
    background: "#fff",
    color: "#1C2B21",
    boxShadow: "0 1px 4px rgba(0,0,0,0.12)"
  },
  totalRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8
  },
  totalInput: {
    fontSize: 44,
    fontWeight: 800,
    width: 170,
    border: "none",
    borderBottom: "3px solid #2E7D4F",
    background: "transparent",
    padding: "0 4px 2px",
    color: "#1C2B21"
  },
  totalUnit: {
    fontSize: 22,
    fontWeight: 700,
    color: "#2E7D4F"
  },
  areaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12
  },
  areaField: {
    display: "flex",
    flexDirection: "column",
    gap: 5
  },
  smallLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: "#66756a"
  },
  inline: {
    display: "flex",
    alignItems: "baseline",
    gap: 5
  },
  midInput: {
    width: "100%",
    fontSize: 26,
    fontWeight: 700,
    padding: "10px 12px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    background: "#FAFBF8"
  },
  midUnit: {
    fontSize: 16,
    fontWeight: 700,
    color: "#66756a"
  },
  derived: {
    marginTop: 12,
    padding: "12px 14px",
    background: "#EDF5EE",
    borderRadius: 9,
    fontSize: 16,
    fontWeight: 600,
    color: "#2E7D4F"
  },
  chemBlock: {
    border: "1.5px solid #E4EAE0",
    borderRadius: 10,
    padding: "10px 10px 12px",
    marginBottom: 10,
    background: "#FCFDFB"
  },
  chemTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8
  },
  chemBottom: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap"
  },
  chemSelectRow: {
    display: "flex",
    gap: 8,
    marginBottom: 8
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 3,
    display: "inline-block",
    flexShrink: 0
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    padding: "12px 12px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff"
  },
  formSelect: {
    fontSize: 15.5,
    fontWeight: 600,
    padding: "12px 8px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff",
    maxWidth: "60vw"
  },
  ratioInput: {
    width: 92,
    fontSize: 20,
    fontWeight: 700,
    padding: "11px 8px",
    textAlign: "right",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff"
  },
  chemResult: {
    fontSize: 16,
    marginLeft: "auto",
    whiteSpace: "nowrap"
  },
  removeBtn: {
    border: "none",
    background: "transparent",
    color: "#9aa89e",
    fontSize: 15,
    cursor: "pointer",
    padding: "6px 8px"
  },
  addBtn: {
    width: "100%",
    padding: "15px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px dashed #2E7D4F",
    borderRadius: 10,
    cursor: "pointer"
  },
  alert: {
    background: "#FBEBE7",
    border: "1.5px solid #C74E36",
    color: "#8a2f1c",
    borderRadius: 9,
    padding: "12px 14px",
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 12
  },
  waterBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    background: "#EAF3FA",
    border: "1.5px solid #BBD6E8",
    borderRadius: 12,
    padding: "14px 16px",
    marginBottom: 14
  },
  tank: {
    width: 64,
    height: 96,
    borderRadius: "8px 8px 12px 12px",
    overflow: "hidden",
    border: "2.5px solid #1C2B21",
    display: "flex",
    flexDirection: "column",
    background: "#F7F9F5",
    flexShrink: 0
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginBottom: 14
  },
  tr: {
    borderBottom: "1px solid #EDF1EA"
  },
  tdName: {
    padding: "12px 4px",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap"
  },
  tdSub: {
    fontSize: 13,
    color: "#8a978e",
    marginLeft: 3
  },
  tdMl: {
    padding: "12px 4px",
    textAlign: "right",
    fontSize: 20,
    fontWeight: 700,
    whiteSpace: "nowrap"
  },
  unit: {
    fontSize: 12,
    fontWeight: 400,
    color: "#8a978e"
  },
  orderBox: {
    background: "#FBF7EC",
    border: "1.5px solid #E4D6AC",
    borderRadius: 12,
    padding: "13px 14px",
    marginBottom: 16
  },
  orderTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#7a621f",
    marginBottom: 9
  },
  orderList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 7
  },
  orderItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 15,
    flexWrap: "wrap"
  },
  orderStep: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    background: "#B78A1F",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  note: {
    fontSize: 13,
    color: "#8a978e",
    margin: "10px 0 0"
  },
  fieldInput: {
    width: "100%",
    fontSize: 17,
    padding: "13px 14px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    background: "#FAFBF8"
  },
  btnRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10
  },
  primaryBtn: {
    padding: "16px 0",
    fontSize: 17,
    fontWeight: 800,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 11,
    cursor: "pointer"
  },
  secondaryBtn: {
    padding: "16px 0",
    fontSize: 17,
    fontWeight: 800,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #2E7D4F",
    borderRadius: 11,
    cursor: "pointer"
  },
  smallPrimary: {
    padding: "10px 16px",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  smallSecondary: {
    padding: "10px 16px",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #2E7D4F",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  smallDanger: {
    padding: "10px 14px",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#8a2f1c",
    background: "#FBEBE7",
    border: "1.5px solid #E0B0A4",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  smallDangerOn: {
    padding: "10px 14px",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#fff",
    background: "#C74E36",
    border: "1.5px solid #C74E36",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "13px 4px",
    borderBottom: "1px solid #EDF1EA",
    flexWrap: "wrap"
  },
  listTitle: {
    fontSize: 17,
    fontWeight: 800
  },
  listSub: {
    fontSize: 14,
    color: "#66756a",
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  empty: {
    fontSize: 15.5,
    color: "#8a978e",
    lineHeight: 1.8,
    textAlign: "center",
    padding: "24px 8px"
  },
  record: {
    border: "1.5px solid #E4EAE0",
    borderRadius: 11,
    marginBottom: 12,
    overflow: "hidden"
  },
  recordSelected: {
    border: "2.5px solid #B78A1F",
    background: "#FFFDF5"
  },
  recordSent: {
    border: "1.5px solid #BFE1CC",
    background: "#F6FBF7"
  },
  recordHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    background: "#F4F7F1",
    borderBottom: "1px solid #E4EAE0",
    gap: 8
  },
  recordDate: {
    fontSize: 15.5,
    fontWeight: 800
  },
  recordField: {
    fontSize: 20,
    fontWeight: 800,
    color: "#2E7D4F",
    wordBreak: "keep-all",
    overflowWrap: "anywhere",
    lineHeight: 1.35
  },
  recordBody: {
    padding: "10px 12px"
  },
  recordTotal: {
    fontSize: 15.5,
    marginBottom: 8,
    color: "#33443a"
  },
  recordChem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 15,
    padding: "5px 0",
    borderTop: "1px dashed #EDF1EA"
  },
  memoLine: {
    fontSize: 14,
    color: "#66756a",
    marginTop: 8
  },
  reportBtn: {
    width: "100%",
    marginTop: 10,
    padding: "15px 0",
    fontSize: 16.5,
    fontWeight: 800,
    color: "#2b5a7a",
    background: "#EAF3FA",
    border: "1.5px solid #BBD6E8",
    borderRadius: 10,
    cursor: "pointer"
  },
  reportForm: {
    marginTop: 10,
    padding: "12px 12px 14px",
    background: "#F4F9FC",
    border: "1.5px solid #BBD6E8",
    borderRadius: 10
  },
  tabbar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    display: "flex",
    background: "#fff",
    borderTop: "1.5px solid #D8E0D2",
    paddingBottom: "env(safe-area-inset-bottom)",
    boxShadow: "0 -2px 12px rgba(28,43,33,0.07)",
    // 地図(Leafletは内部でz-index 400〜800を使う)より必ず上に出す。重なり順は
    // 地図=0 < タブバー=850 < ドラッグ中の札=900 < トースト=1000 < ポップアップ=1100
    zIndex: 850
  },
  hdrChip: {
    fontSize: 11,
    fontWeight: 800,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1.5px solid transparent",
    lineHeight: 1.4
  },
  tabBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "10px 0 8px",
    border: "none",
    background: "transparent",
    color: "#8a978e",
    cursor: "pointer"
  },
  tabBtnActive: {
    color: "#2E7D4F"
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#3B7EA1",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
    padding: "4px 2px"
  },
  settingsBox: {
    marginTop: 12,
    padding: "12px 12px 14px",
    background: "#F7F9F5",
    border: "1.5px solid #E4EAE0",
    borderRadius: 10
  },
  badgeOk: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#2E7D4F",
    background: "#EDF5EE",
    borderRadius: 6,
    padding: "3px 8px",
    marginLeft: 8,
    whiteSpace: "nowrap"
  },
  badgePending: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#8a5a1c",
    background: "#FBF7EC",
    border: "1px solid #E4D6AC",
    borderRadius: 6,
    padding: "3px 8px",
    marginLeft: 8,
    whiteSpace: "nowrap"
  },
  badgePlan: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#66756a",
    background: "#EDF1EA",
    borderRadius: 6,
    padding: "3px 8px",
    whiteSpace: "nowrap"
  },
  // 各圃場の「散布済」チェック。手袋でも押せる大きさにする
  doneBox: {
    width: 40,
    height: 40,
    flexShrink: 0,
    fontSize: 20,
    fontWeight: 800,
    color: "#2E7D4F",
    background: "#fff",
    border: "2.5px solid #B9C3B4",
    borderRadius: 9,
    cursor: "pointer",
    lineHeight: 1
  },
  doneBoxOn: {
    color: "#fff",
    background: "#2E7D4F",
    borderColor: "#1B5E36"
  },
  orderNum: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "#1C2B21",
    color: "#fff",
    fontSize: 18,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    WebkitUserSelect: "none",
    userSelect: "none",
    WebkitTouchCallout: "none"
  },
  orderBtn: {
    width: 48,
    height: 48,
    fontSize: 16,
    fontWeight: 800,
    color: "#1C2B21",
    background: "#EDF1EA",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    cursor: "pointer"
  },
  bigSendBtn: {
    width: "100%",
    padding: "20px 0",
    fontSize: 18,
    fontWeight: 800,
    color: "#fff",
    background: "#3B7EA1",
    border: "none",
    borderRadius: 13,
    cursor: "pointer"
  },
  planSelect: {
    width: "100%",
    fontSize: 16,
    fontWeight: 700,
    padding: "13px 10px",
    marginBottom: 12,
    border: "2px solid #2E7D4F",
    borderRadius: 10,
    background: "#EDF5EE",
    color: "#1C2B21"
  },
  dateRow: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  dateInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: 700,
    padding: "10px 10px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    background: "#FAFBF8",
    minWidth: 0
  },
  totalsBar: {
    display: "flex",
    gap: 10,
    marginTop: 14
  },
  totalsItem: {
    flex: 1,
    background: "#EDF5EE",
    borderRadius: 10,
    padding: "10px 6px",
    textAlign: "center"
  },
  totalsNum: {
    fontSize: 24,
    fontWeight: 800,
    color: "#1C2B21",
    lineHeight: 1.1
  },
  totalsUnit: {
    fontSize: 13,
    fontWeight: 600,
    color: "#66756a"
  },
  totalsNote: {
    display: "block",
    marginTop: 2,
    fontSize: 10.5,
    fontWeight: 600,
    color: "#8a978e"
  },
  totalsLabel: {
    fontSize: 12.5,
    fontWeight: 700,
    color: "#66756a",
    marginTop: 3
  },
  orderBadge: {
    fontSize: 14,
    fontWeight: 800,
    color: "#fff",
    background: "#B78A1F",
    borderRadius: 8,
    padding: "8px 12px",
    whiteSpace: "nowrap"
  },
  checkBtn: {
    width: 48,
    height: 48,
    fontSize: 22,
    fontWeight: 800,
    color: "#fff",
    background: "#fff",
    border: "2.5px solid #B78A1F",
    borderRadius: 10,
    cursor: "pointer",
    flexShrink: 0
  },
  checkBtnOn: {
    background: "#B78A1F"
  },
  updateNow: {
    fontSize: 14.5,
    fontWeight: 700,
    color: "#33443a",
    padding: "10px 12px",
    background: "#EDF5EE",
    border: "1.5px solid #BFE1CC",
    borderRadius: 9
  },
  dayChemRow: {
    padding: "10px 12px",
    marginBottom: 8,
    background: "#fff",
    border: "1.5px solid #BBD6E8",
    borderRadius: 10
  },
  dayChemSummary: {
    marginTop: 6,
    padding: "10px 12px",
    background: "#EDF5EE",
    border: "1.5px solid #BFE1CC",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 700,
    color: "#33443a"
  },
  chemPickBtn: {
    width: 40,
    height: 40,
    fontSize: 17,
    border: "1.5px solid #BBD6E8",
    background: "#EAF3FA",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  chemPickRow: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    marginTop: 8,
    background: "#fff",
    border: "1.5px solid #D8E0D2",
    borderRadius: 10,
    cursor: "pointer"
  },
  checkBtnDanger: {
    background: "#C74E36",
    borderColor: "#C74E36"
  },
  recordDeleting: {
    border: "2.5px solid #C74E36",
    background: "#FDF3F1"
  },
  delBar: {
    marginTop: 10,
    marginBottom: 12,
    padding: "10px 12px",
    background: "#FBF0EE",
    border: "1.5px solid #E8C4BB",
    borderRadius: 10
  },
  anbunBox: {
    marginTop: 10,
    padding: "10px 12px",
    background: "#FBF7EC",
    border: "1.5px solid #E4D6AC",
    borderRadius: 9
  },
  anbunTitle: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#7a621f",
    marginBottom: 6
  },
  anbunRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 14.5,
    padding: "5px 0",
    borderTop: "1px dashed #E4D6AC"
  },
  pickRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 10px",
    borderRadius: 9,
    border: "1.5px solid #E4EAE0",
    marginBottom: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 16
  },
  pickNum: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "#EDF1EA",
    color: "#8a978e",
    fontSize: 15,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  // 薬剤の適用先チェックリスト(選択中の行・チェック枠・上部の一括選択ボタン)
  pickRowOn: {
    borderColor: "#2E7D4F",
    background: "#EDF5EE"
  },
  pickNumOn: {
    background: "#2E7D4F",
    color: "#fff"
  },
  chemPickQuick: {
    padding: "8px 12px",
    fontSize: 13.5,
    fontWeight: 700,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #B9D4C0",
    borderRadius: 8,
    cursor: "pointer"
  },
  // 「この日の薬剤」パネルは2工程あるので、面の色で分ける。
  // ①何を撒くか = 青系(linkBtn・chemPickBtnで既に使っている青に揃える) / ②どこに撒くか = 緑系
  zoneChem: {
    background: "#F2F7FB",
    border: "1.5px solid #BBD6E8",
    borderRadius: 12,
    padding: "12px 12px 14px",
    marginTop: 6
  },
  zoneChemHead: {
    fontSize: 14.5,
    fontWeight: 800,
    color: "#1C6EA4",
    marginBottom: 10
  },
  zoneField: {
    background: "#F4F8F3",
    border: "1.5px solid #BFE1CC",
    borderRadius: 12,
    padding: "12px 12px 14px",
    marginTop: 12
  },
  zoneFieldHead: {
    fontSize: 14.5,
    fontWeight: 800,
    color: "#2E7D4F",
    marginBottom: 10
  },
  // 青ゾーン内の「追加」ボタン(緑のaddBtnと役割は同じだが、ゾーンの色に合わせる)
  addBtnBlue: {
    width: "100%",
    padding: "15px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "#1C6EA4",
    background: "#EAF2F8",
    border: "1.5px dashed #1C6EA4",
    borderRadius: 10,
    cursor: "pointer"
  },
  flightNum: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "#3B7EA1",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  flightSumBox: {
    marginTop: 10,
    padding: "10px 14px",
    background: "#EAF3FA",
    border: "1.5px solid #BBD6E8",
    borderRadius: 9,
    fontSize: 15,
    fontWeight: 600,
    color: "#2b5a7a"
  },
  recallBtn: {
    padding: "9px 14px",
    fontSize: 14,
    fontWeight: 800,
    color: "#B78A1F",
    background: "#FBF7EC",
    border: "1.5px solid #E4D6AC",
    borderRadius: 20,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0
  },
  headerBadge: {
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 800,
    color: "#fff",
    background: "#C74E36",
    border: "none",
    borderRadius: 20,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(199,78,54,0.3)"
  },
  warnBand: {
    background: "#FBF0EE",
    borderBottom: "1.5px solid #E8C4BB",
    padding: "8px 16px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    maxWidth: 640,
    margin: "0 auto",
    width: "100%"
  },
  warnIcon: {
    fontSize: 16,
    flexShrink: 0,
    color: "#C74E36"
  },
  recordNext: {
    border: "2.5px solid #2E7D4F",
    boxShadow: "0 2px 10px rgba(46,125,79,0.18)"
  },
  nextTag: {
    fontSize: 12,
    fontWeight: 800,
    color: "#2E7D4F",
    letterSpacing: "0.04em",
    marginBottom: 2
  },
  dayChemStrip: {
    display: "block",
    width: "100%",
    marginTop: 10,
    padding: "9px 12px",
    background: "#EDF5EE",
    border: "1.5px solid #BFE1CC",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 700,
    color: "#33443a",
    textAlign: "left",
    cursor: "pointer"
  },
  prepBlock: {
    marginTop: 16
  },
  progWrap: {
    marginTop: 12
  },
  progTop: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    fontSize: 15,
    fontWeight: 700,
    color: "#33443a",
    marginBottom: 6
  },
  progRest: {
    fontSize: 24,
    fontWeight: 800,
    color: "#C74E36",
    margin: "0 2px"
  },
  progSub: {
    fontSize: 13.5,
    color: "#66756a"
  },
  progBar: {
    height: 10,
    borderRadius: 5,
    background: "#E4EAE0",
    overflow: "hidden"
  },
  progFill: {
    height: "100%",
    background: "#2E7D4F",
    borderRadius: 5,
    transition: "width 0.25s"
  },
  rateWarnBand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#FBF0EE",
    border: "1.5px solid #E8C4BB",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13.5,
    fontWeight: 700,
    color: "#8a2f1c"
  },
  naviPanel: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    background: "#EDF4F8",
    border: "1.5px solid #BBD6E8",
    borderRadius: 10,
    padding: "10px 12px"
  },
  naviPanelLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "#5b7386",
    letterSpacing: "0.04em"
  },
  naviPanelName: {
    fontSize: 15.5,
    fontWeight: 800,
    color: "#2b5a7a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  rateBox: {
    marginTop: 14,
    padding: "12px 14px",
    background: "#FBF7EC",
    border: "1.5px solid #E4D6AC",
    borderRadius: 10
  },
  rateHint: {
    marginTop: 8,
    fontSize: 13.5,
    color: "#7a621f",
    fontWeight: 600
  },
  versionTag: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#66756a",
    background: "#EDF1EA",
    border: "1.5px solid #D8E0D2",
    borderRadius: 20,
    padding: "5px 12px",
    whiteSpace: "nowrap"
  },
  unitSelect: {
    fontSize: 17,
    fontWeight: 700,
    padding: "13px 12px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    background: "#FAFBF8"
  },
  cropChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 15,
    fontWeight: 700,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #2E7D4F",
    borderRadius: 20,
    padding: "8px 8px 8px 14px"
  },
  cropChipX: {
    border: "none",
    background: "transparent",
    color: "#2E7D4F",
    fontSize: 14,
    cursor: "pointer",
    padding: "0 4px",
    fontWeight: 800
  },
  cropPickChip: {
    padding: "8px 14px",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#66756a",
    background: "#fff",
    border: "1.5px solid #D8E0D2",
    borderRadius: 20,
    cursor: "pointer"
  },
  cropPickChipOn: {
    color: "#fff",
    background: "#2E7D4F",
    border: "1.5px solid #2E7D4F"
  },
  progressBox: {
    padding: "12px 14px",
    background: "#EAF3FA",
    border: "1.5px solid #BBD6E8",
    borderRadius: 10,
    marginBottom: 12
  },
  progressTrack: {
    height: 10,
    background: "#D3E4EF",
    borderRadius: 6,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    background: "#3B7EA1",
    transition: "width 0.2s"
  },
  abortBtn: {
    padding: "9px 16px",
    fontSize: 14.5,
    fontWeight: 800,
    color: "#fff",
    background: "#C74E36",
    border: "none",
    borderRadius: 8,
    cursor: "pointer"
  },
  mapWrap: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: 280 // 高さは実測して JS が入れる。ここは測る前の初期値
  },
  // 全画面。タブバー(850)より上に出し、地図だけを見せる
  mapWrapFull: {
    position: "fixed",
    inset: 0,
    zIndex: 900,
    display: "flex",
    flexDirection: "column",
    background: "#dfe6da",
    padding: "0 0 env(safe-area-inset-bottom)"
  },
  // 全画面のまま作図するときの操作バー。地図の覆い(mapWrapFull, zIndex 900)より
  // 前に出す。高さは1行ぶんに抑え、地図をできるだけ広く残す。
  // 全画面で作図していないときの帯。囲む・全画面をやめるをここに集める
  fullBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 920,
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(255,255,255,0.96)",
    borderTop: "1.5px solid #D8E0D2",
    padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
    boxShadow: "0 -3px 14px rgba(0,0,0,0.2)"
  },
  fullBarHint: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: 700,
    color: "#66756a",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  fullBarPrimary: {
    flexShrink: 0,
    background: "#2E7D4F",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer"
  },
  drawBarFull: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 920,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "nowrap",
    overflowX: "auto",
    background: "rgba(255,255,255,0.96)",
    borderTop: "1.5px solid #D8E0D2",
    padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
    boxShadow: "0 -3px 14px rgba(0,0,0,0.2)"
  },
  drawBarInfo: {
    fontSize: 14,
    fontWeight: 700,
    color: "#1C2B21",
    whiteSpace: "nowrap",
    marginRight: 2
  },
  drawBarBtn: {
    flexShrink: 0,
    minWidth: 44,
    padding: "10px 10px",
    fontSize: 14,
    fontWeight: 700,
    color: "#1C2B21",
    background: "#fff",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  drawBarSave: {
    flexShrink: 0,
    marginLeft: "auto",
    padding: "10px 16px",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
    background: "#2E7D4F",
    border: "1.5px solid #1B5E36",
    borderRadius: 9,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  mapFullExit: {
    position: "fixed",
    top: "calc(10px + env(safe-area-inset-top))",
    right: 12,
    zIndex: 910,
    background: "rgba(255,255,255,0.94)",
    border: "1.5px solid #D8E0D2",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 14,
    fontWeight: 700,
    color: "#1C2B21",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    cursor: "pointer"
  },
  mapSegWrap: {
    display: "flex",
    flex: "0 0 auto",
    background: "#EDF1EA",
    borderRadius: 10,
    padding: 3
  },
  mapSeg: {
    padding: "7px 14px",
    fontSize: 14,
    fontWeight: 700,
    border: "none",
    background: "transparent",
    color: "#66756a",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  mapBox: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    overflow: "hidden",
    border: "1.5px solid #D8E0D2",
    background: "#dfe6da",
    // Leafletは内部でz-index 400〜800を使うため、そのままだと下のタブバーを覆ってしまう。
    // ここで独立した重なり階層(スタッキングコンテキスト)を作り、地図の中に閉じ込める。
    position: "relative",
    zIndex: 0,
    isolation: "isolate"
  },
  drawInfo: {
    marginTop: 8,
    padding: "10px 14px",
    background: "#FBEEEB",
    border: "1.5px solid #E8C4BB",
    borderRadius: 9,
    fontSize: 15,
    color: "#8a3f2c",
    fontWeight: 600
  },
  zoneToggle: {
    flex: 1,
    minWidth: 0,
    textAlign: "left",
    background: "transparent",
    border: "none",
    padding: 0,
    font: "inherit",
    color: "inherit",
    cursor: "pointer"
  },
  zoneEye: {
    flexShrink: 0,
    background: "#fff",
    border: "1px solid #d7dee7",
    borderRadius: 7,
    padding: "3px 9px",
    fontSize: 12,
    color: "#5a6b7d",
    cursor: "pointer"
  },
  zoneHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 14,
    marginBottom: 2,
    padding: "6px 10px",
    background: "#EEF3F8",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    color: "#41576e"
  },
  zoneCount: {
    fontSize: 12,
    fontWeight: 600,
    color: "#7a8ca0"
  },
  drawWarn: {
    marginTop: 8,
    padding: "10px 14px",
    background: "#FFF3CD",
    border: "1.5px solid #E0A800",
    borderRadius: 9,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#7a5200",
    fontWeight: 600
  },
  naviBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "9px 14px",
    fontSize: 14,
    fontWeight: 800,
    color: "#fff",
    background: "#3B7EA1",
    borderRadius: 9,
    textDecoration: "none",
    whiteSpace: "nowrap"
  },
  applyChemBtn: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "13px 16px",
    fontSize: 15,
    fontWeight: 700,
    color: "#1C2B21",
    background: "#F7F9F5",
    border: "1.5px solid #D8E0D2",
    borderRadius: 10,
    cursor: "pointer"
  },
  workMeta: {
    fontSize: 16,
    fontWeight: 800,
    color: "#3a4a40",
    marginTop: 4,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6
  },
  workMetaUnit: {
    fontSize: 12.5,
    fontWeight: 700,
    marginLeft: 1
  },
  workMetaSep: {
    color: "#66756a",
    fontWeight: 700
  },
  tankOverWarn: {
    fontSize: 13,
    fontWeight: 800,
    color: "#B03A2E"
  },
  tankBand: {
    margin: "10px 0",
    padding: "9px 12px",
    fontSize: 14,
    fontWeight: 800,
    color: "#8a5a12",
    background: "#FFF6E3",
    border: "1.5px dashed #E0BE79",
    borderRadius: 10,
    textAlign: "center"
  },
  dragHandle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    fontSize: 22,
    color: "#8a978e",
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    borderRadius: 8,
    background: "#EDF1EA"
  },
};
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
