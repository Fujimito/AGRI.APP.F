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

const APP_VERSION = "v8.20";
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
// スマホの地図アプリでナビを開くURL(現在地→目的地)
const naviUrl = center => center ? "https://www.google.com/maps/dir/?api=1&destination=" + center[0] + "," + center[1] + "&travelmode=driving" : "#";
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
          id: Date.now() + Math.floor(Math.random() * 100000),
          name: r.field || "(未入力)",
          crop: r.crop || "",
          areaA: r.areaA || "",
          plannedL: r.plannedL || 0
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
          areaA: f.areaA,
          plannedL: f.plannedL
        },
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
  const [targetIds, setTargetIds] = useState([]);
  const [fields, setFields] = useState(() => load("tankmix:fields", []));
  const [works, setWorks] = useState(() => load("tankmix:works", []));
  const [chemMaster, setChemMaster] = useState(() => load("tankmix:chemmaster", []));
  const [lastMix, setLastMix] = useState(() => load("tankmix:lastmix", null));
  const [presets, setPresets] = useState(() => load("tankmix:presets", []));
  const [routes, setRoutes] = useState(() => load("tankmix:routes", []));
  const [crops, setCrops] = useState(() => load("tankmix:crops", []));
  const [workDate, setWorkDate] = useState(today());
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
  const setVolUnitKey = v => {
    setVolUnitKeyState(v);
    localStorage.setItem("tankmix:volunit", v);
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
  const setRoutesSave = next => {
    setRoutes(next);
    save("tankmix:routes", next);
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
  const resolveWork = w => {
    if (w.isGroup) return {
      name: w.fieldName,
      crop: "",
      areaA: w.areaA,
      plannedL: 0
    };
    const f = fields.find(x => x.id === w.fieldId);
    return f || w.snapshot || {
      name: "(不明)",
      crop: "",
      areaA: "",
      plannedL: 0
    };
  };
  const upsertField = (data, id) => {
    if (id) {
      setFieldsSave(fields.map(f => f.id === id ? {
        ...f,
        ...data
      } : f));
      setWorksSave(works.map(w => w.fieldId === id && !w.reported ? {
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
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: data.name,
      crop: data.crop || "",
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
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: data.name,
      crop: data.crop || "",
      areaA: data.areaA
    }]);
    flash("圃場「" + data.name + "」を登録しました");
  };
  // 地図で囲んだ圃場(ポリゴン・中心座標つき)を登録
  const addFieldWithPolygon = data => {
    setFieldsSave([...fields, {
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: data.name,
      crop: data.crop || "",
      areaA: data.areaA,
      polygon: data.polygon,
      center: data.center
    }]);
    flash("圃場「" + data.name + "」を地図に登録しました(" + fmt(data.areaA, 2) + "a)");
  };
  const makeWork = f => ({
    id: Date.now() + Math.floor(Math.random() * 1000),
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
  const addNewFieldAndWork = data => {
    let f = fields.find(x => x.name === data.name);
    if (!f) {
      f = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: data.name,
        crop: data.crop || "",
        areaA: data.areaA,
        plannedL: data.plannedL
      };
      setFieldsSave([...fields, f]);
    } else {
      flash("同名の圃場がマスタにあるため、そちらを使います");
    }
    if (works.some(w => w.workDate === workDate && w.fieldId === f.id && !w.reported)) {
      flash("この圃場は既にこの日のリストにあります");
      return null;
    }
    const w = makeWork(f);
    setWorksSave([...works, w]);
    return w.id;
  };
  const removeWork = id => setWorksSave(works.filter(w => w.id !== id));

  // ══ 圃場コース(ルート・プリセット) ══
  // 現在の作業リスト(この日ぶん)をコースとして保存
  const saveRouteFromToday = () => {
    const day = works.filter(w => w.workDate === workDate && !w.reported);
    if (day.length === 0) {
      flash("この日の作業リストが空です");
      return;
    }
    const name = prompt("コース名を入力してください(例:月曜ルート)", "");
    if (!name) return;
    const fieldIds = day.map(w => w.fieldId).filter(id => fields.some(f => f.id === id));
    if (fieldIds.length === 0) {
      flash("登録できる圃場がありません");
      return;
    }
    setRoutesSave([{
      id: Date.now(),
      name: name.trim(),
      fieldIds
    }, ...routes]);
    flash("コース「" + name.trim() + "」を保存しました(" + fieldIds.length + "圃場)");
  };
  // 任意の圃場IDリストからコースを作成
  const createRoute = (name, fieldIds) => {
    if (!name || fieldIds.length === 0) return;
    setRoutesSave([{
      id: Date.now(),
      name,
      fieldIds
    }, ...routes]);
    flash("コース「" + name + "」を保存しました");
  };
  const deleteRoute = id => setRoutesSave(routes.filter(r => r.id !== id));
  const renameRoute = (id, name) => setRoutesSave(routes.map(r => r.id === id ? {
    ...r,
    name
  } : r));
  const updateRoute = (id, name, fieldIds) => setRoutesSave(routes.map(r => r.id === id ? {
    ...r,
    name: name || r.name,
    fieldIds
  } : r));

  // コースを選んだ日の作業リストへ一括投入(順番を保持、重複はスキップ)
  const applyRoute = routeId => {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    let added = 0;
    let skipped = 0;
    const toAdd = [];
    route.fieldIds.forEach(fid => {
      const f = fields.find(x => x.id === fid);
      if (!f) return;
      if (works.some(w => w.workDate === workDate && w.fieldId === fid && !w.reported)) {
        skipped++;
        return;
      }
      toAdd.push(makeWork(f));
      added++;
    });
    if (toAdd.length > 0) setWorksSave([...works, ...toAdd]);
    flash("コースを投入:" + added + "圃場追加" + (skipped > 0 ? "(" + skipped + "件は既存)" : ""));
  };

  // 薬剤(プリセット/前回薬液)を1圃場に適用。各圃場の予定薬液量で薬量を自動計算
  const applyChemsToWork = (workId, chemList) => {
    if (!chemList || chemList.length === 0) {
      flash("薬剤が選ばれていません");
      return;
    }
    setWorksSave(works.map(w => {
      if (w.id !== workId) return w;
      const per = parseFloat(w.plannedL) > 0 ? parseFloat(w.plannedL) : 0;
      const perMl = per * 1000;
      const scaled = chemList.map(c => ({
        name: c.name || "(無名)",
        form: c.form,
        use: c.use || "other",
        ratio: c.ratio,
        ml: parseFloat(c.ratio) > 0 ? perMl / parseFloat(c.ratio) : 0
      }));
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
      use: c.use || "other",
      ratio: c.ratio,
      ml: 0
    })));
    flash("薬剤を適用しました");
  };
  // 薬剤をその日の全圃場に一括適用(各圃場の予定薬液量で自動計算)
  const applyChemsToAll = chemList => {
    if (!chemList || chemList.length === 0) {
      flash("薬剤が選ばれていません");
      return;
    }
    const dayIds = works.filter(w => w.workDate === workDate && !w.reported).map(w => w.id);
    if (dayIds.length === 0) {
      flash("この日の作業リストが空です");
      return;
    }
    setWorksSave(works.map(w => {
      if (!dayIds.includes(w.id)) return w;
      const per = parseFloat(w.plannedL) > 0 ? parseFloat(w.plannedL) : 0;
      const perMl = per * 1000;
      const scaled = chemList.map(c => ({
        name: c.name || "(無名)",
        form: c.form,
        use: c.use || "other",
        ratio: c.ratio,
        ml: parseFloat(c.ratio) > 0 ? perMl / parseFloat(c.ratio) : 0
      }));
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
      use: c.use || "other",
      ratio: c.ratio,
      ml: 0
    })));
    flash(dayIds.length + "圃場すべてに薬剤を適用しました");
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
      const planned = Math.round(area / 10 * rate * 100) / 100;
      updated++;
      return {
        ...w,
        plannedL: planned
      };
    }));
    flash(updated + "圃場の予定薬液量を計算しました" + (noArea > 0 ? "(面積未入力 " + noArea + "件は対象外)" : ""));
  };
  const moveWork = (id, dir) => {
    const visible = works.filter(w => w.workDate === workDate && !w.reported).map(w => w.id);
    const vi = visible.indexOf(id);
    const vj = vi + dir;
    if (vi < 0 || vj < 0 || vj >= visible.length) return;
    const otherId = visible[vj];
    const i = works.findIndex(w => w.id === id);
    const j = works.findIndex(w => w.id === otherId);
    const next = [...works];
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    setWorksSave(next);
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
    // この日の作業を新しい順序で、他の日の作業はそのまま再構成
    const others = works.filter(w => !(w.workDate === workDate && !w.reported));
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
  const effTotalL = mode === "direct" ? parseFloat(totalL) || 0 : (parseFloat(areaA) || 0) / 10 * (parseFloat(ratePer10a) || 0);
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
    const m = chemMaster.find(x => x.name === name);
    setChems(chems.map(c => c.id === id ? m ? {
      ...c,
      name,
      form: m.form,
      use: m.use || c.use,
      ratio: String(m.ratio || "")
    } : {
      ...c,
      name
    } : c));
  };
  const addChem = () => setChems([...chems, newChem()]);
  const removeChem = id => setChems(chems.filter(c => c.id !== id));

  // 圃場の選択をトグル(複数選択可)。最初の1件選択時は予定薬液量を総量に反映
  const togglePlan = id => {
    const nid = Number(id);
    if (targetIds.includes(nid)) {
      setTargetIds(targetIds.filter(x => x !== nid));
    } else {
      const w = works.find(x => x.id === nid);
      if (targetIds.length === 0 && w) {
        if (parseFloat(w.plannedL) > 0) {
          setMode("direct");
          setTotalL(String(w.plannedL));
        }
      }
      setTargetIds([...targetIds, nid]);
    }
  };
  const clearPlans = () => setTargetIds([]);
  const upsertChemMaster = list => {
    let next = [...chemMaster];
    list.forEach(c => {
      if (!c.name || c.name === "(無名)") return;
      const i = next.findIndex(x => x.name === c.name);
      const item = {
        name: c.name,
        form: c.form,
        use: c.use || "other",
        ratio: parseFloat(c.ratio) || 0
      };
      if (i >= 0) next[i] = item;else next.push(item);
    });
    setChemMasterSave(next);
  };
  const saveRecord = () => {
    const chemsData = calc.filter(c => c.valid).map(c => ({
      name: c.name || "(無名)",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio,
      ml: c.ml
    }));
    if (chemsData.length === 0) {
      flash("薬剤を入力してください");
      return;
    }
    upsertChemMaster(chemsData);
    // 前回調合として保存(作業タブの「前回と同じ薬液」で呼び出せる)
    const mixSnap = calc.filter(c => c.valid).map(c => ({
      name: c.name || "",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio
    }));
    setLastMix(mixSnap);
    save("tankmix:lastmix", mixSnap);
    flash("この薬液を控えました。作業タブの「前回と同じ薬液」で圃場に適用できます");
    setTab("work");
  };
  const submitReport = (id, rep) => {
    const flights = Array.isArray(rep.flights) ? rep.flights.filter(f => f > 0) : [];
    const next = works.map(w => w.id === id ? {
      ...w,
      reported: true,
      reportSynced: false,
      sprayedL: parseFloat(rep.sprayedL) || 0,
      flights: flights,
      reportAreaA: rep.areaA !== "" ? parseFloat(rep.areaA) || "" : resolveWork(w).areaA || "",
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
    const next = works.map(w => {
      const idx = ids.indexOf(w.id);
      if (idx < 0) return w;
      const f = resolveWork(w);
      return {
        ...w,
        reported: true,
        reportSynced: false,
        sprayedL: shares[idx],
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
    // 送信対象(未送信のもの)
    const pendingList = current.filter(w => !w.groupedInto && (!w.synced || w.reported && !w.reportSynced));
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
      routes,
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
        if (data.fields) setFieldsSave(data.fields);
        if (data.works) setWorksSave(data.works);
        if (data.chemMaster) setChemMasterSave(data.chemMaster);
        if (data.presets) setPresetsSave(data.presets);
        if (data.routes) setRoutesSave(data.routes);
        if (data.crops) setCropsSave(data.crops);
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
    const name = prompt("プリセット名を入力してください", "調合セット");
    if (!name) return;
    setPresetsSave([{
      id: Date.now(),
      name,
      chems: chems.map(c => ({
        name: c.name,
        form: c.form,
        use: c.use || "other",
        ratio: c.ratio
      }))
    }, ...presets]);
    flash("プリセットを保存しました");
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
    const plain = (n, d = 2) => isFinite(n) && n !== "" ? Number(n).toFixed(d).replace(/\.?0+$/, "") : "";
    const head = "散布日,圃場,作物,面積(a),薬剤数,薬剤内容,総量(L),水量(L),実散布量(L),フライト数,フライト内訳,状態,報告日,備考\n";
    const body = works.filter(w => !w.groupedInto).map(w => {
      const f = resolveWork(w);
      const chemsStr = w.chems.map(c => c.name + "(" + useLabel(c.use) + "・" + formLabel(c.form) + "・" + c.ratio + "倍・" + Math.round(c.ml) + "mL)").join(" / ");
      const flights = w.flights || [];
      const flightStr = flights.length > 1 ? flights.map(fl => plain(fl, 1) + "L").join(" + ") : "";
      return [w.workDate, f.name, f.crop || "", plain(parseFloat(w.reportAreaA || f.areaA), 2), w.chems.length, chemsStr, plain(w.totalL), plain(w.waterMl / 1000, 3), w.reported ? plain(w.sprayedL) : "", w.reported ? flights.length || (w.reported ? 1 : "") : "", flightStr, w.reported ? "散布済" : "調合のみ", w.reportDate || "", (w.reportMemo || w.memo || "").replace(/[,\n]/g, " ")].join(",");
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
  const planOptions = works.filter(w => w.workDate === workDate && !w.reported && w.chems.length === 0);

  // 農薬使用回数警告(同圃場×同農薬の使用回数をカウント、デフォルト上限3回)
  const CHEM_LIMIT_DEFAULT = 3;
  const chemWarnings = React.useMemo(() => {
    const counts = {};
    works.filter(w => w.reported).forEach(w => {
      const f = resolveWork(w);
      (w.chems || []).forEach(c => {
        const key = f.name + "||" + c.name;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    const warnings = [];
    Object.entries(counts).forEach(([key, count]) => {
      const limit = CHEM_LIMIT_DEFAULT;
      if (count >= limit - 1) {
        const [fieldName, chemName] = key.split("||");
        warnings.push({
          fieldName,
          chemName,
          count,
          limit
        });
      }
    });
    return warnings.sort((a, b) => b.count - a.count);
  }, [works]);
  const pendingCount = works.filter(w => !w.groupedInto && (!w.synced || w.reported && !w.reportSynced)).length;

  // 電波が戻ったら自動で送信を試みる(未送信があるときだけ)
  useEffect(() => {
    const onOnline = () => {
      const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
      const pend = load("tankmix:works", []).filter(w => !w.groupedInto && (!w.synced || w.reported && !w.reportSynced)).length;
      if (url && pend > 0) syncPending();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
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
  }, APP_VERSION), pendingCount > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTab("work");
      syncPending();
    },
    style: S.headerBadge
  }, syncing ? "送信中…" : "☁ 未送信 " + pendingCount + "件")))), chemWarnings.length > 0 && /*#__PURE__*/React.createElement("div", {
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
    effTotalL,
    totalMl,
    waterMl,
    over,
    ready,
    mixOrder,
    savePreset,
    saveRecord,
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
    addNewFieldAndWork,
    removeWork,
    moveWork,
    reorderWork,
    upsertField,
    routes,
    applyRoute,
    applyRatePerDay,
    submitReport,
    submitGroupReport,
    deleteWork,
    syncPending,
    syncing,
    exportCSV,
    syncProgress,
    abortSync,
    gasUrl,
    recorder,
    presets,
    lastMix,
    applyChemsToWork,
    applyChemsToAll,
    areaUnitKey,
    volUnitKey
  }), tab === "preset" && /*#__PURE__*/React.createElement(PresetTab, {
    fields,
    upsertField,
    deleteField,
    addFieldOnly,
    routes,
    saveRouteFromToday,
    createRoute,
    deleteRoute,
    renameRoute,
    updateRoute,
    resolveWork,
    works,
    workDate,
    chemMaster,
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
    eraseAllData
  })), /*#__PURE__*/React.createElement("nav", {
    style: S.tabbar,
    className: "no-print"
  }, [["calc", "🧮", "調合"], ["work", "🚁", "作業"], ["map", "🗺", "地図"], ["preset", "📋", "プリセット"], ["settings", "⚙", "設定"]].map(t => /*#__PURE__*/React.createElement("button", {
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
      fontWeight: 700
    },
    className: "tab-label"
  }, t[2])))));
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
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
  }, "—"))))), /*#__PURE__*/React.createElement("button", {
    onClick: p.addChem,
    style: S.addBtn
  }, "＋ 薬剤を追加")), /*#__PURE__*/React.createElement("section", {
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
  }, "※ 一般的な剤型順の目安です。", /*#__PURE__*/React.createElement("strong", null, "混用可否と順序は必ず各薬剤のラベル・メーカー指示を優先"), "してください。")), /*#__PURE__*/React.createElement("div", {
    style: S.btnRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.saveRecord,
    disabled: !p.ready,
    style: {
      ...S.secondaryBtn,
      opacity: p.ready ? 1 : 0.4
    }
  }, "↩ この薬液を控える"), /*#__PURE__*/React.createElement("button", {
    onClick: p.savePreset,
    disabled: !p.ready,
    style: {
      ...S.primaryBtn,
      opacity: p.ready ? 1 : 0.4
    }
  }, "⭐ プリセットに保存")), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "薬剤の適用は「作業・記録」タブで、圃場ごと(または全圃場)に行います。")));
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
  const [repFlights, setRepFlights] = useState([""]);
  const [repArea, setRepArea] = useState("");
  const [repMemo, setRepMemo] = useState("");
  const [selected, setSelected] = useState([]);
  const [groupMode, setGroupMode] = useState(false);
  const [gSprayed, setGSprayed] = useState("");
  const [gArea, setGArea] = useState("");
  const [gMemo, setGMemo] = useState("");
  const [gFormOpen, setGFormOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [ef, setEf] = useState({
    name: "",
    crop: "",
    areaA: ""
  });
  const [ratePerDay, setRatePerDay] = useState("");
  const [chemApplyOpen, setChemApplyOpen] = useState(false);
  const [chemTargetId, setChemTargetId] = useState(null); // 個別適用の対象圃場(null=全圃場)
  const [dragId, setDragId] = useState(null); // ドラッグ中の圃場ID
  const [dragOverId, setDragOverId] = useState(null); // ドロップ先候補
  const [dragPos, setDragPos] = useState(null); // 指・ポインタの現在位置(フロートするチップの表示用)
  const dragIdRef = useRef(null);
  // 実績入力済みでも当日リストからは消さず、そのまま表示・編集できるようにする
  const dayList = p.works.filter(w => w.workDate === p.workDate);
  // 薬剤の一括適用・投下量計算など「未実施の圃場」だけを対象にすべき操作用
  const pendingDayList = dayList.filter(w => !w.reported);
  // 本日の投下量(L/10a)がまだ計算されていない圃場がある場合は警告バナーを出す
  const needsRateWarning = pendingDayList.some(w => !(parseFloat(w.plannedL) > 0));
  const history = p.works.filter(w => w.reported && !w.groupedInto).sort((a, b) => b.id - a.id);
  const pendingWorks = p.works.filter(w => !w.groupedInto && (!w.synced || w.reported && !w.reportSynced));
  const pending = pendingWorks.length;

  // ドラッグ&ドロップ並べ替え(タッチ・マウス両対応)
  const onHandleDown = (e, id) => {
    e.preventDefault();
    setDragId(id);
    dragIdRef.current = id;
    setDragOverId(id);
    const startPt = e.touches ? e.touches[0] : e;
    setDragPos({
      x: startPt.clientX,
      y: startPt.clientY
    });
    const move = ev => {
      const pt = ev.touches ? ev.touches[0] : ev;
      setDragPos({
        x: pt.clientX,
        y: pt.clientY
      });
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const row = el && el.closest ? el.closest("[data-work-id]") : null;
      if (row) {
        const overId = Number(row.getAttribute("data-work-id"));
        if (overId) setDragOverId(overId);
      }
    };
    const up = ev => {
      const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const row = el && el.closest ? el.closest("[data-work-id]") : null;
      const fromId = dragIdRef.current;
      if (row) {
        const toId = Number(row.getAttribute("data-work-id"));
        if (toId && fromId && toId !== fromId) p.reorderWork(fromId, toId);
      }
      setDragId(null);
      dragIdRef.current = null;
      setDragOverId(null);
      setDragPos(null);
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
  };
  const sumArea = pendingDayList.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0);
  const sumLiters = pendingDayList.reduce((s, w) => s + (w.totalL > 0 ? w.totalL : parseFloat(w.plannedL) || 0), 0);
  const openReport = w => {
    const f = p.resolveWork(w);
    setReportingId(w.id);
    if (w.reported) {
      // 修正:すでに保存されている実績値を復元してその場で編集する
      const flights = Array.isArray(w.flights) && w.flights.length > 0 ? w.flights.map(v => String(v)) : [String(w.sprayedL || "")];
      setRepFlights(flights);
      setRepArea(w.reportAreaA !== "" && w.reportAreaA != null ? String(w.reportAreaA) : f.areaA !== "" && f.areaA != null ? String(f.areaA) : "");
      setRepMemo(w.reportMemo || "");
    } else {
      // 初回入力は自動入力せず空欄から始める(誤入力・誤タップ防止)
      setRepFlights([""]);
      setRepArea(f.areaA !== "" && f.areaA != null ? String(f.areaA) : "");
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
      areaA: repArea,
      memo: repMemo
    });
    setReportingId(null);
    setRepFlights([""]);
  };
  const toggleSelect = id => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const openGroupForm = () => {
    const members = p.works.filter(w => selected.includes(w.id));
    setGSprayed(String(members.reduce((s, w) => s + (w.totalL || 0), 0) || ""));
    setGArea(String(members.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0) || ""));
    setGMemo("");
    setGFormOpen(true);
  };
  const sendGroup = () => {
    p.submitGroupReport(selected, {
      sprayedL: gSprayed,
      areaA: gArea,
      memo: gMemo
    });
    setSelected([]);
    setGroupMode(false);
    setGFormOpen(false);
  };
  const startEditField = w => {
    const f = p.resolveWork(w);
    const master = p.fields.find(x => x.id === w.fieldId);
    if (!master) return;
    setEditingFieldId(master.id);
    setEf({
      name: f.name,
      crop: f.crop || "",
      areaA: String(f.areaA || "")
    });
  };
  const saveEditField = () => {
    p.upsertField({
      name: ef.name.trim() || "(未入力)",
      crop: ef.crop.trim(),
      areaA: parseFloat(ef.areaA) || ""
    }, editingFieldId);
    setEditingFieldId(null);
  };
  const results = query.trim() ? p.fields.filter(f => f.name.includes(query.trim()) || (f.crop || "").includes(query.trim())) : [];
  const orderInToday = fieldId => {
    const idx = dayList.findIndex(w => w.fieldId === fieldId);
    return idx >= 0 ? idx + 1 : 0;
  };
  const draggingWork = dragId != null ? dayList.find(w => w.id === dragId) : null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, draggingWork && dragPos && /*#__PURE__*/React.createElement("div", {
    className: "no-print",
    style: {
      position: "fixed",
      left: dragPos.x,
      top: dragPos.y - 46,
      transform: "translateX(-50%)",
      zIndex: 999,
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
  }, "⣿ ", p.resolveWork(draggingWork).name), /*#__PURE__*/React.createElement("section", {
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
  }, pendingDayList.length), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "残り圃場")), /*#__PURE__*/React.createElement("div", {
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
  }, "合計薬量"))), needsRateWarning && /*#__PURE__*/React.createElement("div", {
    style: S.rateWarnBand,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("span", null, "⚠"), /*#__PURE__*/React.createElement("span", null, "本日の投下量(L/10a)が未入力の圃場があります。下の欄に入力して「面積から一括計算」を押してください。")), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
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
  }, "例:合計 ", fmt(sumArea, 1), "a → 約 ", fmt(sumArea / 10 * parseFloat(ratePerDay), 1), "L(全圃場の予定を上書きします)"))), dayList.length > 0 && /*#__PURE__*/React.createElement("section", {
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
  }, "薬剤を圃場に適用"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setChemApplyOpen(!chemApplyOpen);
      setChemTargetId(null);
    },
    style: S.linkBtn
  }, chemApplyOpen ? "閉じる" : "薬剤を選ぶ")), !chemApplyOpen && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 4
    }
  }, "調合タブで計算した薬液やプリセットを、全圃場または個別の圃場に適用できます。"), chemApplyOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "① 適用先を選ぶ"), /*#__PURE__*/React.createElement("select", {
    value: chemTargetId === null ? "all" : String(chemTargetId),
    onChange: e => setChemTargetId(e.target.value === "all" ? null : Number(e.target.value)),
    style: {
      ...S.planSelect,
      marginTop: 6,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "🚁 この日の全圃場(", pendingDayList.length, "件)にまとめて適用"), pendingDayList.map(w => {
    const f = p.resolveWork(w);
    return /*#__PURE__*/React.createElement("option", {
      key: w.id,
      value: w.id
    }, f.name, w.plannedL ? "(予定" + fmt(parseFloat(w.plannedL), 1) + "L)" : "(予定なし)");
  })), /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "② 使う薬剤を選ぶ"), p.lastMix && p.lastMix.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      chemTargetId === null ? p.applyChemsToAll(p.lastMix) : p.applyChemsToWork(chemTargetId, p.lastMix);
      setChemApplyOpen(false);
    },
    style: {
      ...S.applyChemBtn,
      marginTop: 6
    }
  }, "↩ 前回と同じ薬液（", p.lastMix.map(c => c.name || "無名").filter(Boolean).join("・"), "）"), p.presets.length === 0 && (!p.lastMix || p.lastMix.length === 0) && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      marginTop: 6
    }
  }, "まだ薬剤プリセットがありません。調合タブで薬液を作って「⭐プリセットに保存」するか「↩この薬液を控える」を押してください。"), p.presets.map(pr => /*#__PURE__*/React.createElement("button", {
    key: pr.id,
    onClick: () => {
      chemTargetId === null ? p.applyChemsToAll(pr.chems) : p.applyChemsToWork(chemTargetId, pr.chems);
      setChemApplyOpen(false);
    },
    style: {
      ...S.applyChemBtn,
      marginTop: 6
    }
  }, "⭐ ", pr.name, "（", pr.chems.map(c => (c.name || "無名") + " " + c.ratio + "倍").join("・"), "）")), /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 8
    }
  }, "薬量は各圃場の予定薬液量から自動計算されます。予定薬液量が未設定の圃場は、先に上の「本日の散布投下量」で計算してください。"))), p.routes.length > 0 && /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "圃場コースから追加"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: "",
    onChange: e => {
      if (e.target.value) p.applyRoute(Number(e.target.value));
    },
    style: {
      ...S.planSelect,
      marginBottom: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "▼ コースを選んでこの日へ投入"), p.routes.map(r => /*#__PURE__*/React.createElement("option", {
    key: r.id,
    value: r.id
  }, "🚜 ", r.name, "(", r.fieldIds.length, "圃場)")))), /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 8
    }
  }, "コースの作成・編集は「プリセット」タブで行えます。")), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "圃場を検索(登録済みマスタから)"), /*#__PURE__*/React.createElement("input", {
    value: query,
    placeholder: "🔍 圃場名・作物名で検索",
    onChange: e => setQuery(e.target.value),
    style: S.fieldInput
  }), query.trim() && results.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.memoLine,
      marginTop: 10
    }
  }, "該当する圃場がありません。下のフォームから新規登録できます。"), results.map(f => {
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
  })), /*#__PURE__*/React.createElement("section", {
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
  }, dateLabel(p.workDate), "の作業リスト(", dayList.length, "件)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setGroupMode(!groupMode);
      setSelected([]);
      setGFormOpen(false);
    },
    style: groupMode ? S.smallPrimary : S.smallSecondary
  }, groupMode ? "まとめ選択を終了" : "🔗 まとめ散布")), dayList.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "この日の作業はまだ登録されていません。", /*#__PURE__*/React.createElement("br", null), "上の「圃場を検索」で追加するか、プリセットタブで圃場を登録してください。"), dayList.length > 1 && !groupMode && /*#__PURE__*/React.createElement("p", {
    style: {
      ...S.note,
      marginTop: 0,
      marginBottom: 10
    }
  }, "右の⣿マークを長押ししてドラッグすると、散布する順番を入れ替えられます。"), dayList.map((w, idx) => {
    const f = p.resolveWork(w);
    const master = p.fields.find(x => x.id === w.fieldId);
    const isEditing = editingFieldId !== null && master && master.id === editingFieldId;
    return /*#__PURE__*/React.createElement("div", {
      key: w.id,
      "data-work-id": w.id,
      style: {
        ...S.record,
        ...(groupMode && selected.includes(w.id) ? S.recordSelected : {}),
        ...(!groupMode && w.reported && w.synced && w.reportSynced ? S.recordSent : {}),
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
    }, groupMode ? w.reported ? /*#__PURE__*/React.createElement("span", {
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
    }, /*#__PURE__*/React.createElement("div", {
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
    }, "面積未定"), w.plannedL ? /*#__PURE__*/React.createElement("span", {
      style: S.workMetaSep
    }, "／ 予定 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#2b5a7a"
      }
    }, dispVol(w.plannedL, p.volUnitKey), /*#__PURE__*/React.createElement("span", {
      style: S.workMetaUnit
    }, volSuffix(p.volUnitKey)))) : null))), !groupMode && /*#__PURE__*/React.createElement("div", {
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
    }, master && /*#__PURE__*/React.createElement("button", {
      onClick: () => startEditField(w),
      style: S.orderBtn,
      "aria-label": "編集"
    }, "✎"), /*#__PURE__*/React.createElement("span", {
      onPointerDown: e => onHandleDown(e, w.id),
      onTouchStart: e => onHandleDown(e, w.id),
      style: S.dragHandle,
      title: "ドラッグで並べ替え",
      "aria-label": "並べ替え"
    }, "⣿")))), /*#__PURE__*/React.createElement("div", {
      style: S.recordBody
    }, isEditing && /*#__PURE__*/React.createElement("div", {
      style: S.reportForm
    }, /*#__PURE__*/React.createElement("div", {
      style: S.smallLabel
    }, "圃場情報の編集(マスタに反映されます)"), /*#__PURE__*/React.createElement("div", {
      style: {
        ...S.areaGrid,
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("input", {
      value: ef.name,
      placeholder: "圃場名",
      onChange: e => setEf({
        ...ef,
        name: e.target.value
      }),
      style: S.fieldInput
    }), /*#__PURE__*/React.createElement("input", {
      value: ef.crop,
      placeholder: "作物名",
      onChange: e => setEf({
        ...ef,
        crop: e.target.value
      }),
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
      value: ef.areaA,
      onChange: e => setEf({
        ...ef,
        areaA: e.target.value
      }),
      style: S.midInput,
      className: "num"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        ...S.btnRow,
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setEditingFieldId(null),
      style: S.secondaryBtn
    }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
      onClick: saveEditField,
      style: S.primaryBtn
    }, "保存"))), w.chems.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: S.recordTotal,
      className: "num"
    }, "🧪 総量 ", /*#__PURE__*/React.createElement("strong", null, fmt(w.totalL, 2), " L"), "(薬剤", w.chems.length, "種):", w.chems.map(c => c.name + " " + c.ratio + "倍").join(" ／ ")), w.reported && !isEditing && reportingId !== w.id && /*#__PURE__*/React.createElement("div", {
      style: S.recordTotal,
      className: "num"
    }, "🚁 実散布 ", /*#__PURE__*/React.createElement("strong", null, dispVol(w.sprayedL, p.volUnitKey), " ", volSuffix(p.volUnitKey)), w.reportAreaA ? " ／ " + dispArea(w.reportAreaA, p.areaUnitKey) + " " + areaSuffix(p.areaUnitKey) : "", w.flights && w.flights.length > 1 ? " ／ " + w.flights.length + "フライト" : "", (w.reportMemo || w.memo) && /*#__PURE__*/React.createElement("div", {
      style: S.memoLine
    }, "備考:", w.reportMemo || w.memo)), !groupMode && !isEditing && (reportingId === w.id ? /*#__PURE__*/React.createElement("div", {
      style: S.reportForm
    }, /*#__PURE__*/React.createElement("div", {
      style: S.smallLabel
    }, "散布実績の入力"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.smallLabel
    }, "フライトごとの散布量(L)"), repFlights.map((v, i) => /*#__PURE__*/React.createElement("div", {
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
      onChange: e => setFlight(i, e.target.value),
      style: {
        ...S.midInput,
        flex: 1
      },
      className: "num"
    }), /*#__PURE__*/React.createElement("span", {
      style: S.midUnit
    }, "L"), /*#__PURE__*/React.createElement("button", {
      onClick: () => removeFlight(i),
      disabled: repFlights.length <= 1,
      style: {
        ...S.removeBtn,
        opacity: repFlights.length <= 1 ? 0.3 : 1
      },
      "aria-label": "このフライトを削除"
    }, "✕"))), /*#__PURE__*/React.createElement("button", {
      onClick: addFlight,
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
    }, fmt(flightSum, 2)), " L", repFlights.length > 1 ? /*#__PURE__*/React.createElement("span", {
      style: S.tdSub
    }, "(", repFlights.length, "フライト)") : null)), /*#__PURE__*/React.createElement("label", {
      style: {
        ...S.areaField,
        marginTop: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.smallLabel
    }, "散布面積(a)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      inputMode: "decimal",
      min: "0",
      value: repArea,
      onChange: e => setRepArea(e.target.value),
      style: S.midInput,
      className: "num"
    })), /*#__PURE__*/React.createElement("input", {
      value: repMemo,
      placeholder: "備考(残液・中断理由など任意)",
      onChange: e => setRepMemo(e.target.value),
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
      onClick: () => setReportingId(null),
      style: S.secondaryBtn
    }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
      onClick: sendReport,
      style: S.primaryBtn
    }, "実績を保存"))) : /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 10,
        marginTop: 6
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => openReport(w),
      style: {
        ...S.reportBtn,
        flex: 1,
        marginTop: 0
      }
    }, w.reported ? "✎ 実績を修正" : "🚁 実績入力"), !w.reported && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("「" + f.name + "」をこの日のリストから外しますか？\n(圃場マスタには残ります)")) p.removeWork(w.id);
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
  }, "作業終了後に送信"), p.syncing && p.syncProgress.total > 0 && /*#__PURE__*/React.createElement("div", {
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
  }, p.syncing ? "送信中…" : !p.gasUrl ? "☁ 送信先が未設定です" : pending === 0 ? "☁ 送信するデータはありません" : "☁ 全データを送信(未送信 " + pending + "件)"), !p.syncing && pending > 0 && p.gasUrl && pendingWorks.length > 1 && /*#__PURE__*/React.createElement("div", {
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
  }, "電波のある場所で押してください。送信済みは二重登録されません。中止した場合は、上の選択から途中の圃場を選んで再開できます。")), /*#__PURE__*/React.createElement("section", {
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
  }))));
}

