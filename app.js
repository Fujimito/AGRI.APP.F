const {
  useState,
  useEffect,
  useRef
} = React;

// ═══════════════════════════════════════════════════════
//  薬液調合ノート — タンクミックス計算・記録アプリ(単独HTML版)
//  データはこの端末のブラウザ内に保存されます(localStorage)
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
  key: "sti",
  label: "展着剤",
  order: 12
}, {
  key: "etc",
  label: "その他",
  order: 13
}];
const formLabel = k => (FORMS.find(f => f.key === k) || {}).label || "その他";
const formOrder = k => (FORMS.find(f => f.key === k) || {}).order || 13;
const fmt = (n, d = 1) => !isFinite(n) ? "—" : n % 1 === 0 ? n.toLocaleString("ja-JP") : n.toLocaleString("ja-JP", {
  maximumFractionDigits: d
});
const fmtL = ml => (ml / 1000).toLocaleString("ja-JP", {
  maximumFractionDigits: 3
});
const today = () => new Date().toISOString().slice(0, 10);
let uid = 100;
const newChem = () => ({
  id: uid++,
  name: "",
  form: "sc",
  ratio: ""
});

// ── 端末内保存(localStorage) ──
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
    ratio: "10"
  }, {
    id: 2,
    name: "",
    form: "ec",
    ratio: "16"
  }]);
  const [field, setField] = useState("");
  const [presets, setPresets] = useState(() => load("tankmix:presets", []));
  const [records, setRecords] = useState(() => load("tankmix:records", []));

  // ── クラウド送信設定(Googleスプレッドシート連携) ──
  const [gasUrl, setGasUrlState] = useState(() => localStorage.getItem("tankmix:gasurl") || "");
  const [recorder, setRecorderState] = useState(() => localStorage.getItem("tankmix:recorder") || "");
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
  const flash = msg => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  // ── 作業リスト(事前計画) ──
  const [targetId, setTargetId] = useState(null); // 調合中の対象圃場

  // 圃場を作業リストに追加
  const addPlan = p => {
    const rec = {
      id: Date.now(),
      date: "",
      field: p.field || "(未入力)",
      crop: p.crop || "",
      memo: "",
      areaA: p.areaA !== "" ? parseFloat(p.areaA) || "" : "",
      plannedL: parseFloat(p.plannedL) || 0,
      totalL: 0,
      waterMl: 0,
      synced: false,
      reported: false,
      reportSynced: false,
      chems: []
    };
    const next = [...records, rec];
    setRecords(next);
    save("tankmix:records", next);
    flash(`「${rec.field}」を作業リストに追加しました`);
  };

  // 作業リスト内の並べ替え(未報告のものの中で上下入替)
  const movePlan = (id, dir) => {
    const visible = records.filter(r => !r.reported).map(r => r.id);
    const vi = visible.indexOf(id);
    const vj = vi + dir;
    if (vi < 0 || vj < 0 || vj >= visible.length) return;
    const otherId = visible[vj];
    const i = records.findIndex(r => r.id === id);
    const j = records.findIndex(r => r.id === otherId);
    const next = [...records];
    [next[i], next[j]] = [next[j], next[i]];
    setRecords(next);
    save("tankmix:records", next);
  };

  // 調合計算画面で対象圃場を選択(総量に予定薬液量をセット)
  const selectPlan = id => {
    if (!id) {
      setTargetId(null);
      return;
    }
    const r = records.find(x => x.id === Number(id));
    if (!r) return;
    setTargetId(r.id);
    setField(r.field);
    if (r.plannedL > 0) {
      setMode("direct");
      setTotalL(String(r.plannedL));
    }
  };

  // 1件送信(type: "record"=調合記録 / "report"=散布報告)
  const sendPayload = async (type, rec) => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url) return false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          type,
          recorder: (localStorage.getItem("tankmix:recorder") || "").trim(),
          record: {
            ...rec,
            chems: rec.chems.map(c => ({
              ...c,
              formName: formLabel(c.form)
            }))
          }
        })
      });
      const j = await res.json();
      return !!(j && j.ok);
    } catch {
      return false;
    }
  };

  // 未送信の記録・報告をまとめて送信(圏外なら次の機会に自動再試行)
  const syncPending = async list => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let current = list || load("tankmix:records", []);
    let sent = 0;
    for (const rec of current) {
      if (!rec.synced) {
        const ok = await sendPayload("record", rec);
        if (!ok) break;
        current = current.map(r => r.id === rec.id ? {
          ...r,
          synced: true
        } : r);
        setRecords(current);
        save("tankmix:records", current);
        sent++;
      }
      const cur = current.find(r => r.id === rec.id);
      if (cur && cur.reported && !cur.reportSynced && cur.synced) {
        const ok = await sendPayload("report", cur);
        if (!ok) break;
        current = current.map(r => r.id === rec.id ? {
          ...r,
          reportSynced: true
        } : r);
        setRecords(current);
        save("tankmix:records", current);
        sent++;
      }
    }
    syncingRef.current = false;
    setSyncing(false);
    if (sent > 0) flash(`${sent}件をスプレッドシートに送信しました`);
  };

  // 送信はユーザーの「一括送信」操作で行う(現場では圏外のことが多いため)

  // 接続テスト
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
      flash(j && j.ok ? "✅ 接続OK！スプレッドシートと繋がっています" : "応答が不正です。URLを確認してください");
    } catch {
      flash("❌ 接続できません。URLとデプロイ設定を確認してください");
    }
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
  const addChem = () => setChems([...chems, newChem()]);
  const removeChem = id => setChems(chems.filter(c => c.id !== id));
  const savePreset = () => {
    const name = prompt("プリセット名を入力してください", field || "調合セット");
    if (!name) return;
    const p = {
      id: Date.now(),
      name,
      chems: chems.map(({
        name,
        form,
        ratio
      }) => ({
        name,
        form,
        ratio
      }))
    };
    const next = [p, ...presets];
    setPresets(next);
    save("tankmix:presets", next);
    flash("プリセットを保存しました");
  };
  const loadPreset = p => {
    setChems(p.chems.map(c => ({
      ...c,
      id: uid++
    })));
    setTab("calc");
    flash(`「${p.name}」を読み込みました`);
  };
  const deletePreset = id => {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    save("tankmix:presets", next);
  };
  const saveRecord = () => {
    const chemsData = calc.filter(c => c.valid).map(({
      name,
      form,
      ratio,
      ml
    }) => ({
      name: name || "(無名)",
      form,
      ratio,
      ml
    }));
    let next;
    if (targetId && records.some(r => r.id === targetId)) {
      // 作業リストの圃場に調合内容を紐付け
      next = records.map(r => r.id === targetId ? {
        ...r,
        date: today(),
        totalL: effTotalL,
        waterMl,
        chems: chemsData,
        synced: false
      } : r);
      setTargetId(null);
    } else {
      // 圃場を選んでいない場合は、その場で圃場名を入力して作業リストに追加
      const name = prompt("圃場名を入力してください(作業リストに追加されます)", "");
      if (name === null) return; // キャンセル
      const rec = {
        id: Date.now(),
        date: today(),
        field: name.trim() || "(未入力)",
        crop: "",
        memo: "",
        areaA: mode === "area" ? parseFloat(areaA) || "" : "",
        plannedL: 0,
        totalL: effTotalL,
        waterMl,
        synced: false,
        reported: false,
        reportSynced: false,
        chems: chemsData
      };
      next = [...records, rec];
    }
    setRecords(next);
    save("tankmix:records", next);
    flash("調合を記録しました。散布後に実績を入力してください");
    setTab("report");
  };

  // 散布実績の入力(作業終了後の一括送信までは端末内に保持)
  const submitReport = (id, rep) => {
    const next = records.map(r => r.id === id ? {
      ...r,
      reported: true,
      reportSynced: false,
      date: r.date || today(),
      sprayedL: parseFloat(rep.sprayedL) || 0,
      reportAreaA: rep.areaA !== "" ? parseFloat(rep.areaA) || "" : r.areaA || "",
      reportMemo: rep.memo || "",
      reportDate: today()
    } : r);
    setRecords(next);
    save("tankmix:records", next);
    flash("実績を保存しました。作業終了後に一括送信してください");
  };
  const deleteRecord = id => {
    const next = records.filter(r => r.id !== id);
    setRecords(next);
    save("tankmix:records", next);
  };
  const exportCSV = () => {
    const plain = (n, d = 2) => isFinite(n) ? Number(n).toFixed(d).replace(/\.?0+$/, "") : "";
    const head = "日付,圃場,作物,面積(a),薬剤数,薬剤内容,総量(L),水量(L),実散布量(L),状態,報告日,備考\n";
    const body = records.map(r => {
      const chemsStr = r.chems.map(c => `${c.name}(${formLabel(c.form)}・${c.ratio}倍・${Math.round(c.ml)}mL)`).join(" / ");
      return [r.date, r.field, r.crop || "", plain(parseFloat(r.reportAreaA || r.areaA), 1), r.chems.length, chemsStr, plain(r.totalL), plain(r.waterMl / 1000, 3), r.reported ? plain(r.sprayedL) : "", r.reported ? "散布済" : "調合のみ", r.reportDate || "", (r.reportMemo || r.memo || "").replace(/[,\n]/g, " ")].join(",");
    }).join("\n");
    const blob = new Blob(["\uFEFF" + head + body], {
      type: "text/csv;charset=utf-8"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `調合記録_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("CSVを出力しました");
  };
  return /*#__PURE__*/React.createElement("div", {
    style: S.page
  }, /*#__PURE__*/React.createElement("header", {
    style: S.header,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.eyebrow
  }, "TANK MIX NOTE"), /*#__PURE__*/React.createElement("h1", {
    style: S.title
  }, "薬液調合ノート")), toast && /*#__PURE__*/React.createElement("div", {
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
    chems,
    calc,
    update,
    addChem,
    removeChem,
    effTotalL,
    totalMl,
    waterMl,
    over,
    ready,
    mixOrder,
    field,
    savePreset,
    saveRecord,
    targetId,
    selectPlan,
    planOptions: records.filter(r => !r.reported && r.chems.length === 0)
  }), tab === "report" && /*#__PURE__*/React.createElement(WorkTab, {
    records: records,
    submitReport: submitReport,
    addPlan: addPlan,
    movePlan: movePlan,
    deleteRecord: deleteRecord,
    syncPending: syncPending,
    syncing: syncing,
    gasUrl: gasUrl,
    setGasUrl: setGasUrl,
    recorder: recorder,
    setRecorder: setRecorder,
    testConnection: testConnection,
    exportCSV: exportCSV
  }), tab === "presets" && /*#__PURE__*/React.createElement(PresetsTab, {
    presets: presets,
    loadPreset: loadPreset,
    deletePreset: deletePreset
  })), /*#__PURE__*/React.createElement("nav", {
    style: S.tabbar,
    className: "no-print"
  }, [["calc", "🧮", "調合計算"], ["report", "🚁", "作業・記録"], ["presets", "⭐", "プリセット"]].map(([k, icon, label]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setTab(k),
    style: {
      ...S.tabBtn,
      ...(tab === k ? S.tabBtnActive : {})
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700
    }
  }, label)))));
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "薬液の総量"), p.planOptions.length > 0 && /*#__PURE__*/React.createElement("select", {
    value: p.targetId || "",
    onChange: e => p.selectPlan(e.target.value),
    style: S.planSelect
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "▼ 作業リストの圃場を選ぶ(任意)"), p.planOptions.map(r => /*#__PURE__*/React.createElement("option", {
    key: r.id,
    value: r.id
  }, r.field, r.crop ? `(${r.crop})` : "", r.plannedL ? ` — 予定${r.plannedL}L` : ""))), /*#__PURE__*/React.createElement("div", {
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
      fontSize: 26
    },
    className: "num"
  }, fmt(p.effTotalL, 2)), " L"))), /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "薬剤(名前・剤型・希釈倍率)"), p.calc.map(c => /*#__PURE__*/React.createElement("div", {
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
    placeholder: "薬剤名",
    onChange: e => p.update(c.id, "name", e.target.value),
    style: S.nameInput
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => p.removeChem(c.id),
    style: S.removeBtn,
    disabled: p.chems.length <= 1,
    "aria-label": "削除"
  }, "✕")), /*#__PURE__*/React.createElement("div", {
    style: S.chemBottom
  }, /*#__PURE__*/React.createElement("select", {
    value: c.form,
    onChange: e => p.update(c.id, "form", e.target.value),
    style: S.formSelect
  }, FORMS.map(f => /*#__PURE__*/React.createElement("option", {
    key: f.key,
    value: f.key
  }, f.label))), /*#__PURE__*/React.createElement("div", {
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
      fontSize: 12,
      fontWeight: 700,
      color: "#2b5a7a"
    }
  }, "水の量"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 34,
      fontWeight: 800,
      lineHeight: 1.1
    },
    className: "num"
  }, p.over || p.totalMl <= 0 ? "—" : fmtL(p.waterMl), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16
    }
  }, " L")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "#4a6a80"
    },
    className: "num"
  }, p.over || p.totalMl <= 0 ? "" : `（${fmt(p.waterMl)} mL）`)), /*#__PURE__*/React.createElement(TankViz, {
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
  }, formLabel(c.form), "・", fmt(parseFloat(c.ratio)), "倍")), /*#__PURE__*/React.createElement("td", {
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
      fontSize: 12,
      color: "#66756a"
    }
  }, "よく撹拌"))), /*#__PURE__*/React.createElement("li", {
    style: S.orderItem
  }, /*#__PURE__*/React.createElement("span", {
    style: S.orderStep
  }, p.mixOrder.length + 2), "残りの水を加えて全量にする")), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "※ 一般的な剤型順の目安です。", /*#__PURE__*/React.createElement("strong", null, "混用可否と順序は必ず各薬剤のラベル・メーカー指示を優先"), "してください。")), p.targetId && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.derived,
      marginBottom: 10
    }
  }, "保存先:", p.field, " の作業に紐付けます"), /*#__PURE__*/React.createElement("div", {
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
  }, "📋 記録に保存"))));
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
      height: `${waterMl / totalMl * 100}%`,
      background: "#4A90C4"
    }
  }), calc.filter(c => c.valid).map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: {
      height: `${c.ml / totalMl * 100}%`,
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

// ═══════════════════ プリセットタブ ═══════════════════
function PresetsTab({
  presets,
  loadPreset,
  deletePreset
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: S.card
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "保存済みプリセット"), presets.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "まだプリセットがありません。", /*#__PURE__*/React.createElement("br", null), "調合計算の画面で「⭐ プリセット保存」を押すと、薬剤の組み合わせをここに保存できます。"), presets.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: S.listItem
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.listTitle
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: S.listSub
  }, p.chems.map(c => `${c.name || "(無名)"} ${c.ratio}倍`).join(" ／ "))), /*#__PURE__*/React.createElement("button", {
    onClick: () => loadPreset(p),
    style: S.smallPrimary
  }, "読込"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm(`「${p.name}」を削除しますか？`)) deletePreset(p.id);
    },
    style: S.smallDanger
  }, "削除"))));
}

// ═══════════════════ 作業・記録タブ ═══════════════════
function WorkTab({
  records,
  submitReport,
  addPlan,
  movePlan,
  deleteRecord,
  syncPending,
  syncing,
  gasUrl,
  setGasUrl,
  recorder,
  setRecorder,
  testConnection,
  exportCSV
}) {
  // 圃場追加フォーム
  const [pField, setPField] = useState("");
  const [pCrop, setPCrop] = useState("");
  const [pArea, setPArea] = useState("");
  const [pLiters, setPLiters] = useState("");
  // 実績入力フォーム
  const [reportingId, setReportingId] = useState(null);
  const [repSprayed, setRepSprayed] = useState("");
  const [repArea, setRepArea] = useState("");
  const [repMemo, setRepMemo] = useState("");
  // 履歴・設定の表示切替
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(() => !gasUrl);
  const worklist = records.filter(r => !r.reported);
  const history = records.filter(r => r.reported).sort((a, b) => b.id - a.id);
  const pending = records.filter(r => !r.synced || r.reported && !r.reportSynced).length;
  const add = () => {
    if (!pField.trim()) return;
    addPlan({
      field: pField.trim(),
      crop: pCrop.trim(),
      areaA: pArea,
      plannedL: pLiters
    });
    setPField("");
    setPCrop("");
    setPArea("");
    setPLiters("");
  };
  const openReport = r => {
    setReportingId(r.id);
    setRepSprayed(String(r.totalL || r.plannedL || ""));
    setRepArea(r.areaA !== "" && r.areaA != null ? String(r.areaA) : "");
    setRepMemo("");
  };
  const sendReport = () => {
    submitReport(reportingId, {
      sprayedL: repSprayed,
      areaA: repArea,
      memo: repMemo
    });
    setReportingId(null);
  };
  const chemsLine = r => r.chems.map(c => `${c.name} ${c.ratio}倍`).join(" ／ ");
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "圃場を追加(出発前にまとめて登録)"), /*#__PURE__*/React.createElement("div", {
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
  }, "＋ 作業リストに追加")), /*#__PURE__*/React.createElement("section", {
    style: S.card,
    className: "no-print"
  }, /*#__PURE__*/React.createElement("div", {
    style: S.cardLabel
  }, "作業リスト(", worklist.length, "件)— ▲▼で順番を入替"), worklist.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: S.empty
  }, "圃場がまだ登録されていません。", /*#__PURE__*/React.createElement("br", null), "上のフォームから散布予定の圃場を追加してください。"), worklist.map((r, idx) => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    style: S.record
  }, /*#__PURE__*/React.createElement("div", {
    style: S.recordHead
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.orderNum,
    className: "num"
  }, idx + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.recordField
  }, r.field, r.crop ? `(${r.crop})` : ""), /*#__PURE__*/React.createElement("div", {
    style: S.listSub,
    className: "num"
  }, r.areaA ? `${fmt(parseFloat(r.areaA), 1)} a` : "面積未定", r.plannedL ? ` ／ 予定 ${fmt(r.plannedL, 1)} L` : ""))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      alignItems: "center",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: r.chems.length > 0 ? S.badgeOk : S.badgePlan
  }, r.chems.length > 0 ? "調合済" : "計画"), /*#__PURE__*/React.createElement("button", {
    onClick: () => movePlan(r.id, -1),
    disabled: idx === 0,
    style: {
      ...S.orderBtn,
      opacity: idx === 0 ? 0.3 : 1
    },
    "aria-label": "上へ"
  }, "▲"), /*#__PURE__*/React.createElement("button", {
    onClick: () => movePlan(r.id, 1),
    disabled: idx === worklist.length - 1,
    style: {
      ...S.orderBtn,
      opacity: idx === worklist.length - 1 ? 0.3 : 1
    },
    "aria-label": "下へ"
  }, "▼"))), /*#__PURE__*/React.createElement("div", {
    style: S.recordBody
  }, r.chems.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.recordTotal,
    className: "num"
  }, "🧪 総量 ", /*#__PURE__*/React.createElement("strong", null, fmt(r.totalL, 2), " L"), "(薬剤", r.chems.length, "種):", chemsLine(r)), reportingId === r.id ? /*#__PURE__*/React.createElement("div", {
    style: S.reportForm
  }, /*#__PURE__*/React.createElement("div", {
    style: S.smallLabel
  }, "散布実績の入力"), /*#__PURE__*/React.createElement("div", {
    style: S.areaGrid
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "実散布量(L)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    min: "0",
    value: repSprayed,
    onChange: e => setRepSprayed(e.target.value),
    style: S.midInput,
    className: "num"
  })), /*#__PURE__*/React.createElement("label", {
    style: S.areaField
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
  }))), /*#__PURE__*/React.createElement("input", {
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
    onClick: () => openReport(r),
    style: {
      ...S.reportBtn,
      flex: 1,
      marginTop: 0
    }
  }, "🚁 実績を入力"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm(`「${r.field}」をリストから削除しますか？`)) deleteRecord(r.id);
    },
    style: {
      ...S.smallDanger,
      alignSelf: "stretch"
    }
  }, "削除")))))), /*#__PURE__*/React.createElement("section", {
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
  }, showSettings ? "設定を閉じる" : "送信設定")), showSettings && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.settingsBox,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: S.areaField
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "送信先URL(Apps ScriptのウェブアプリURL)"), /*#__PURE__*/React.createElement("input", {
    value: gasUrl,
    onChange: e => setGasUrl(e.target.value),
    placeholder: "https://script.google.com/macros/s/…/exec",
    style: S.fieldInput,
    inputMode: "url",
    autoCapitalize: "off"
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      ...S.areaField,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: S.smallLabel
  }, "記録者名(シートに記載されます)"), /*#__PURE__*/React.createElement("input", {
    value: recorder,
    onChange: e => setRecorder(e.target.value),
    placeholder: "例:藤本",
    style: S.fieldInput
  })), /*#__PURE__*/React.createElement("button", {
    onClick: testConnection,
    style: {
      ...S.secondaryBtn,
      width: "100%",
      marginTop: 12
    }
  }, "接続テスト")), /*#__PURE__*/React.createElement("button", {
    onClick: () => syncPending(),
    disabled: syncing || pending === 0 || !gasUrl,
    style: {
      ...S.bigSendBtn,
      opacity: syncing || pending === 0 || !gasUrl ? 0.45 : 1
    }
  }, syncing ? "送信中…" : !gasUrl ? "☁ 送信先が未設定です" : pending === 0 ? "☁ 送信するデータはありません" : `☁ 全データを送信(未送信 ${pending}件)`), /*#__PURE__*/React.createElement("p", {
    style: S.note
  }, "電波のある場所で押してください。送信済みのデータは二重登録されません。")), /*#__PURE__*/React.createElement("section", {
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
    onClick: exportCSV,
    disabled: records.length === 0,
    style: {
      ...S.smallPrimary,
      opacity: records.length ? 1 : 0.4
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
  }, "完了した記録はまだありません。"), showHistory && history.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    style: S.record
  }, /*#__PURE__*/React.createElement("div", {
    style: S.recordHead
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: S.recordDate,
    className: "num"
  }, r.reportDate || r.date), /*#__PURE__*/React.createElement("span", {
    style: S.recordField
  }, r.field, r.crop ? `(${r.crop})` : ""), /*#__PURE__*/React.createElement("span", {
    style: r.synced && r.reportSynced ? S.badgeOk : S.badgePending,
    className: "no-print"
  }, r.synced && r.reportSynced ? "✓送信済" : "未送信")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm("この記録を削除しますか？")) deleteRecord(r.id);
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
  }, "実散布 ", /*#__PURE__*/React.createElement("strong", null, fmt(r.sprayedL, 2), " L"), "(調合 ", fmt(r.totalL, 2), " L ／ 水 ", fmtL(r.waterMl), " L)", r.reportAreaA || r.areaA ? ` ／ ${fmt(parseFloat(r.reportAreaA || r.areaA), 1)} a` : ""), r.chems.map((c, i) => /*#__PURE__*/React.createElement("div", {
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
  }, fmt(c.ml), " mL"))), (r.reportMemo || r.memo) && /*#__PURE__*/React.createElement("div", {
    style: S.memoLine
  }, "備考:", r.reportMemo || r.memo))))));
}

// ═══════════════════ スタイル ═══════════════════
const S = {
  page: {
    minHeight: "100vh",
    background: "#F0F3EC",
    color: "#1C2B21",
    fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif",
    paddingBottom: 84
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
    padding: "10px 18px",
    borderRadius: 24,
    fontSize: 13.5,
    fontWeight: 700,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)"
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
    letterSpacing: "0.14em",
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
    width: 150,
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
    background: "#fff"
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
  saveRow: {
    marginBottom: 10
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
    padding: "12px 4px",
    borderBottom: "1px solid #EDF1EA"
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
  recordHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    background: "#F4F7F1",
    borderBottom: "1px solid #E4EAE0"
  },
  recordDate: {
    fontSize: 15.5,
    fontWeight: 800
  },
  recordField: {
    fontSize: 16.5,
    fontWeight: 600,
    color: "#2E7D4F",
    marginLeft: 10
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
  syncBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #EDF1EA",
    fontSize: 14.5,
    flexWrap: "wrap"
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
    padding: "2px 7px",
    marginLeft: 8
  },
  badgePending: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#8a5a1c",
    background: "#FBF7EC",
    border: "1px solid #E4D6AC",
    borderRadius: 6,
    padding: "2px 7px",
    marginLeft: 8
  },
  badgeDone: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#2b5a7a",
    background: "#EAF3FA",
    borderRadius: 6,
    padding: "2px 7px",
    marginLeft: 8
  },
  orderNum: {
    width: 34,
    height: 34,
    borderRadius: 9,
    background: "#1C2B21",
    color: "#fff",
    fontSize: 17,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  orderBtn: {
    width: 42,
    height: 42,
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
  badgePlan: {
    fontSize: 12.5,
    fontWeight: 800,
    color: "#66756a",
    background: "#EDF1EA",
    borderRadius: 6,
    padding: "2px 7px",
    marginLeft: 8
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
  reportDone: {
    marginTop: 10,
    padding: "12px 14px",
    background: "#EAF3FA",
    borderRadius: 9,
    fontSize: 15,
    color: "#2b5a7a",
    fontWeight: 600
  }
};
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
