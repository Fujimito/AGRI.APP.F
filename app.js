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
  const [workDate, setWorkDate] = useState(today());
  const [gasUrl, setGasUrlState] = useState(() => localStorage.getItem("tankmix:gasurl") || "");
  const [recorder, setRecorderState] = useState(() => localStorage.getItem("tankmix:recorder") || "");
  const [teamCode, setTeamCodeState] = useState(() => localStorage.getItem("tankmix:teamcode") || "");
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
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
      areaA: data.areaA,
      plannedL: data.plannedL
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
      areaA: data.areaA,
      plannedL: data.plannedL
    }]);
    flash("圃場「" + data.name + "」を登録しました");
  };
  const makeWork = f => ({
    id: Date.now() + Math.floor(Math.random() * 1000),
    workDate,
    fieldId: f.id,
    snapshot: {
      name: f.name,
      crop: f.crop || "",
      areaA: f.areaA,
      plannedL: f.plannedL
    },
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
    // 対象圃場のマスタを更新(予定薬液量 = 面積/10 × 10aあたり量)
    let nextFields = [...fields];
    dayWorks.forEach(w => {
      const f = resolveWork(w);
      const area = parseFloat(f.areaA) || 0;
      if (area <= 0) {
        noArea++;
        return;
      }
      const planned = Math.round(area / 10 * rate * 100) / 100;
      const fi = nextFields.findIndex(x => x.id === w.fieldId);
      if (fi >= 0) {
        nextFields[fi] = {
          ...nextFields[fi],
          plannedL: planned
        };
        updated++;
      }
    });
    setFieldsSave(nextFields);
    // 作業リストのスナップショットも追従
    setWorksSave(works.map(w => {
      if (w.workDate !== workDate || w.reported) return w;
      const f = nextFields.find(x => x.id === w.fieldId);
      return f ? {
        ...w,
        snapshot: {
          ...w.snapshot,
          plannedL: f.plannedL
        }
      } : w;
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
        const f = resolveWork(w);
        if (parseFloat(f.plannedL) > 0) {
          setMode("direct");
          setTotalL(String(f.plannedL));
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
    upsertChemMaster(chemsData);
    // 前回調合として保存(「前回と同じ」で呼び出せる)
    const mixSnap = calc.filter(c => c.valid).map(c => ({
      name: c.name || "",
      form: c.form,
      use: c.use || "other",
      ratio: c.ratio
    }));
    if (mixSnap.length > 0) {
      setLastMix(mixSnap);
      save("tankmix:lastmix", mixSnap);
    }
    const valid = targetIds.filter(id => works.some(w => w.id === id));
    if (valid.length > 0) {
      // 選んだ複数圃場すべてに同じ調合を紐付け。総量は各圃場の予定薬液量があればそれを優先
      setWorksSave(works.map(w => {
        if (!valid.includes(w.id)) return w;
        const f = resolveWork(w);
        const per = parseFloat(f.plannedL) > 0 ? parseFloat(f.plannedL) : effTotalL;
        const perMl = per * 1000;
        // 各圃場の総量に合わせて薬量・水量を再計算
        const scaled = chemsData.map(c => ({
          ...c,
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
      setTargetIds([]);
      flash(valid.length + "圃場に調合を適用しました。散布後に実績を入力してください");
      setTab("work");
    } else {
      const name = prompt("圃場名を入力してください(この日のリストに追加されます)", "");
      if (name === null) return;
      let f = fields.find(x => x.name === (name.trim() || "(未入力)"));
      if (!f) {
        f = {
          id: Date.now() + 1,
          name: name.trim() || "(未入力)",
          crop: "",
          areaA: "",
          plannedL: 0
        };
        setFieldsSave([...fields, f]);
      }
      const w = {
        ...makeWork(f),
        chems: chemsData,
        totalL: effTotalL,
        waterMl
      };
      setWorksSave([...works, w]);
      flash("調合を記録しました。散布後に実績を入力してください");
      setTab("work");
    }
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
  const syncPending = async () => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let current = load("tankmix:works", []);
    let sent = 0;
    let failed = false;
    for (const w of current) {
      if (w.groupedInto) continue;
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
    }
    syncingRef.current = false;
    setSyncing(false);
    if (sent > 0) flash(sent + "件を送信しました" + (failed ? "(一部失敗・再試行してください)" : ""));else if (failed) flash("送信に失敗しました。電波とURLを確認してください");
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
    if (!confirm("この端末のデータ(圃場・薬剤・作業リスト)を共有データとして保存します。\n既存の共有データは上書きされます。よろしいですか？")) return;
    setSyncing(true);
    const payload = JSON.stringify({
      fields,
      works,
      chemMaster,
      presets,
      routes,
      savedAt: new Date().toISOString(),
      by: recorder
    });
    const j = await post({
      type: "cloudSave",
      team: teamCode.trim(),
      payload
    }, 1);
    setSyncing(false);
    flash(j && j.ok ? "☁ 共有データを保存しました" : "保存に失敗しました");
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
      return [w.workDate, f.name, f.crop || "", plain(parseFloat(w.reportAreaA || f.areaA), 1), w.chems.length, chemsStr, plain(w.totalL), plain(w.waterMl / 1000, 3), w.reported ? plain(w.sprayedL) : "", w.reported ? flights.length || (w.reported ? 1 : "") : "", flightStr, w.reported ? "散布済" : "調合のみ", w.reportDate || "", (w.reportMemo || w.memo || "").replace(/[,\n]/g, " ")].join(",");
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
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: S.eyebrow
  }, "TANK MIX NOTE v8"), /*#__PURE__*/React.createElement("h1", {
    style: S.title
  }, "農薬散布防除記録")), pendingCount > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTab("work");
      syncPending();
    },
    style: S.headerBadge
  }, syncing ? "送信中…" : "☁ 未送信 " + pendingCount + "件"))), toast && /*#__PURE__*/React.createElement("div", {
    style: S.toast
  }, toast), /*#__PURE__*/React.createElement("main", {
    style: S.main
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
    targetIds,
    togglePlan,
    clearPlans,
    planOptions,
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
    gasUrl,
    setGasUrl,
    recorder,
    setRecorder,
    teamCode,
    setTeamCode,
    testConnection,
    cloudSave,
    cloudLoad
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
    resolveWork,
    works,
    workDate,
    chemMaster,
    deleteChemMaster,
    editChemMaster,
    presets,
    loadPreset,
    deletePreset
  })), /*#__PURE__*/React.createElement("nav", {
    style: S.tabbar,
    className: "no-print"
  }, [["calc", "🧮", "調合計算"], ["work", "🚁", "作業・記録"], ["preset", "📋", "プリセット"]].map(t => /*#__PURE__*/React.createElement("button", {
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
      fontSize: 12.5,
      fontWeight: 700
    }
  }, t[2])))));
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "薬液の総量"), p.planOptions.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.applyBox
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "この調合を適用する圃場(複数選択可)"), p.targetIds.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: p.clearPlans,
    style: S.linkBtn
  }, "選択解除")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8
    }
  }, p.planOptions.map(w => {
    const f = p.resolveWork(w);
    const on = p.targetIds.includes(w.id);
    return /*#__PURE__*/React.createElement("button", {
      key: w.id,
      onClick: () => p.togglePlan(w.id),
      style: {
        ...S.chip,
        ...(on ? S.chipOn : {})
      }
    }, on ? "✓ " : "", f.name, f.plannedL ? "(" + f.plannedL + "L)" : "");
  })), p.targetIds.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.derived,
      marginTop: 10
    }
  }, p.targetIds.length, "圃場に適用します(各圃場の予定薬液量で自動計算)")), /*#__PURE__*/React.createElement("div", {
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
  }, "※ 一般的な剤型順の目安です。", /*#__PURE__*/React.createElement("strong", null, "混用可否と順序は必ず各薬剤のラベル・メーカー指示を優先"), "してください。")), p.targetIds.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.derived,
      marginTop: 0,
      marginBottom: 10
    }
  }, "保存先:", p.targetIds.map(id => {
    const w = p.works.find(x => x.id === id);
    return w ? p.resolveWork(w).name : null;
  }).filter(Boolean).join("、")), /*#__PURE__*/React.createElement("div", {
    style: S.btnRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: p.savePreset,
    style: S.secondaryBtn
  }, "⭐ プリセット保存"), /*#__PURE__*/React.createElement("button", {
    onClick: p.saveRecord,
    disabled: !p.ready,
    style: {
      ...S.primaryBtn,
      opacity: p.ready ? 1 : 0.4
    }
  }, p.targetIds.length > 1 ? "📋 " + p.targetIds.length + "圃場に適用" : "📋 記録に保存"))));
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
  const [pField, setPField] = useState("");
  const [pCrop, setPCrop] = useState("");
  const [pArea, setPArea] = useState("");
  const [pLiters, setPLiters] = useState("");
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
    areaA: "",
    plannedL: ""
  });
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(() => !p.gasUrl);
  const [ratePerDay, setRatePerDay] = useState("");
  const dayList = p.works.filter(w => w.workDate === p.workDate && !w.reported);
  const history = p.works.filter(w => w.reported && !w.groupedInto).sort((a, b) => b.id - a.id);
  const pending = p.works.filter(w => !w.groupedInto && (!w.synced || w.reported && !w.reportSynced)).length;
  const sumArea = dayList.reduce((s, w) => s + (parseFloat(p.resolveWork(w).areaA) || 0), 0);
  const sumLiters = dayList.reduce((s, w) => {
    const f = p.resolveWork(w);
    return s + (w.totalL > 0 ? w.totalL : parseFloat(f.plannedL) || 0);
  }, 0);
  const add = () => {
    if (!pField.trim()) return;
    p.addNewFieldAndWork({
      name: pField.trim(),
      crop: pCrop.trim(),
      areaA: parseFloat(pArea) || "",
      plannedL: parseFloat(pLiters) || 0
    });
    setPField("");
    setPCrop("");
    setPArea("");
    setPLiters("");
  };
  const openReport = w => {
    const f = p.resolveWork(w);
    setReportingId(w.id);
    // 既定は1フライト。総量が分かればその値を初期表示
    setRepFlights([String(w.totalL || f.plannedL || "")]);
    setRepArea(f.areaA !== "" && f.areaA != null ? String(f.areaA) : "");
    setRepMemo("");
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
      areaA: String(f.areaA || ""),
      plannedL: String(f.plannedL || "")
    });
  };
  const saveEditField = () => {
    p.upsertField({
      name: ef.name.trim() || "(未入力)",
      crop: ef.crop.trim(),
      areaA: parseFloat(ef.areaA) || "",
      plannedL: parseFloat(ef.plannedL) || 0
    }, editingFieldId);
    setEditingFieldId(null);
  };
  const results = query.trim() ? p.fields.filter(f => f.name.includes(query.trim()) || (f.crop || "").includes(query.trim())) : [];
  const orderInToday = fieldId => {
    const idx = dayList.findIndex(w => w.fieldId === fieldId);
    return idx >= 0 ? idx + 1 : 0;
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
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
  }, "圃場")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsItem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.totalsNum
  }, fmt(sumArea, 1), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " a")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "合計面積")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsItem
  }, /*#__PURE__*/React.createElement("div", {
    style: S.totalsNum
  }, fmt(sumLiters, 1), /*#__PURE__*/React.createElement("small", {
    style: S.totalsUnit
  }, " L")), /*#__PURE__*/React.createElement("div", {
    style: S.totalsLabel
  }, "合計薬量"))), dayList.length > 0 && /*#__PURE__*/React.createElement("div", {
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
  }, "例:合計 ", fmt(sumArea, 1), "a → 約 ", fmt(sumArea / 10 * parseFloat(ratePerDay), 1), "L(全圃場の予定を上書きします)"))), p.routes.length > 0 && /*#__PURE__*/React.createElement("section", {
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
    }, f.areaA ? fmt(parseFloat(f.areaA), 1) + " a" : "面積未定", f.plannedL ? " ／ 予定 " + fmt(parseFloat(f.plannedL), 1) + " L" : "")), ord > 0 ? /*#__PURE__*/React.createElement("span", {
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
    style: S.cardLabel
  }, "新しい圃場を登録してこの日のリストへ"), /*#__PURE__*/React.createElement("div", {
    style: S.areaGrid
  }, /*#__PURE__*/React.createElement("input", {
    value: pField,
    placeholder: "圃場名 ※必須",
    onChange: e => setPField(e.target.value),
    style: S.fieldInput
  }), /*#__PURE__*/React.createElement("input", {
    value: pCrop,
    placeholder: "作物名",
    onChange: e => setPCrop(e.target.value),
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.areaGrid,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "面積(a)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: pArea,
    onChange: e => setPArea(e.target.value),
    style: S.midInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "予定薬液量(L)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: pLiters,
    onChange: e => setPLiters(e.target.value),
    style: S.midInput,
    className: "num"
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: add,
    disabled: !pField.trim(),
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 12,
      opacity: pField.trim() ? 1 : 0.4
    }
  }, "＋ 登録してこの日のリストに追加")), /*#__PURE__*/React.createElement("section", {
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
  }, "この日の作業はまだ登録されていません。", /*#__PURE__*/React.createElement("br", null), "検索または新規登録から圃場を追加してください。"), dayList.map((w, idx) => {
    const f = p.resolveWork(w);
    const master = p.fields.find(x => x.id === w.fieldId);
    const isEditing = editingFieldId !== null && master && master.id === editingFieldId;
    return /*#__PURE__*/React.createElement("div", {
      key: w.id,
      style: {
        ...S.record,
        ...(groupMode && selected.includes(w.id) ? S.recordSelected : {})
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordHead
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0
      }
    }, groupMode ? /*#__PURE__*/React.createElement("button", {
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
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: S.recordField
    }, f.name, f.crop ? "(" + f.crop + ")" : ""), /*#__PURE__*/React.createElement("div", {
      style: S.listSub,
      className: "num"
    }, f.areaA ? fmt(parseFloat(f.areaA), 1) + " a" : "面積未定", f.plannedL ? " ／ 予定 " + fmt(parseFloat(f.plannedL), 1) + " L" : ""))), !groupMode && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: w.chems.length > 0 ? S.badgeOk : S.badgePlan
    }, w.chems.length > 0 ? "調合済" : "計画"), master && /*#__PURE__*/React.createElement("button", {
      onClick: () => startEditField(w),
      style: S.orderBtn,
      "aria-label": "編集"
    }, "✎"), /*#__PURE__*/React.createElement("button", {
      onClick: () => p.moveWork(w.id, -1),
      disabled: idx === 0,
      style: {
        ...S.orderBtn,
        opacity: idx === 0 ? 0.3 : 1
      },
      "aria-label": "上へ"
    }, "▲"), /*#__PURE__*/React.createElement("button", {
      onClick: () => p.moveWork(w.id, 1),
      disabled: idx === dayList.length - 1,
      style: {
        ...S.orderBtn,
        opacity: idx === dayList.length - 1 ? 0.3 : 1
      },
      "aria-label": "下へ"
    }, "▼"))), /*#__PURE__*/React.createElement("div", {
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
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        ...S.areaGrid,
        marginTop: 10
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: S.areaField
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
    })), /*#__PURE__*/React.createElement("label", {
      style: S.areaField
    }, /*#__PURE__*/React.createElement("span", {
      style: S.smallLabel
    }, "予定薬液量(L)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      inputMode: "decimal",
      value: ef.plannedL,
      onChange: e => setEf({
        ...ef,
        plannedL: e.target.value
      }),
      style: S.midInput,
      className: "num"
    }))), /*#__PURE__*/React.createElement("div", {
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
    }, "🧪 総量 ", /*#__PURE__*/React.createElement("strong", null, fmt(w.totalL, 2), " L"), "(薬剤", w.chems.length, "種):", w.chems.map(c => c.name + " " + c.ratio + "倍").join(" ／ ")), !groupMode && !isEditing && (reportingId === w.id ? /*#__PURE__*/React.createElement("div", {
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
        marginTop: 6
      }
    }, (() => {
      const quick = w.totalL > 0 ? w.totalL : parseFloat(f.plannedL) || 0;
      return quick > 0 ? /*#__PURE__*/React.createElement("button", {
        onClick: () => p.submitReport(w.id, {
          sprayedL: quick,
          flights: [quick],
          areaA: "",
          memo: ""
        }),
        style: {
          ...S.quickBtn,
          width: "100%",
          marginBottom: 8
        }
      }, "✓ 予定どおり ", fmt(quick, 1), "L で完了(1タップ)") : null;
    })(), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => openReport(w),
      style: {
        ...S.reportBtn,
        flex: 1,
        marginTop: 0
      }
    }, "🚁 詳しく入力"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm("「" + f.name + "」をこの日のリストから外しますか？\n(圃場マスタには残ります)")) p.removeWork(w.id);
      },
      style: {
        ...S.smallDanger,
        alignSelf: "stretch"
      }
    }, "外す"))))));
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
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "作業終了後に"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowSettings(!showSettings),
    style: S.linkBtn
  }, showSettings ? "設定を閉じる" : "送信・共有設定")), showSettings && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
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
  }, "同じチームコードの端末どうしで、圃場・薬剤・作業リストを共有できます(後から保存した内容で上書き)。")), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.syncPending(),
    disabled: p.syncing || pending === 0 || !p.gasUrl,
    style: {
      ...S.bigSendBtn,
      opacity: p.syncing || pending === 0 || !p.gasUrl ? 0.45 : 1
    }
  }, p.syncing ? "送信中…" : !p.gasUrl ? "☁ 送信先が未設定です" : pending === 0 ? "☁ 送信するデータはありません" : "☁ 全データを送信(未送信 " + pending + "件)"), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "電波のある場所で押してください。送信済みは二重登録されません。送信後も圃場はマスタに残り、別の日に再度使えます。")), /*#__PURE__*/React.createElement("section", {
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
  }, "印刷"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowHistory(!showHistory),
    style: S.smallSecondary
  }, showHistory ? "閉じる" : "表示"))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.cardLabel,
      display: "none"
    },
    className: "print-only"
  }, "散布記録一覧"), showHistory && history.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "完了した記録はまだありません。"), showHistory && history.map(w => {
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
    }, "実散布 ", /*#__PURE__*/React.createElement("strong", null, fmt(w.sprayedL, 2), " L"), "(調合 ", fmt(w.totalL, 2), " L ／ 水 ", fmtL(w.waterMl), " L)", w.reportAreaA || f.areaA ? " ／ " + fmt(parseFloat(w.reportAreaA || f.areaA), 1) + " a" : ""), w.flights && w.flights.length > 1 && /*#__PURE__*/React.createElement("div", {
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
  })));
}