// ═══════════════════ 薬剤タブ ═══════════════════
// ═══════════════════ プリセットタブ(圃場・コース・薬剤) ═══════════════════
function PresetTab(p) {
  const [sub, setSub] = useState("field"); // field | route | chem
  // 圃場フォーム
  const [fName, setFName] = useState("");
  const [fCrop, setFCrop] = useState("");
  const [fArea, setFArea] = useState("");
  const [editId, setEditId] = useState(null);
  const [fq, setFq] = useState("");
  // コース作成・編集
  const [routeBuildMode, setRouteBuildMode] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routePicks, setRoutePicks] = useState([]);
  const [routeEditId, setRouteEditId] = useState(null);
  // 薬剤編集
  const [editChem, setEditChem] = useState(null);
  const [ec, setEc] = useState({
    form: "sc",
    use: "fungicide",
    ratio: ""
  });
  const [cq, setCq] = useState("");
  const [chemTankL, setChemTankL] = useState("20"); // 必要な水量を試算する際の総量(L)

  const fieldList = fq.trim() ? p.fields.filter(f => f.name.includes(fq.trim()) || (f.crop || "").includes(fq.trim())) : p.fields;
  const chemList = cq.trim() ? p.chemMaster.filter(c => c.name.includes(cq.trim())) : p.chemMaster;
  const submitField = () => {
    if (!fName.trim()) return;
    const cropName = fCrop.trim();
    if (cropName) p.addCrop(cropName); // 入力された作物をマスタに自動登録
    if (editId) {
      p.upsertField({
        name: fName.trim(),
        crop: cropName,
        areaA: parseFloat(fArea) || ""
      }, editId);
    } else {
      p.addFieldOnly({
        name: fName.trim(),
        crop: cropName,
        areaA: parseFloat(fArea) || ""
      });
    }
    setFName("");
    setFCrop("");
    setFArea("");
    setEditId(null);
  };
  const startEdit = f => {
    setEditId(f.id);
    setFName(f.name);
    setFCrop(f.crop || "");
    setFArea(String(f.areaA || ""));
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.subTabWrap
  }, [["field", "🌾 圃場"], ["route", "🚜 コース"], ["chem", "🧪 薬剤"]].map(t => /*#__PURE__*/React.createElement("button", {
    key: t[0],
    onClick: () => setSub(t[0]),
    style: {
      ...S.subTab,
      ...(sub === t[0] ? S.subTabOn : {})
    }
  }, t[1]))), sub === "field" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, editId ? "圃場を編集" : "圃場を登録"), /*#__PURE__*/React.createElement("datalist", {
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
  })), p.crops.length > 0 && /*#__PURE__*/React.createElement("div", {
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
  }, c))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 12
    }
  }, editId && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setEditId(null);
      setFName("");
      setFCrop("");
      setFArea("");
    },
    style: S.secondaryBtn
  }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
    onClick: submitField,
    disabled: !fName.trim(),
    style: {
      ...S.primaryBtn,
      gridColumn: editId ? "auto" : "1 / -1",
      opacity: fName.trim() ? 1 : 0.4
    }
  }, editId ? "更新" : "＋ 圃場を登録"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "登録済み圃場(", p.fields.length, "件)"), p.fields.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: fq,
    placeholder: "🔍 圃場名・作物名で検索",
    onChange: e => setFq(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), p.fields.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ圃場が登録されていません。上のフォームから登録してください。"), fieldList.map(f => /*#__PURE__*/React.createElement("div", {
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
  }, "削除"))))), sub === "route" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
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
  }, "圃場コース(", p.routes.length, "件)"), !routeBuildMode && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setRouteBuildMode(true);
      setRoutePicks([]);
      setRouteName("");
    },
    style: S.smallPrimary
  }, "＋ 新規作成")), routeBuildMode ? /*#__PURE__*/React.createElement("div", {
    style: S.settingsBox
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "コースに入れる圃場を回る順にタップ"), /*#__PURE__*/React.createElement("input", {
    value: routeName,
    placeholder: "コース名(例:月曜ルート)",
    onChange: e => setRouteName(e.target.value),
    style: {
      ...S.fieldInput,
      marginTop: 8
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      maxHeight: 300,
      overflowY: "auto"
    }
  }, p.fields.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.memoLine
  }, "先に「🌾 圃場」タブで圃場を登録してください。"), p.fields.map(f => {
    const pickIdx = routePicks.indexOf(f.id);
    return /*#__PURE__*/React.createElement("div", {
      key: f.id,
      onClick: () => setRoutePicks(pickIdx >= 0 ? routePicks.filter(x => x !== f.id) : [...routePicks, f.id]),
      style: {
        ...S.pickRow,
        ...(pickIdx >= 0 ? S.pickRowOn : {})
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        ...S.pickNum,
        ...(pickIdx >= 0 ? S.pickNumOn : {})
      }
    }, pickIdx >= 0 ? pickIdx + 1 : "＋"), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, f.name, f.crop ? "(" + f.crop + ")" : ""), /*#__PURE__*/React.createElement("span", {
      style: S.tdSub
    }, f.areaA ? fmt(parseFloat(f.areaA), 2) + "a" : ""));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setRouteBuildMode(false);
      setRouteEditId(null);
    },
    style: S.secondaryBtn
  }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (routeName.trim() && routePicks.length > 0) {
        if (routeEditId) p.updateRoute(routeEditId, routeName.trim(), routePicks);else p.createRoute(routeName.trim(), routePicks);
        setRouteBuildMode(false);
        setRouteEditId(null);
      }
    },
    disabled: !routeName.trim() || routePicks.length === 0,
    style: {
      ...S.primaryBtn,
      opacity: routeName.trim() && routePicks.length > 0 ? 1 : 0.4
    }
  }, routeEditId ? "コースを更新" : "コース保存", "(", routePicks.length, ")"))) : /*#__PURE__*/React.createElement(React.Fragment, null, p.routes.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだコースがありません。", /*#__PURE__*/React.createElement("br", null), "「＋ 新規作成」でよく回る圃場をまとめて登録できます。"), p.routes.map(r => {
    const totalArea = r.fieldIds.reduce((s, fid) => {
      const f = p.fields.find(x => x.id === fid);
      return s + (f ? parseFloat(f.areaA) || 0 : 0);
    }, 0);
    return /*#__PURE__*/React.createElement("div", {
      key: r.id,
      style: {
        ...S.record,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordHead
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordField
    }, "🚜 ", r.name), /*#__PURE__*/React.createElement("div", {
      style: S.listSub,
      className: "num"
    }, r.fieldIds.length, "圃場 ／ 合計 ", dispArea(totalArea, p.areaUnitKey), " ", areaSuffix(p.areaUnitKey))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setRouteBuildMode(true);
        setRouteEditId(r.id);
        setRouteName(r.name);
        setRoutePicks([...r.fieldIds]);
      },
      style: {
        ...S.smallSecondary,
        padding: "6px 12px"
      }
    }, "編集"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("コース「" + r.name + "」を削除しますか？")) p.deleteRoute(r.id);
      },
      style: {
        ...S.smallDanger,
        padding: "6px 12px"
      }
    }, "削除"))), /*#__PURE__*/React.createElement("div", {
      style: S.recordBody
    }, /*#__PURE__*/React.createElement("div", {
      style: S.listSub
    }, r.fieldIds.map(fid => {
      const f = p.fields.find(x => x.id === fid);
      return f ? f.name : "(削除済)";
    }).join(" → "))));
  }), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "コースの呼び出しは「作業・記録」タブの「圃場コースから追加」で行います。")))), sub === "chem" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "使用薬剤リスト(調合計算で使うと自動登録)"), /*#__PURE__*/React.createElement("div", {
    style: S.tankRow
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "この総量で作る場合の目安:"), /*#__PURE__*/React.createElement("div", {
    style: S.inline
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: chemTankL,
    onChange: e => setChemTankL(e.target.value),
    style: {
      ...S.midInput,
      width: 90
    },
    className: "num"
  }), /*#__PURE__*/React.createElement("span", {
    style: S.midUnit
  }, "L"))), p.chemMaster.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: cq,
    placeholder: "🔍 薬剤名で検索",
    onChange: e => setCq(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), p.chemMaster.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ薬剤が登録されていません。", /*#__PURE__*/React.createElement("br", null), "調合計算で「記録に保存」すると自動で貯まります。"), chemList.map(c => {
    const tank = parseFloat(chemTankL) || 0;
    const ratio = parseFloat(c.ratio) || 0;
    const chemMl = ratio > 0 ? tank * 1000 / ratio : 0; // 必要薬量(mL)
    const waterL = tank - chemMl / 1000; // 必要な水の量(L)
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
      inputMode: "decimal",
      value: ec.ratio,
      onChange: e => setEc({
        ...ec,
        ratio: e.target.value
      }),
      style: S.ratioInput,
      className: "num",
      placeholder: "倍率"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        p.editChemMaster(c.name, {
          form: ec.form,
          use: ec.use,
          ratio: parseFloat(ec.ratio) || 0
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
    }, useLabel(c.use), " ／ ", formLabel(c.form), " ／ 標準 ", c.ratio, "倍"), ratio > 0 && tank > 0 && /*#__PURE__*/React.createElement("div", {
      style: S.waterHint,
      className: "num"
    }, fmt(tank, 1), "L作るなら → 薬剤 ", fmt(chemMl, 1), "mL ＋ 水 約 ", fmt(waterL, 2), "L")), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setEditChem(c.name);
        setEc({
          form: c.form,
          use: c.use || "other",
          ratio: String(c.ratio)
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
  const [gpsOn, setGpsOn] = React.useState(false);
  const [mapType, setMapType] = React.useState("hybrid"); // hybrid=衛星+地名, roadmap=地図のみ
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const LABEL_MIN_ZOOM = 17;
  const [zoom, setZoom] = React.useState(15);
  const drawArea = polygonAreaA(drawPts);

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
        if (!drawingRef.current) return;
        const next = [...drawPtsRef.current, [e.latLng.lat(), e.latLng.lng()]];
        drawPtsRef.current = next;
        setDrawPts(next);
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
      const path = f.polygon.map(pt => ({
        lat: pt[0],
        lng: pt[1]
      }));
      const poly = new g.Polygon({
        paths: path,
        strokeColor: "#2E7D4F",
        strokeWeight: 2,
        fillColor: "#7ED957",
        fillOpacity: 0.35,
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
  }, [ready, p.fields, zoom]);

  // 作図中の頂点・線を再描画
  React.useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = window.google.maps;
    drawOverlaysRef.current.forEach(o => {
      o.setMap && o.setMap(null);
    });
    drawOverlaysRef.current = [];
    if (drawPts.length > 0) {
      drawPts.forEach((pt, i) => {
        const marker = new g.Marker({
          position: {
            lat: pt[0],
            lng: pt[1]
          },
          map: mapRef.current,
          draggable: true,
          label: {
            text: String(i + 1),
            color: "#fff",
            fontWeight: "800",
            fontSize: "13px"
          },
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: "#C74E36",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2.5
          }
        });
        marker.addListener("drag", () => {
          const ll = marker.getPosition();
          const next = drawPtsRef.current.map((q, qi) => qi === i ? [ll.lat(), ll.lng()] : q);
          drawPtsRef.current = next;
          setDrawPts(next);
        });
        drawOverlaysRef.current.push(marker);
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
        drawOverlaysRef.current.push(fillPoly);
      }
    }
  }, [ready, drawPts]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    setDrawPts([]);
    drawPtsRef.current = [];
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    setDrawPts([]);
    drawPtsRef.current = [];
    setNewName("");
    setNewCrop("");
  };
  const undoPt = () => {
    const next = drawPtsRef.current.slice(0, -1);
    drawPtsRef.current = next;
    setDrawPts(next);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    const center = polygonCenter(drawPts);
    const areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    p.addFieldWithPolygon({
      name: newName.trim(),
      crop: newCrop.trim(),
      areaA,
      polygon: drawPts,
      center
    });
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    cancelDraw();
  };
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
    style: {
      ...S.cardLabel,
      marginBottom: 0
    }
  }, "圃場マップ(Google)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
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
    ref: containerRef,
    style: S.mapBox,
    "data-map-box": ""
  }), drawing && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "地図をタップして圃場の角を順に囲んでください(3点以上)。打った点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "できます。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", null, fmt(drawArea, 2)), " a"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 8,
      gridTemplateColumns: "1fr 1fr"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: undoPt,
    disabled: drawPts.length === 0,
    style: {
      ...S.secondaryBtn,
      opacity: drawPts.length ? 1 : 0.4
    }
  }, "↩ 1点戻す"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setDrawPts([]);
      drawPtsRef.current = [];
    },
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
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: saveDraw,
    disabled: drawPts.length < 3 || !newName.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 10,
      opacity: drawPts.length >= 3 && newName.trim() ? 1 : 0.4
    }
  }, "この圃場を登録(", fmt(drawArea, 2), " a)"))), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "地図に登録された圃場(", polyFields.length, "件)"), polyFields.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ地図上の圃場がありません。", /*#__PURE__*/React.createElement("br", null), "「✏ 圃場を囲む」で登録できます。"), polyFields.map(f => /*#__PURE__*/React.createElement("div", {
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
  }, fmt(polygonAreaA(f.polygon), 2), " a")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (mapRef.current && f.center) {
        mapRef.current.setCenter({
          lat: f.center[0],
          lng: f.center[1]
        });
        mapRef.current.setZoom(17);
      }
    },
    style: S.smallSecondary
  }, "地図で見る"), /*#__PURE__*/React.createElement("a", {
    href: naviUrl(f.center || polygonCenter(f.polygon)),
    target: "_blank",
    rel: "noopener noreferrer",
    style: S.naviBtn
  }, "🚗 ナビ")))));
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
  const [gpsOn, setGpsOn] = React.useState(false);
  const [zoom, setZoom] = React.useState(15);
  const [tileMode, setTileMode] = React.useState("photo"); // "photo" | "map"
  const drawingRef = React.useRef(false);
  const drawPtsRef = React.useRef([]);
  const drawArea = polygonAreaA(drawPts);
  const LABEL_MIN_ZOOM = 17;

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
      if (!drawingRef.current) return;
      const next = [...drawPtsRef.current, [e.latlng.lat, e.latlng.lng]];
      drawPtsRef.current = next;
      setDrawPts(next);
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
      const poly = L.polygon(f.polygon, {
        color: "#2E7D4F",
        weight: 2,
        fillColor: "#7ED957",
        fillOpacity: 0.35
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
  }, [ready, p.fields, zoom]);

  // 作図中ポリゴンの再描画
  React.useEffect(() => {
    if (!ready || !window.L) return;
    const L = window.L;
    const grp = layersRef.current.draw;
    grp.clearLayers();
    if (drawPts.length > 0) {
      // 頂点(ドラッグで移動可能)
      drawPts.forEach((pt, i) => {
        const icon = L.divIcon({
          className: "vtx-icon",
          html: '<div class="vtx">' + (i + 1) + '</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        const m = L.marker(pt, {
          icon,
          draggable: true
        }).addTo(grp);
        m.on("drag", e => {
          const ll = e.target.getLatLng();
          const next = drawPtsRef.current.map((q, qi) => qi === i ? [ll.lat, ll.lng] : q);
          drawPtsRef.current = next;
          setDrawPts(next);
        });
      });
      if (drawPts.length >= 2) L.polyline([...drawPts, ...(drawPts.length >= 3 ? [drawPts[0]] : [])], {
        color: "#C74E36",
        weight: 2,
        dashArray: "6 4"
      }).addTo(grp);
      if (drawPts.length >= 3) L.polygon(drawPts, {
        color: "#C74E36",
        weight: 1,
        fillColor: "#C74E36",
        fillOpacity: 0.15
      }).addTo(grp);
    }
  }, [ready, drawPts]);
  const startDraw = () => {
    setDrawing(true);
    drawingRef.current = true;
    setDrawPts([]);
    drawPtsRef.current = [];
  };
  const cancelDraw = () => {
    setDrawing(false);
    drawingRef.current = false;
    setDrawPts([]);
    drawPtsRef.current = [];
    setNewName("");
    setNewCrop("");
  };
  const undoPt = () => {
    const next = drawPtsRef.current.slice(0, -1);
    drawPtsRef.current = next;
    setDrawPts(next);
  };
  const saveDraw = () => {
    if (drawPts.length < 3 || !newName.trim()) return;
    const center = polygonCenter(drawPts);
    const areaA = Math.round(polygonAreaA(drawPts) * 100) / 100;
    p.addFieldWithPolygon({
      name: newName.trim(),
      crop: newCrop.trim(),
      areaA,
      polygon: drawPts,
      center
    });
    if (newCrop.trim()) p.addCrop(newCrop.trim());
    cancelDraw();
  };

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
    style: {
      ...S.cardLabel,
      marginBottom: 0
    }
  }, "圃場マップ"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
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
    ref: containerRef,
    style: S.mapBox,
    "data-map-box": ""
  }), drawing && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "地図をタップして圃場の角を順に囲んでください(3点以上)。打った点は", /*#__PURE__*/React.createElement("strong", null, "ドラッグで移動"), "できます。"), /*#__PURE__*/React.createElement("div", {
    style: S.drawInfo,
    className: "num"
  }, "頂点 ", drawPts.length, "点 ／ 面積 ", /*#__PURE__*/React.createElement("strong", null, fmt(drawArea, 2)), " a"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 8,
      gridTemplateColumns: "1fr 1fr"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: undoPt,
    disabled: drawPts.length === 0,
    style: {
      ...S.secondaryBtn,
      opacity: drawPts.length ? 1 : 0.4
    }
  }, "↩ 1点戻す"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setDrawPts([]);
      drawPtsRef.current = [];
    },
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
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: saveDraw,
    disabled: drawPts.length < 3 || !newName.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 10,
      opacity: drawPts.length >= 3 && newName.trim() ? 1 : 0.4
    }
  }, "この圃場を登録(", fmt(drawArea, 2), " a)"))), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "地図に登録された圃場(", polyFields.length, "件)"), polyFields.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ地図上の圃場がありません。", /*#__PURE__*/React.createElement("br", null), "「✏ 圃場を囲む」で登録できます。"), polyFields.map(f => /*#__PURE__*/React.createElement("div", {
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
  }, fmt(polygonAreaA(f.polygon), 2), " a")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (mapRef.current && f.center) {
        mapRef.current.setView(f.center, 16);
      }
    },
    style: S.smallSecondary
  }, "地図で見る"), /*#__PURE__*/React.createElement("a", {
    href: naviUrl(f.center || polygonCenter(f.polygon)),
    target: "_blank",
    rel: "noopener noreferrer",
    style: S.naviBtn
  }, "🚗 ナビ")))));
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
    desc: "アプリを開いたときの最初の画面です。希釈倍率と総量(または面積×10a散布量)から各薬剤の必要量・水量を自動計算します。「⭐プリセットに保存」で薬液の組み合わせを登録でき、次回から作業タブの「薬剤を圃場に適用」で呼び出せます。「↩ この薬液を控える」で前回薬液として記憶します。農薬の使用回数が上限に近づくと、画面上部のタイトル直下に警告帯が常時表示されます(この回数はアプリに記録された散布実績を通算した簡易的な目安で、作期での自動リセットは行われません)。"
  }, {
    title: "🚁 作業・記録タブ",
    desc: "日付ごとに回る圃場をリスト化し、実績を入力・送信します。圃場はプリセットタブで登録したマスタを「圃場を検索」で探して「＋この日へ」で追加します。「圃場コースから追加」でよく回るルートをまとめて一括投入できます。予定薬液量は圃場マスタには保存されず、その日「本日の散布投下量(L/10a)」を入力して「面積から一括計算」を押したときだけ計算されます(投下量が未入力の圃場があると一覧上部に注意バナーが出ます)。「薬剤を圃場に適用」でプリセットや前回薬液を未実施の圃場に適用でき、各圃場の予定薬液量で薬量を自動計算します。圃場は右の⣿マークを長押ししてドラッグすると散布順を並べ替えられます(誤って動かないよう、左の番号部分では並べ替えできません。実施済みの圃場も並べ替え対象外です)。✎ボタンで圃場名・作物名・面積などをその場で編集できます(プリセットのマスタにも反映されます)。「実績入力」ボタンで散布量・フライト数を空欄から記録します。実績を入力しても圃場は一覧に残ったまま実際の数値がその場に表示され、「✎ 実績を修正」でいつでも入力し直せます。「☁ 全データを送信」で送信が完了すると色が変わり「✓送信済」と表示されます。下部の「記録」欄は一覧表示をせず、CSV出力・印刷のみに使います。"
  }, {
    title: "🗺 地図タブ",
    desc: "衛星写真上で圃場を囲んで登録できます。地図エンジンは設定タブで「無料地図(Leaflet)」と「Google マップ」を切り替えられます(既定は無料地図)。どちらで登録した圃場も共通のデータとして扱われ、エンジンを切り替えても圃場は消えません。「✏ 圃場を囲む」を押してから地図をタップすると頂点が打たれ、打った点はドラッグで位置調整できます。3点以上打つと面積が自動計算されます。圃場名を入力して「この圃場を登録」で保存するとプリセットの圃場マスタにも自動登録されます。無料地図では国土地理院の衛星写真とOpenStreetMapの道路・地名地図を、Googleマップでは衛星写真と道路・地名を同時表示(hybrid)と地図表示を切り替えられます。「📍 現在地」でGPS位置を地図に表示できます。PC・タブレットでは地図がフルワイドで大きく表示されます。「🚗 ナビ」でGoogleマップアプリのナビが起動します。Googleマップを使うには設定タブでAPIキーの登録が必要です。"
  }, {
    title: "📋 プリセットタブ",
    desc: "圃場マスタ(🌾)・圃場コース(🚜)・薬剤プリセット(🧪)の3つのサブタブで管理します。圃場の新規登録・編集・削除はすべてここの🌾サブタブで行います(作業タブからの直接登録はできません)。圃場マスタには圃場名・作物名・面積のみを登録します(予定薬液量はここには持たず、作業タブでその日の投下量から計算します)。登録した圃場は作業タブで「検索→＋この日へ」で追加します。🚜コースはよく回る圃場の順番を登録したもので、作業タブのプルダウンから一括投入できます。🧪薬剤プリセットは調合タブで「⭐プリセットに保存」するとここに蓄積されます。"
  }, {
    title: "⚙ 設定タブ",
    desc: "面積(a/ha/反/町)と薬量(L/mL/kg/g)の表示単位を切り替えられます。データは常にa・Lで保存され、表示だけ変換されます。作物マスタの管理もここで行います。送信先URL(GASのウェブアプリURL)は一度設定すれば保存されます。GASを再デプロイするときは「デプロイを管理→編集→新しいバージョン」を使うとURLが変わりません。チームコードを使って複数端末間でデータを共有できます。このガイドとバージョン履歴もここで確認できます。"
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
    ver: "v8.20",
    date: "2026-07",
    isNew: true,
    notes: ["🚁 実績入力しても作業タブから消えず、そのまま一覧に残って編集できるように変更", "実績値(散布量・面積・備考)をその場に表示。「✎ 実績を修正」を押すと入力済みの値を復元して編集可能に", "送信が完了した圃場だけ色が変わり「✓送信済」と表示(未送信は「実績入力済(未送信)」)", "実績入力(散布量)の初期値を空欄に変更(誤った数値の入力保存を防止)", "作業タブの圃場名・作物名・面積の編集ボタンが実績入力済みの圃場でも使えるように", "予定薬液量を圃場マスタから廃止。「本日の投下量」入力で計算した当日限りの値のみを使用し、日をまたいだ古い値の誤使用を防止", "投下量が未入力の圃場があるとき、作業タブに常時注意バナーを表示", "プリセットの圃場マスタ・作業タブの✎編集から「予定薬液量」欄を削除(面積のみ)", "作業タブ下部の「記録」は一覧表示をやめ、CSV出力・印刷のみに整理", "🔒 地図ラベル(圃場名・作物名)の表示方法を修正し、記号を含む名前でも安全に表示されるように", "APIキーの説明文を修正(Google読み込み時に送信される点を明記)", "APIキー入力欄でブラウザの自動入力候補が出ないように変更", "農薬使用回数警告に「簡易的な目安・作期リセットなし」の注記を追加", "「この端末のデータをすべて消去」に誤タップ防止の二段階確認(「消去」と入力)を追加", "作業リストのドラッグ並べ替えで、つかんでいる圃場名がその場に浮かんで見えるように改善", "並べ替えは右の⣿マークのみで行うように変更し、左の番号に触れて誤って動いてしまわないように修正", "設定タブの各項目をバージョン履歴と同じように開閉式にし、タップするまで折りたたまれているように変更"]
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
    notes: ["農薬使用回数警告機能追加(上限3回)", "圃場登録をプリセットタブに一本化"]
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
  toast: {
    position: "fixed",
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 50,
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
    fontSize: 18,
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
    zIndex: 40
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
    width: 40,
    height: 40,
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
    width: 44,
    height: 44,
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
  pickRowOn: {
    border: "2px solid #2E7D4F",
    background: "#EDF5EE"
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
  pickNumOn: {
    background: "#2E7D4F",
    color: "#fff"
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
  applyBox: {
    padding: "12px 12px 14px",
    background: "#F7F9F5",
    border: "1.5px solid #D8E0D2",
    borderRadius: 10,
    marginBottom: 14
  },
  chip: {
    padding: "10px 14px",
    fontSize: 15,
    fontWeight: 700,
    color: "#66756a",
    background: "#fff",
    border: "1.5px solid #D8E0D2",
    borderRadius: 20,
    cursor: "pointer"
  },
  chipOn: {
    color: "#fff",
    background: "#2E7D4F",
    border: "1.5px solid #2E7D4F"
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
  quickBtn: {
    padding: "15px 0",
    fontSize: 16.5,
    fontWeight: 800,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 10,
    cursor: "pointer"
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
  tankRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    background: "#EAF3FA",
    border: "1.5px solid #BBD6E8",
    borderRadius: 9,
    marginBottom: 12,
    flexWrap: "wrap"
  },
  waterHint: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: 700,
    color: "#2b5a7a"
  },
  mapBox: {
    width: "100%",
    height: "calc(100dvh - 220px)",
    minHeight: 280,
    maxHeight: "80dvh",
    borderRadius: 12,
    overflow: "hidden",
    border: "1.5px solid #D8E0D2",
    background: "#dfe6da"
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
  dragHandle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
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
  homeCard: {
    background: "linear-gradient(135deg, #1C2B21 0%, #2E7D4F 100%)",
    borderRadius: 16,
    padding: "20px 18px",
    color: "#fff"
  },
  homeDate: {
    fontSize: 13,
    fontWeight: 700,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 2
  },
  homeTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: "#fff"
  },
  homeSummaryRow: {
    display: "flex",
    gap: 10,
    marginTop: 14
  },
  homeStat: {
    flex: 1,
    background: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: "12px 8px",
    textAlign: "center"
  },
  homeNum: {
    display: "block",
    fontSize: 32,
    fontWeight: 800,
    color: "#fff",
    lineHeight: 1
  },
  homeLabel: {
    display: "block",
    fontSize: 11.5,
    color: "rgba(255,255,255,0.75)",
    marginTop: 4,
    fontWeight: 700
  },
  homeBadge: {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 800,
    color: "#fff",
    background: "#C74E36",
    border: "none",
    borderRadius: 20,
    cursor: "pointer"
  },
  homeQuickCard: {
    background: "#EDF5EE",
    borderRadius: 14,
    padding: "16px 16px 18px",
    border: "1.5px solid #2E7D4F"
  }
};
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
