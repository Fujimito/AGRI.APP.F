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
const APP_VERSION = "v8.35";
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
const fmtL = ml => (ml / 1000).toLocaleString("ja-JP", {
  maximumFractionDigits: 3
});

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
  latlngs.forEach(p => {
    lat += p[0];
    lng += p[1];
  });
  return [lat / latlngs.length, lng / latlngs.length];
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

// ═══════════════════ メイン ═══════════════════
function App() {
  const [tab, setTab] = useState("calc");
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
  const [works, setWorks] = useState(() => load("tankmix:works", []));
  const [chemMaster, setChemMaster] = useState(() => load("tankmix:chemmaster", []));
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
    if (!confirm("この端末に保存されているデータ(圃場・作業記録・APIキーなど)をすべて消去します。\n送信済みの記録はスプレッドシート側に残ります。\nこの操作は取り消せません。よろしいですか？")) return;
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
    setGasUrlState(v);
    localStorage.setItem("tankmix:gasurl", v.trim());
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
  const setFieldsSave = next => {
    setFields(next);
    save("tankmix:fields", next);
  };
  const setWorksSave = next => {
    setWorks(next);
    save("tankmix:works", next);
  };
  const setChemMasterSave = next => {
    setChemMaster(next);
    save("tankmix:chemmaster", next);
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
    return f.id;
  };
  const deleteField = id => {
    setFieldsSave(fields.filter(f => f.id !== id));
    flash("圃場をマスタから削除しました(過去の記録は残ります)");
  };
  const addFieldOnly = data => {
    if (fields.some(x => x.name === data.name)) {
      flash("同名の圃場が既にあります");
      return;
    }
    setFieldsSave([...fields, {
      id: newId(),
      name: data.name,
      crop: data.crop || "",
      area: (data.area || "").trim(),
      areaA: data.areaA
    }]);
    flash("圃場「" + data.name + "」を登録しました");
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
  const removeWork = id => setWorksSave(works.filter(w => w.id !== id));
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
  // 薬剤を1圃場だけに適用
  const applyChemsToWork = (workId, chemList) => applyChemsToWorks([workId], chemList);
  // 薬剤をその日の未実施の圃場すべてに一括適用
  const applyChemsToAll = chemList => {
    const dayIds = works.filter(w => w.workDate === workDate && !w.reported).map(w => w.id);
    if (dayIds.length === 0) {
      flash("この日の作業リストが空です");
      return;
    }
    applyChemsToWorks(dayIds, chemList);
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
  };
  const deleteWork = id => setWorksSave(works.filter(w => w.id !== id));
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
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(body)
        });
        const j = await res.json();
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
    setSyncing(true);
    let current = load("tankmix:works", []);
    // 送信対象は「作業日で選んでいる日」の未送信ぶんだけ。
    // 以前は全期間の未送信をまとめて送っていたため、意図しない日の記録まで一斉に送られていた。
    const pendingList = current.filter(w => w.workDate === workDate && (!w.synced || w.reported && !w.reportSynced));
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
      const cur = current.find(x => x.id === w.id);
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
    if (aborted) flash(sent + "件送信して中止しました。残りは後で送信できます");else if (sent > 0) flash(sent + "件を送信しました" + (failed ? "(一部失敗・再試行してください)" : ""));else if (failed) flash("送信に失敗しました。電波とURLを確認してください");
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
    flash("接続を確認中…");
    try {
      const res = await fetch(url);
      const j = await res.json();
      flash(j && j.ok ? "✅ 接続OK！" : "応答が不正です。URLを確認してください");
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
    const payload = JSON.stringify({
      fields,
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
    if (j && j.ok) flash("☁ 共有データを保存しました(" + fields.length + "圃場)");else if (j && j.error) flash("保存失敗:" + j.error + "。GASを最新版に更新してください");else flash("保存に失敗しました。URLとGASの更新・デプロイを確認してください");
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
        if (arr(data.fields)) setFieldsSave(data.fields);
        if (arr(data.works)) setWorksSave(data.works);
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
    } else {
      flash("読み込みに失敗しました");
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
  const deleteChemMaster = name => setChemMasterSave(chemMaster.filter(c => c.name !== name));
  const editChemMaster = (name, data) => setChemMasterSave(chemMaster.map(c => c.name === name ? {
    ...c,
    ...data
  } : c));
  const exportCSV = () => {
    // 末尾のゼロ落としは stripTrailingZeros に任せる。以前は小数点の有無を見ずに
    // 削っていたため、桁数0で呼ぶと "100" が "1" になる取り違えが起きえた。
    const plain = (n, d = 2) => isFinite(n) && n !== "" ? stripTrailingZeros(Number(n).toFixed(d)) : "";
    // 圃場名や備考にカンマ・改行・引用符が入っても列がずれないよう、CSV の
    // 決まりどおり二重引用符で囲む。以前は備考だけカンマを空白に潰していたため、
    // 圃場名に「A圃場,西」のような名前を付けると列が1つ増えて崩れていた
    const csvCell = v => {
      const t = v === null || v === undefined ? "" : String(v);
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
  const isPending = w => !w.synced || w.reported && !w.reportSynced;
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
  }, APP_VERSION), pendingCount > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTab("work");
      syncPending();
    },
    style: S.headerBadge
  }, syncing ? "送信中…" : "☁ " + dateLabel(workDate) + " 未送信 " + pendingCount + "件")))), chemWarnings.length > 0 && /*#__PURE__*/React.createElement("div", {
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
    resolveWork,
    works,
    lastMix,
    loadLastMix
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
    recorder,
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
    applyChemsToWork,
    applyChemsToWorks,
    applyChemsToAll,
    crops,
    addCrop,
    areaUnitKey,
    volUnitKey,
    tankCapacityL,
    flash
  }), tab === "preset" && /*#__PURE__*/React.createElement(PresetTab, {
    fields,
    upsertField,
    deleteField,
    addFieldOnly,
    areas,
    resolveWork,
    works,
    workDate,
    chemMaster,
    addChemMaster,
    deleteChemMaster,
    editChemMaster,
    presets,
    loadPreset,
    deletePreset,
    crops,
    addCrop,
    deleteCrop,
    areaUnitKey,
    volUnitKey
  }), tab === "map" && /*#__PURE__*/React.createElement(MapTabRouter, {
    fields,
    addFieldWithPolygon,
    areas,
    crops,
    addCrop,
    flash,
    mapEngine,
    gmapKey,
    setTab
  }), tab === "settings" && /*#__PURE__*/React.createElement(SettingsTab, {
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
    testConnection,
    cloudSave,
    cloudLoad,
    syncing,
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
  }, [["calc", "🧮", "調合"], ["work", "🚁", "作業"], ["map", "🗺", "地図"], ["preset", "📋", "データベース"], ["settings", "⚙", "設定"]].map(t => /*#__PURE__*/React.createElement("button", {
    key: t[0],
    onClick: () => setTab(t[0]),
    style: {
      ...S.tabBtn,
      ...(tab === t[0] ? S.tabBtnActive : {})
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, t[1]), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 700,
      whiteSpace: "nowrap"
    },
    className: "tab-label"
  }, t[2])))));
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  // 登録薬剤の呼び出し先。薬剤行のID、または新しい行として追加する場合は "new"
  const [pickFor, setPickFor] = useState(null);
  const onPick = m => {
    if (pickFor === "new") p.addChemFromMaster(m);else p.applyChemMaster(pickFor, m);
    setPickFor(null);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, pickFor !== null && /*#__PURE__*/React.createElement(ChemPickModal, {
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
  }, "ここはタンク1杯分を計算するための電卓です。圃場への適用は「作業・記録」タブの「この日に使用した薬剤」で行います。何度も使う組み合わせは「⭐ プリセットに保存」で名前を付けて残すと、作業タブから読み込めます。")));
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
  const nextWork = pendingDayList[0] || null;
  // タンクの累計と補給位置。state に持たず毎回 pendingDayList から導出するので、
  // 並べ替え・圃場の追加削除・実績入力のたびに自動で計算し直される
  const tankPlan = planTankRefills(pendingDayList, p.tankCapacityL);
  // 本日の投下量(L/10a)がまだ計算されていない圃場がある場合は警告バナーを出す
  const needsRateWarning = pendingDayList.some(w => !(parseFloat(w.plannedL) > 0));
  // 順送りナビの対象。既存の nextWork(実績入力の導線)は壊さず、飛ばした分だけを別に除く
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
  const rateSkipped = dayList.length - rateTargets.length;
  const rateArea = rateTargets.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0);
  const rateTotal = rateTargets.reduce((s, w) => s + plannedLFromArea(p.resolveWork(w).areaA, rateNum), 0);
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
    field: editingField,
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
  }), nextWork && selMode === "none" && !reportingWork && !editingField && !pickForDay && /*#__PURE__*/React.createElement("div", {
    style: S.nextBar,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.nextBarLabel
  }, "▶ 次の圃場 (あと ", pendingDayList.length, ")"), /*#__PURE__*/React.createElement("div", {
    style: S.nextBarName
  }, p.resolveWork(nextWork).name)), /*#__PURE__*/React.createElement("button", {
    onClick: () => openReport(nextWork),
    style: S.nextBarBtn
  }, "🚁 実績入力")), draggingWork && dragPos && dragChip(dragPos, p.resolveWork(draggingWork).name), /*#__PURE__*/React.createElement("section", {
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
    style: S.totalsBar,
    className: "num"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, "実績 ", reportedCount, "/", dayList.length, "圃場")))), needsRateWarning && /*#__PURE__*/React.createElement("div", {
    style: S.rateWarnBand,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", null, "⚠"), /*#__PURE__*/React.createElement("span", null, "本日の投下量(L/10a)が未入力の圃場があります。下の欄に入力して「面積から一括計算」を押してください。")), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
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
  }), p.dayChems.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setPrepOpen(true),
    style: S.dayChemStrip,
    className: "no-print"
  }, "🧪 ", p.dayChems.map(c => (c.name || "(無名)") + (c.ratio ? " " + c.ratio + "倍" : "")).join(" ／ "))), /*#__PURE__*/React.createElement("section", {
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
  }, "面積から一括計算")), parseFloat(ratePerDay) > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.rateHint,
    className: "num"
  }, "対象 ", rateTargets.length, "圃場 ／ 合計 ", fmt(rateArea, 2), "a → ", fmt(rateTotal, 2), "L", rateSkipped > 0 ? "(実績入力済み " + rateSkipped + "圃場は上書きしません)" : "")), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
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
    }, selected.includes(w.id) ? "✓" : "") : /*#__PURE__*/React.createElement("span", {
      style: S.orderNum,
      className: "num"
    }, idx + 1), /*#__PURE__*/React.createElement("div", {
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
    }, w.reported ? w.synced && w.reportSynced ? "✓送信済" : "実績入力済(未送信)" : w.chems.length > 0 ? "調合済" : "計画"), /*#__PURE__*/React.createElement("div", {
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
  }))), nextWork && selMode === "none" && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 76
    },
    className: "no-print"
  }));
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
  }, "「同じ日 × 同じ調合」でまとめた1グループが、AgriNote の1レコードに対応します。⧉ で数値をコピーして貼り付けてください。使用量 = 散布液量 ÷ 希釈倍数(AgriNote と同じ式)。単位は剤型からの推定です。"), groups.length === 0 ? /*#__PURE__*/React.createElement("p", {
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
// FAMICの農薬登録情報(基本部)を chemdb.json として同梱し、登録番号・農薬名・
// 成分名で検索して、その場で薬剤マスタ(プリセット)に登録できるようにする。
// データは公的情報(FAMIC 農薬登録情報ダウンロード)のスナップショット。
// chemdb.json の1件は {n:登録番号, nm:農薬名, u:用途キー, f:剤型キー, ig:有効成分, mk:登録者}。
// 容量を抑えるためキー名を短くしてある。生成は tools/update_chemdb.py。
const CHEM_SEARCH_LIMIT = 200; // 一度に表示する検索結果の上限
let chemDbCache = null;
let chemDbLoading = null;
function loadChemDb() {
  if (chemDbCache) return Promise.resolve(chemDbCache);
  if (!chemDbLoading) chemDbLoading = fetch("chemdb.json").then(res => {
    if (!res.ok) throw new Error("農薬データの取得に失敗しました");
    return res.json();
  }).then(data => {
    chemDbCache = data;
    return data;
  }).catch(err => {
    // 失敗した Promise を残すと、オンラインに戻っても二度と読み込めなくなる
    chemDbLoading = null;
    throw err;
  });
  return chemDbLoading;
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
  }, "農薬データを読み込めませんでした。オンラインで一度アプリを開くと、以降はオフラインでも使えます。") : !chemDb ? /*#__PURE__*/React.createElement("p", {
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
  }, isRegistered(chem) ? "✓登録済" : "＋登録")))), /*#__PURE__*/React.createElement("button", {
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
function PresetTab(p) {
  const [sub, setSub] = useState("field"); // field | chem
  // 圃場フォーム(新規登録用。編集は下のポップアップで行う)
  const [fName, setFName] = useState("");
  const [fCrop, setFCrop] = useState("");
  const [fArea, setFArea] = useState("");
  const [fZone, setFZone] = useState(""); // 地区
  const [fq, setFq] = useState("");
  // 圃場編集ポップアップ(編集対象のID。nullなら閉じている)
  const [editId, setEditId] = useState(null);
  const [mf, setMf] = useState({
    name: "",
    crop: "",
    area: "",
    areaA: ""
  });
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
  const ncq = normalizeChemName(cq);
  const chemList = ncq ? p.chemMaster.filter(c => normalizeChemName(c.name).includes(ncq)) : p.chemMaster;
  // 新規登録(このカードは登録専用。編集はポップアップで行う)
  const submitField = () => {
    if (!fName.trim()) return;
    const cropName = fCrop.trim();
    if (cropName) p.addCrop(cropName); // 入力された作物をマスタに自動登録
    p.addFieldOnly({
      name: fName.trim(),
      crop: cropName,
      area: fZone.trim(),
      areaA: parseFloat(fArea) || ""
    });
    setFName("");
    setFCrop("");
    setFArea("");
    // 地区は残す。同じ地区の圃場を連続で登録することが多いため
  };
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
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.subTabWrap
  }, [["field", "🌾 圃場"], ["chem", "🧪 薬剤"]].map(t => /*#__PURE__*/React.createElement("button", {
    key: t[0],
    onClick: () => setSub(t[0]),
    style: {
      ...S.subTab,
      ...(sub === t[0] ? S.subTabOn : {})
    }
  }, t[1]))), sub === "field" && /*#__PURE__*/React.createElement(React.Fragment, null, editField && /*#__PURE__*/React.createElement(FieldEditModal, {
    field: editField,
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
  }, "圃場を登録"), /*#__PURE__*/React.createElement("datalist", {
    id: "croplist"
  }, p.crops.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }))), /*#__PURE__*/React.createElement("div", {
    style: S.areaGrid
  }, /*#__PURE__*/React.createElement("input", {
    value: fName,
    placeholder: "圃場名 ※必須",
    onChange: e => setFName(e.target.value),
    style: S.fieldInput
  }), /*#__PURE__*/React.createElement("input", {
    value: fCrop,
    placeholder: "作物名(入力or選択)",
    list: "croplist",
    onChange: e => setFCrop(e.target.value),
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "面積(a)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    value: fArea,
    onChange: e => setFArea(e.target.value),
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
    value: fZone,
    placeholder: "例:大津地区",
    list: "arealist",
    onChange: e => setFZone(e.target.value),
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("datalist", {
    id: "arealist"
  }, (p.areas || []).map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }))), (p.areas || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8
    }
  }, p.areas.map(a => /*#__PURE__*/React.createElement("button", {
    key: a,
    onClick: () => setFZone(a),
    style: {
      ...S.cropPickChip,
      ...(fZone === a ? S.cropPickChipOn : {})
    }
  }, a))), p.crops.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10
    }
  }, p.crops.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => setFCrop(c),
    style: {
      ...S.cropPickChip,
      ...(fCrop === c ? S.cropPickChipOn : {})
    }
  }, c))), /*#__PURE__*/React.createElement("button", {
    onClick: submitField,
    disabled: !fName.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 12,
      opacity: fName.trim() ? 1 : 0.4
    }
  }, "＋ 圃場を登録")), /*#__PURE__*/React.createElement("section", {
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
  }, "まだ圃場が登録されていません。上のフォームから登録してください。"), fieldGroups.map(g => /*#__PURE__*/React.createElement(React.Fragment, {
    key: "zone:" + g.name
  }, /*#__PURE__*/React.createElement("div", {
    style: S.zoneHead
  }, g.name, /*#__PURE__*/React.createElement("span", {
    style: S.zoneCount,
    className: "num"
  }, g.items.length, "圃場")), g.items.map(f => /*#__PURE__*/React.createElement("div", {
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
  }, f.areaA ? dispArea(f.areaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "面積未定")), /*#__PURE__*/React.createElement("button", {
    onClick: () => startEdit(f),
    style: S.smallSecondary
  }, "編集"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("圃場「" + f.name + "」を削除しますか？\n(過去の記録は残ります)")) p.deleteField(f.id);
    },
    style: S.smallDanger
  }, "削除"))))))), sub === "chem" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
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
  }, "削除"))))));
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
// 衛星写真の上でも地図タイルの上でも埋もれないよう蛍光イエローにし、
// 中の作物が見えるように塗りは薄めで輪郭を強くしてある。
const FIELD_COLOR = {
  stroke: "#9A8B00",
  fill: "#FFF200",
  opacity: 0.35
};