// ═══════════════════ 薬剤タブ ═══════════════════
// ═══════════════════ プリセットタブ(圃場・コース・薬剤) ═══════════════════
function PresetTab(p) {
  const [sub, setSub] = useState("field"); // field | route | chem
  // 圃場フォーム
  const [fName, setFName] = useState("");
  const [fCrop, setFCrop] = useState("");
  const [fArea, setFArea] = useState("");
  const [fLiters, setFLiters] = useState("");
  const [editId, setEditId] = useState(null);
  const [fq, setFq] = useState("");
  // コース作成
  const [routeBuildMode, setRouteBuildMode] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routePicks, setRoutePicks] = useState([]);
  // 薬剤編集
  const [editChem, setEditChem] = useState(null);
  const [ec, setEc] = useState({
    form: "sc",
    use: "fungicide",
    ratio: ""
  });
  const [cq, setCq] = useState("");
  const fieldList = fq.trim() ? p.fields.filter(f => f.name.includes(fq.trim()) || (f.crop || "").includes(fq.trim())) : p.fields;
  const chemList = cq.trim() ? p.chemMaster.filter(c => c.name.includes(cq.trim())) : p.chemMaster;
  const submitField = () => {
    if (!fName.trim()) return;
    if (editId) {
      p.upsertField({
        name: fName.trim(),
        crop: fCrop.trim(),
        areaA: parseFloat(fArea) || "",
        plannedL: parseFloat(fLiters) || 0
      }, editId);
    } else {
      p.addFieldOnly({
        name: fName.trim(),
        crop: fCrop.trim(),
        areaA: parseFloat(fArea) || "",
        plannedL: parseFloat(fLiters) || 0
      });
    }
    setFName("");
    setFCrop("");
    setFArea("");
    setFLiters("");
    setEditId(null);
  };
  const startEdit = f => {
    setEditId(f.id);
    setFName(f.name);
    setFCrop(f.crop || "");
    setFArea(String(f.areaA || ""));
    setFLiters(String(f.plannedL || ""));
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
  }, editId ? "圃場を編集" : "圃場を登録"), /*#__PURE__*/React.createElement("div", {
    style: S.areaGrid
  }, /*#__PURE__*/React.createElement("input", {
    value: fName,
    placeholder: "圃場名 ※必須",
    onChange: e => setFName(e.target.value),
    style: S.fieldInput
  }), /*#__PURE__*/React.createElement("input", {
    value: fCrop,
    placeholder: "作物名",
    onChange: e => setFCrop(e.target.value),
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.areaGrid,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
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
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "予定薬液量(L)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    value: fLiters,
    onChange: e => setFLiters(e.target.value),
    style: S.midInput,
    className: "num"
  }))), /*#__PURE__*/React.createElement("div", {
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
      setFLiters("");
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
  }, f.areaA ? fmt(parseFloat(f.areaA), 1) + " a" : "面積未定", f.plannedL ? " ／ 予定 " + fmt(parseFloat(f.plannedL), 1) + " L" : "")), /*#__PURE__*/React.createElement("button", {
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
    }, f.areaA ? fmt(parseFloat(f.areaA), 1) + "a" : ""));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.btnRow,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setRouteBuildMode(false),
    style: S.secondaryBtn
  }, "キャンセル"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (routeName.trim() && routePicks.length > 0) {
        p.createRoute(routeName.trim(), routePicks);
        setRouteBuildMode(false);
      }
    },
    disabled: !routeName.trim() || routePicks.length === 0,
    style: {
      ...S.primaryBtn,
      opacity: routeName.trim() && routePicks.length > 0 ? 1 : 0.4
    }
  }, "コース保存(", routePicks.length, ")"))) : /*#__PURE__*/React.createElement(React.Fragment, null, p.routes.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだコースがありません。", /*#__PURE__*/React.createElement("br", null), "「＋ 新規作成」でよく回る圃場をまとめて登録できます。"), p.routes.map(r => /*#__PURE__*/React.createElement("div", {
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
    style: S.listSub
  }, r.fieldIds.length, "圃場")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("コース「" + r.name + "」を削除しますか？")) p.deleteRoute(r.id);
    },
    style: {
      ...S.smallDanger,
      padding: "6px 12px"
    }
  }, "削除")), /*#__PURE__*/React.createElement("div", {
    style: S.recordBody
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listSub
  }, r.fieldIds.map(fid => {
    const f = p.fields.find(x => x.id === fid);
    return f ? f.name : "(削除済)";
  }).join(" → "))))), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "コースの呼び出しは「作業・記録」タブの「圃場コースから追加」で行います。")))), sub === "chem" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "使用薬剤リスト(調合計算で使うと自動登録)"), p.chemMaster.length > 4 && /*#__PURE__*/React.createElement("input", {
    value: cq,
    placeholder: "🔍 薬剤名で検索",
    onChange: e => setCq(e.target.value),
    style: {
      ...S.fieldInput,
      marginBottom: 10
    }
  }), p.chemMaster.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだ薬剤が登録されていません。", /*#__PURE__*/React.createElement("br", null), "調合計算で「記録に保存」すると自動で貯まります。"), chemList.map(c => /*#__PURE__*/React.createElement("div", {
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
  }, useLabel(c.use), " ／ ", formLabel(c.form), " ／ 標準 ", c.ratio, "倍")), /*#__PURE__*/React.createElement("button", {
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
  }, "削除"))))), /*#__PURE__*/React.createElement("section", {
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
    fontSize: 16.5,
    fontWeight: 600,
    color: "#2E7D4F"
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
    flexShrink: 0
  },
  orderBtn: {
    width: 44,
    height: 44,
    fontSize: 17,
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
  }
};
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