// 地図タブの圃場一覧。Google版・Leaflet版で中身が同じなので共通化してある。
// 地区で折りたたみ、検索で絞り込み、チェックで地図の表示/非表示を切り替える。
// 圃場が数百件になっても、開いている地区のぶんしか縦に伸びない。
function MapFieldList(p) {
  const [q, setQ] = React.useState("");
  const [closed, setClosed] = React.useState([]); // 閉じている地区名
  const hidden = p.hidden || [];
  const list = q.trim() ? p.fields.filter(f => f.name.includes(q.trim()) || (f.crop || "").includes(q.trim()) || (f.area || "").includes(q.trim())) : p.fields;
  const groups = React.useMemo(() => {
    const m = new Map();
    list.forEach(f => {
      const k = (f.area || "").trim() || "未分類";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    });
    return Array.from(m.entries()).map(e => ({
      name: e[0],
      items: e[1]
    })).sort((a, b) => a.name === "未分類" ? 1 : b.name === "未分類" ? -1 : a.name.localeCompare(b.name, "ja"));
  }, [list]);
  // 検索中は畳まない(探しているものが隠れると意味がないため)
  const isOpen = name => !!q.trim() || closed.indexOf(name) < 0;
  const toggleZone = name => setClosed(closed.indexOf(name) < 0 ? [...closed, name] : closed.filter(x => x !== name));
  const setZoneVisible = (items, visible) => {
    const ids = items.map(f => f.id);
    p.setHidden(visible ? hidden.filter(id => ids.indexOf(id) < 0) : Array.from(new Set([...hidden, ...ids])));
  };
  if (p.fields.length === 0) return /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ地図上の圃場がありません。", /*#__PURE__*/React.createElement("br", null), "「✏ 圃場を囲む」で登録できます。");
  return /*#__PURE__*/React.createElement(React.Fragment, null, p.fields.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: q,
    placeholder: "🔍 圃場名・作物名・地区で検索",
    onChange: e => setQ(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 8
    }
  }), q.trim() && list.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "該当する圃場がありません。"), groups.map(g => {
    const open = isOpen(g.name);
    const shownCount = g.items.filter(f => hidden.indexOf(f.id) < 0).length;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: "zone:" + g.name
    }, /*#__PURE__*/React.createElement("div", {
      style: S.zoneHead
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => toggleZone(g.name),
      style: S.zoneToggle
    }, open ? "▼ " : "▶ ", g.name, /*#__PURE__*/React.createElement("span", {
      style: S.zoneCount,
      className: "num"
    }, " ", g.items.length, "圃場")), /*#__PURE__*/React.createElement("button", {
      onClick: () => setZoneVisible(g.items, shownCount === 0),
      style: S.zoneEye,
      title: "この地区を地図に表示/非表示"
    }, shownCount === 0 ? "🚫 非表示" : "👁 表示中")), open && g.items.map(f => {
      const off = hidden.indexOf(f.id) >= 0;
      return /*#__PURE__*/React.createElement("div", {
        key: f.id,
        style: {
          ...S.listItem,
          opacity: off ? 0.45 : 1
        }
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
      }, fmt(polygonAreaA(f.polygon), 2), " a")), /*#__PURE__*/React.createElement("button", {
        onClick: () => p.setHidden(off ? hidden.filter(id => id !== f.id) : [...hidden, f.id]),
        style: S.smallSecondary,
        title: "地図での表示を切り替え"
      }, off ? "🚫" : "👁"), /*#__PURE__*/React.createElement("button", {
        onClick: () => p.onFocus(f),
        style: S.smallSecondary
      }, "地図で見る"), /*#__PURE__*/React.createElement("a", {
        href: naviUrl(f.center || polygonCenter(f.polygon)),
        target: "_blank",
        rel: "noopener noreferrer",
        style: S.naviBtn
      }, "🚗 ナビ"));
    }));
  }));
}

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
  const [ready, setReady] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [drawPts, setDrawPts] = React.useState([]);
  const [newName, setNewName] = React.useState("");
  const [newCrop, setNewCrop] = React.useState("");
  const [newZone, setNewZone] = React.useState(""); // 作図した圃場の地区
  const [hidden, setHidden] = React.useState([]); // 地図に出さない圃場ID(この画面を開いている間だけ)
  const [listOnly, setListOnly] = React.useState(false); // 一覧だけを全画面で見るモード
  const [fullMap, setFullMap] = React.useState(false); // 地図だけを画面いっぱいに出す
  const mapWrapRef = React.useRef(null); // 地図+凡例の枠。高さを実測して決める
  // 作図はパネルが画面外に出てしまうので、始めたら全画面を解除する
  React.useEffect(() => {
    if (drawing) setFullMap(false);
  }, [drawing]);
  const [gpsOn, setGpsOn] = React.useState(false);
  const [mapType, setMapType] = React.useState("hybrid"); // hybrid=衛星+地名, roadmap=地図のみ
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const LABEL_MIN_ZOOM = 16; // これ以上に拡大すると圃場名・作物・面積の札を出す
  const [zoom, setZoom] = React.useState(15);
  const drawArea = polygonAreaA(drawPts);
  const drawCrossed = polygonSelfIntersects(drawPts);
  const [selPt, setSelPt] = React.useState(-1); // 選択中の頂点。-1=未選択
  const [histLen, setHistLen] = React.useState(0); // 「1つ戻す」の有効判定に使う
  const selPtRef = React.useRef(-1);
  const histRef = React.useRef([]); // 作図中だけ持つ操作履歴(変更前のdrawPtsを積む)
  const draggingRef = React.useRef(false); // ドラッグ中は再描画しない(掴んだマーカーが消えるため)
  const lastEditAtRef = React.useRef(0); // 直前の頂点操作の時刻。地図のclickに化けた分を弾く
  const dragBeforeRef = React.useRef(null); // ドラッグ開始時の頂点配列(履歴に積む「変更前」)
  const drawLineRef = React.useRef(null); // 作図中の線。ドラッグ中に直接書き換える
  const drawFillRef = React.useRef(null); // 作図中の面。同上
  // 頂点編集を1手として確定する。履歴には「変更前」を積む
  const commitPts = (next, opt) => {
    const o = opt || {};
    const prev = o.prev || drawPtsRef.current;
    histRef.current = pushDrawHistory(histRef.current, prev);
    setHistLen(histRef.current.length);
    drawPtsRef.current = next;
    setDrawPts(next);
    // 頂点の並びが変わると番号もずれるので、既定では選択を解除する
    const sel = typeof o.select === "number" ? o.select : -1;
    selPtRef.current = sel;
    setSelPt(sel);
  };
  // 頂点は変えず選択だけ切り替える。編集ではないので履歴には積まない
  const selectPt = i => {
    selPtRef.current = i;
    setSelPt(i);
  };
  const removePt = i => {
    if (i < 0 || i >= drawPtsRef.current.length) return;
    commitPts(ptsRemove(drawPtsRef.current, i));
  };
  // 全消し・作図開始・やめる で使う。履歴も選択も落とす
  const resetDrawState = () => {
    histRef.current = [];
    setHistLen(0);
    drawPtsRef.current = [];
    setDrawPts([]);
    selPtRef.current = -1;
    setSelPt(-1);
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
  // ドラッグ中に線と面だけを追従させる(マーカーは作り直さない)
  const refreshDrawShapes = () => {
    const pts = drawPtsRef.current;
    const toLL = a => ({
      lat: a[0],
      lng: a[1]
    });
    if (drawLineRef.current) drawLineRef.current.setPath((pts.length >= 3 ? [...pts, pts[0]] : pts).map(toLL));
    if (drawFillRef.current) drawFillRef.current.setPaths(pts.map(toLL));
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

  // Google Maps APIを読み込んで地図を初期化
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
        maxZoom: 21
      });
      mapRef.current = map;
      map.addListener("click", e => {
        if (!drawingRef.current || draggingRef.current) return;
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
  }, []);

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
        p.onPickField && p.onPickField(f);
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
            text: f.name + (f.crop ? "/" + f.crop : "") + " " + fmt(polygonAreaA(f.polygon), 2) + "a",
            color: "#fff",
            fontSize: "12px",
            fontWeight: "700",
            className: "gm-field-label"
          }
        });
        fieldOverlaysRef.current.push(label);
      }
    });
  }, [ready, p.fields, zoom, hidden]);

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
      // 頂点(ドラッグで移動・タップで選択・選択中の✕タップで削除)
      drawPts.forEach((pt, i) => {
        const sel = i === selPt;
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
            fontSize: sel ? "15px" : "13px"
          },
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: sel ? "#8a2f1c" : "#C74E36",
            fillOpacity: 1,
            strokeColor: sel ? "#FFD9CF" : "#fff",
            strokeWeight: 2.5
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
          if (selPtRef.current === i) removePt(i);else selectPt(i);
        });
        drawOverlaysRef.current.push(marker);
      });
      // 辺の中点ハンドル(頂点より小さく薄い。タップかドラッグで頂点を挿入)
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
            scale: 8,
            fillColor: "#C74E36",
            fillOpacity: 0.45,
            strokeColor: "#fff",
            strokeWeight: 2,
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
        handle.addListener("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
          commitPts(ptsInsert(drawPtsRef.current, mp.edge, mp.lat, mp.lng));
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
  }, [ready, drawPts, selPt]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    resetDrawState();
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    resetDrawState();
    setNewName("");
    setNewCrop("");
    setNewZone("");
  };
  // 追加・移動・削除・挿入をまとめて1手ずつ戻す
  const undoPt = () => {
    if (histRef.current.length === 0) return;
    const prev = histRef.current[histRef.current.length - 1];
    histRef.current = histRef.current.slice(0, -1);
    setHistLen(histRef.current.length);
    drawPtsRef.current = prev;
    setDrawPts(prev);
    selPtRef.current = -1;
    setSelPt(-1);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    // ねじれたまま登録すると面積が実際より小さく出るので、ここで止める
    if (polygonSelfIntersects(drawPts)) {
      p.flash && p.flash("線が交差しています。頂点を動かしてねじれを直してください");
      return;
    }
    const center = polygonCenter(drawPts);
    const areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    p.addFieldWithPolygon({
      name: newName.trim(),
      crop: newCrop.trim(),
      area: newZone.trim(),
      areaA,
      polygon: drawPts,
      center
    });
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    cancelDraw();
  };
  // 地図を画面の残り全部に広げる。上に何が積まれているか(見出し・ボタン列・
  // 切替タブ)は状態で変わるので、固定値ではなく実際の位置から測って決める。
  // これをやらないと画面をスクロールしないと地図の下半分が見えない。
  React.useLayoutEffect(() => {
    const fit = () => {
      const el = mapWrapRef.current;
      if (!el || listOnly) return;
      const nav = document.querySelector("nav");
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      if (fullMap) {
        // position:fixed で画面全体を覆っているので高さは指定しない
        el.style.height = "";
        if (mapRef.current && window.google) window.google.maps.event.trigger(mapRef.current, "resize");
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
      if (mapRef.current && window.google) window.google.maps.event.trigger(mapRef.current, "resize");
    };
    fit();
    // 端末の回転・ブラウザのアドレスバーの出入りでも測り直す
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [listOnly, drawing, ready, fullMap]);
  // display:none の間はサイズを取れないので、地図に戻したら測り直させる
  React.useEffect(() => {
    if (listOnly || !mapRef.current || !window.google) return;
    const t = setTimeout(() => {
      if (mapRef.current) window.google.maps.event.trigger(mapRef.current, "resize");
    }, 60);
    return () => clearTimeout(t);
  }, [listOnly]);
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
  const polyFields = p.fields.filter(f => f.polygon && f.polygon.length >= 3);
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
  }, "📋 一覧")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, !listOnly && !drawing && /*#__PURE__*/React.createElement("button", {
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
  }, "やめる"))), status === "loading" && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "Google マップを読み込んでいます…"), status === "error" && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "Google マップを読み込めませんでした。APIキーやインターネット接続を確認してください。"), /*#__PURE__*/React.createElement("div", {
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
  }), fullMap && /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(false),
    style: S.mapFullExit
  }, "✕ 全画面をやめる")), drawing && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "地図をタップして圃場の角を順に打ちます(3点以上)。頂点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "、", /*#__PURE__*/React.createElement("strong", null, "タップして✕で削除"), "。辺の中点にある小さな丸を", /*#__PURE__*/React.createElement("strong", null, "タップかドラッグ"), "すると頂点を足せます。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", null, fmt(drawCrossed ? 0 : drawArea, 2)), " a"), drawCrossed && /*#__PURE__*/React.createElement("div", {
    style: S.drawWarn
  }, "⚠ 線が交差しています。このままでは面積を正しく計算できないため登録できません。頂点をドラッグしてねじれを直すか、「↩ 1つ戻す」で戻してください。"), selPt >= 0 && selPt < drawPts.length && /*#__PURE__*/React.createElement("div", {
    style: S.selPtRow
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "頂点 ", selPt + 1, " を選択中"), /*#__PURE__*/React.createElement("button", {
    onClick: () => removePt(selPt),
    style: S.smallDanger
  }, "✕ この頂点を削除"), /*#__PURE__*/React.createElement("button", {
    onClick: () => selectPt(-1),
    style: S.smallSecondary
  }, "選択をやめる")), /*#__PURE__*/React.createElement("div", {
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
  }, drawCrossed ? "⚠ 線の交差を直してください" : "この圃場を登録(" + fmt(drawArea, 2) + " a)"))), listOnly && /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "地図に登録された圃場(", polyFields.length, "件)"), /*#__PURE__*/React.createElement(MapFieldList, {
    fields: polyFields,
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
  })));
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
  const [hidden, setHidden] = React.useState([]); // 地図に出さない圃場ID(この画面を開いている間だけ)
  const [listOnly, setListOnly] = React.useState(false); // 一覧だけを全画面で見るモード
  const [fullMap, setFullMap] = React.useState(false); // 地図だけを画面いっぱいに出す
  const mapWrapRef = React.useRef(null); // 地図+凡例の枠。高さを実測して決める
  // 作図はパネルが画面外に出てしまうので、始めたら全画面を解除する
  React.useEffect(() => {
    if (drawing) setFullMap(false);
  }, [drawing]);
  const [gpsOn, setGpsOn] = React.useState(false);
  const [zoom, setZoom] = React.useState(15);
  const [tileMode, setTileMode] = React.useState("photo"); // "photo" | "map"
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const drawArea = polygonAreaA(drawPts);
  const drawCrossed = polygonSelfIntersects(drawPts);
  const LABEL_MIN_ZOOM = 16; // これ以上に拡大すると圃場名・作物・面積の札を出す
  const [selPt, setSelPt] = React.useState(-1); // 選択中の頂点。-1=未選択
  const [histLen, setHistLen] = React.useState(0); // 「1つ戻す」の有効判定に使う
  const selPtRef = React.useRef(-1);
  const histRef = React.useRef([]); // 作図中だけ持つ操作履歴(変更前のdrawPtsを積む)
  const draggingRef = React.useRef(false); // ドラッグ中は再描画しない(掴んだマーカーが消えるため)
  const lastEditAtRef = React.useRef(0); // 直前の頂点操作の時刻。地図のclickに化けた分を弾く
  const dragBeforeRef = React.useRef(null); // ドラッグ開始時の頂点配列(履歴に積む「変更前」)
  const drawLineRef = React.useRef(null); // 作図中の線。ドラッグ中に直接書き換える
  const drawFillRef = React.useRef(null); // 作図中の面。同上
  // 頂点編集を1手として確定する。履歴には「変更前」を積む
  const commitPts = (next, opt) => {
    const o = opt || {};
    const prev = o.prev || drawPtsRef.current;
    histRef.current = pushDrawHistory(histRef.current, prev);
    setHistLen(histRef.current.length);
    drawPtsRef.current = next;
    setDrawPts(next);
    // 頂点の並びが変わると番号もずれるので、既定では選択を解除する
    const sel = typeof o.select === "number" ? o.select : -1;
    selPtRef.current = sel;
    setSelPt(sel);
  };
  // 頂点は変えず選択だけ切り替える。編集ではないので履歴には積まない
  const selectPt = i => {
    selPtRef.current = i;
    setSelPt(i);
  };
  const removePt = i => {
    if (i < 0 || i >= drawPtsRef.current.length) return;
    commitPts(ptsRemove(drawPtsRef.current, i));
  };
  // 全消し・作図開始・やめる で使う。履歴も選択も落とす
  const resetDrawState = () => {
    histRef.current = [];
    setHistLen(0);
    drawPtsRef.current = [];
    setDrawPts([]);
    selPtRef.current = -1;
    setSelPt(-1);
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
  // ドラッグ中に線と面だけを追従させる(マーカーは作り直さない)
  const refreshDrawShapes = () => {
    const pts = drawPtsRef.current;
    if (drawLineRef.current) drawLineRef.current.setLatLngs(pts.length >= 3 ? [...pts, pts[0]] : pts);
    if (drawFillRef.current) drawFillRef.current.setLatLngs(pts);
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
    map: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
      maxNative: 19
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
        const labelText = escapeHtml(f.name) + (f.crop ? " / " + escapeHtml(f.crop) : "") + " / " + fmt(polygonAreaA(f.polygon), 2) + " a";
        poly.bindTooltip(labelText, {
          permanent: true,
          direction: "center",
          className: "field-label"
        });
      }
      poly.on("click", () => {
        p.onPickField && p.onPickField(f);
      });
    });
  }, [ready, p.fields, zoom, hidden]);

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
      // 頂点(ドラッグで移動・タップで選択・選択中の✕タップで削除)
      drawPts.forEach((pt, i) => {
        const sel = i === selPt;
        const icon = L.divIcon({
          className: "vtx-icon",
          html: '<div class="vtx' + (sel ? " vtx-sel" : "") + '">' + escapeHtml(sel ? "✕" : String(i + 1)) + '</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
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
          if (selPtRef.current === i) removePt(i);else selectPt(i);
        });
      });
      // 辺の中点ハンドル(頂点より小さく薄い。タップかドラッグで頂点を挿入)
      drawMidpoints(drawPts).forEach(mp => {
        const icon = L.divIcon({
          className: "vtx-icon",
          html: '<div class="vtx-mid"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
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
        h.on("click", () => {
          if (moved) return;
          lastEditAtRef.current = Date.now();
          commitPts(ptsInsert(drawPtsRef.current, mp.edge, mp.lat, mp.lng));
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
  }, [ready, drawPts, selPt]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    resetDrawState();
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    resetDrawState();
    setNewName("");
    setNewCrop("");
    setNewZone("");
  };
  // 追加・移動・削除・挿入をまとめて1手ずつ戻す
  const undoPt = () => {
    if (histRef.current.length === 0) return;
    const prev = histRef.current[histRef.current.length - 1];
    histRef.current = histRef.current.slice(0, -1);
    setHistLen(histRef.current.length);
    drawPtsRef.current = prev;
    setDrawPts(prev);
    selPtRef.current = -1;
    setSelPt(-1);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    // ねじれたまま登録すると面積が実際より小さく出るので、ここで止める
    if (polygonSelfIntersects(drawPts)) {
      p.flash && p.flash("線が交差しています。頂点を動かしてねじれを直してください");
      return;
    }
    const center = polygonCenter(drawPts);
    const areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    p.addFieldWithPolygon({
      name: newName.trim(),
      crop: newCrop.trim(),
      area: newZone.trim(),
      areaA,
      polygon: drawPts,
      center
    });
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    cancelDraw();
  };

  // 地図を画面の残り全部に広げる。上に何が積まれているか(見出し・ボタン列・
  // 切替タブ)は状態で変わるので、固定値ではなく実際の位置から測って決める。
  // これをやらないと画面をスクロールしないと地図の下半分が見えない。
  React.useLayoutEffect(() => {
    const fit = () => {
      const el = mapWrapRef.current;
      if (!el || listOnly) return;
      const nav = document.querySelector("nav");
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      if (fullMap) {
        // position:fixed で画面全体を覆っているので高さは指定しない
        el.style.height = "";
        if (mapRef.current) mapRef.current.invalidateSize();
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
      if (mapRef.current) mapRef.current.invalidateSize();
    };
    fit();
    // 端末の回転・ブラウザのアドレスバーの出入りでも測り直す
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [listOnly, drawing, ready, fullMap]);
  // display:none の間はサイズを取れないので、地図に戻したら測り直させる
  React.useEffect(() => {
    if (listOnly || !mapRef.current) return;
    const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [listOnly]);

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
  const polyFields = p.fields.filter(f => f.polygon && f.polygon.length >= 3);
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
  }, "📋 一覧")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, !listOnly && !drawing && /*#__PURE__*/React.createElement("button", {
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
  }, "やめる"))), !window.L && /*#__PURE__*/React.createElement("p", {
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
  }), fullMap && /*#__PURE__*/React.createElement("button", {
    onClick: () => setFullMap(false),
    style: S.mapFullExit
  }, "✕ 全画面をやめる")), drawing && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "地図をタップして圃場の角を順に打ちます(3点以上)。頂点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "、", /*#__PURE__*/React.createElement("strong", null, "タップして✕で削除"), "。辺の中点にある小さな丸を", /*#__PURE__*/React.createElement("strong", null, "タップかドラッグ"), "すると頂点を足せます。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", null, fmt(drawCrossed ? 0 : drawArea, 2)), " a"), drawCrossed && /*#__PURE__*/React.createElement("div", {
    style: S.drawWarn
  }, "⚠ 線が交差しています。このままでは面積を正しく計算できないため登録できません。頂点をドラッグしてねじれを直すか、「↩ 1つ戻す」で戻してください。"), selPt >= 0 && selPt < drawPts.length && /*#__PURE__*/React.createElement("div", {
    style: S.selPtRow
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "頂点 ", selPt + 1, " を選択中"), /*#__PURE__*/React.createElement("button", {
    onClick: () => removePt(selPt),
    style: S.smallDanger
  }, "✕ この頂点を削除"), /*#__PURE__*/React.createElement("button", {
    onClick: () => selectPt(-1),
    style: S.smallSecondary
  }, "選択をやめる")), /*#__PURE__*/React.createElement("div", {
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
  }, drawCrossed ? "⚠ 線の交差を直してください" : "この圃場を登録(" + fmt(drawArea, 2) + " a)"))), listOnly && /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "地図に登録された圃場(", polyFields.length, "件)"), /*#__PURE__*/React.createElement(MapFieldList, {
    fields: polyFields,
    hidden: hidden,
    setHidden: setHidden,
    onFocus: f => {
      setListOnly(false);
      if (mapRef.current && f.center) mapRef.current.setView(f.center, 16);
    }
  })));
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
  const [openSec, setOpenSec] = useState({});
  const toggleSec = key => setOpenSec(s => ({
    ...s,
    [key]: !s[key]
  }));
  const [openVer, setOpenVer] = useState({});
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
  }, collapsibleHead("送信・共有設定", openSec.send, () => toggleSec("send")), openSec.send && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
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
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: p.testConnection,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 12
    }
  }, "接続テスト"), /*#__PURE__*/React.createElement("div", {
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
    style: S.note
  }, "同じチームコードの端末どうしで、圃場・薬剤・作業リストを共有できます(後から保存した内容で上書き)。共有がうまくいかない場合は、GASを最新のCode.gsに更新して再デプロイしてください。"))), /*#__PURE__*/React.createElement("section", {
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
  }, "Google Maps APIキー"), /*#__PURE__*/React.createElement("input", {
    value: p.gmapKeyInput,
    onChange: e => p.setGmapKeyInput(e.target.value),
    placeholder: "AIzaSy...",
    style: {
      ...S.fieldInput,
      marginTop: 6,
      fontFamily: "monospace",
      fontSize: 14
    },
    autoCapitalize: "off",
    autoCorrect: "off",
    autoComplete: "off",
    spellCheck: false
  }), /*#__PURE__*/React.createElement("button", {
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
    desc: "衛星写真上で圃場を囲んで登録できます。地図エンジンは設定タブで「無料地図(Leaflet)」と「Google マップ」を切り替えられます(既定は無料地図)。どちらで登録した圃場も共通のデータとして扱われ、エンジンを切り替えても圃場は消えません。「✏ 圃場を囲む」を押してから地図をタップすると頂点が打たれ、打った点はドラッグで位置調整できます。頂点をタップすると「✕」に変わり、もう一度タップするとその頂点だけを削除できます(作図パネルの「✕ この頂点を削除」でも消せます)。頂点と頂点の間に出る小さな丸をタップまたはドラッグすると、その辺の途中に頂点を足せるので、四角形以外の形も囲めます。「↩ 1つ戻す」は追加・移動・削除・挿入を1手ずつ戻せます。3点以上打つと面積が自動計算されます。圃場名を入力して「この圃場を登録」で保存するとデータベースの圃場マスタにも自動登録されます。無料地図では国土地理院の衛星写真とOpenStreetMapの道路・地名地図を、Googleマップでは衛星写真と道路・地名を同時表示(hybrid)と地図表示を切り替えられます。「📍 現在地」でGPS位置を地図に表示できます。PC・タブレットでは地図がフルワイドで大きく表示されます。「🚗 ナビ」でGoogleマップアプリのナビが起動します。登録済みの圃場は蛍光イエローで表示されます。衛星写真の上でも地図タイルの上でも埋もれず、中の作物が見えるように塗りは薄めで輪郭を強くしてあります。拡大すると圃場名・作物名・面積の札が出ます。地図は画面の縦幅いっぱいに自動で広がるので、スクロールせずに全体を見られます。「⛶」を押すと見出しやタブバーも隠して完全な全画面になり、「✕ 全画面をやめる」で戻ります。圃場の一覧は上の「📋 一覧」に切り替えると出ます。一覧は地区ごとに折りたためて検索もでき、見出しの「👁 表示中」を押すとその地区を地図から一時的に消せます(端末には保存されず、タブを離れると元に戻ります)。各行の👁でも1圃場ずつ切り替えられます。Googleマップを使うには設定タブでAPIキーの登録が必要です。"
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
    ver: "v8.35",
    date: "2026-08",
    isNew: true,
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
  routeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 6,
    background: "#fff",
    border: "1.5px solid #2E7D4F",
    borderRadius: 10
  },
  routeNum: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "#2E7D4F",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    WebkitUserSelect: "none",
    userSelect: "none"
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
  subTabWrap: {
    display: "flex",
    gap: 6,
    background: "#EDF1EA",
    borderRadius: 11,
    padding: 4,
    marginBottom: 2
  },
  subTab: {
    flex: 1,
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 800,
    border: "none",
    background: "transparent",
    color: "#66756a",
    borderRadius: 8,
    cursor: "pointer"
  },
  subTabOn: {
    background: "#fff",
    color: "#1C2B21",
    boxShadow: "0 1px 4px rgba(0,0,0,0.12)"
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
  nextBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(58px + env(safe-area-inset-bottom))",
    zIndex: 840,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "#1C2B21",
    color: "#fff",
    boxShadow: "0 -3px 14px rgba(0,0,0,0.22)"
  },
  nextBarLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "#B9C3B4",
    letterSpacing: "0.04em"
  },
  nextBarName: {
    fontSize: 16.5,
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  nextBarBtn: {
    flexShrink: 0,
    padding: "13px 18px",
    minHeight: 48,
    fontSize: 15.5,
    fontWeight: 800,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 10,
    cursor: "pointer"
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
  selPtRow: {
    marginTop: 8,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8
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
