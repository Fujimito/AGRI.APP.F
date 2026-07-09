import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";
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
  label: "顆粒水和剤",
  order: 3
}, {
  key: "sc",
  label: "フロアブル",
  order: 4
}, {
  key: "sp",
  label: "水溶剤",
  order: 5
}, {
  key: "ec",
  label: "乳剤",
  order: 6
}, {
  key: "sl",
  label: "液剤",
  order: 7
}, {
  key: "sti",
  label: "展着剤",
  order: 8
}, {
  key: "etc",
  label: "その他",
  order: 9
}];
const formLabel = k => (FORMS.find(f => f.key === k) || {}).label || "その他";
const formOrder = k => (FORMS.find(f => f.key === k) || {}).order || 9;
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

  // 1件送信(成功でtrue)
  const sendRecord = async rec => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url) return false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
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

  // 未送信レコードをまとめて送信(圏外なら次の機会に自動再試行)
  const syncPending = async list => {
    const url = (localStorage.getItem("tankmix:gasurl") || "").trim();
    if (!url || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let current = list || load("tankmix:records", []);
    let sent = 0;
    for (const rec of current.filter(r => !r.synced)) {
      const ok = await sendRecord(rec);
      if (!ok) break;
      current = current.map(r => r.id === rec.id ? {
        ...r,
        synced: true
      } : r);
      setRecords(current);
      save("tankmix:records", current);
      sent++;
    }
    syncingRef.current = false;
    setSyncing(false);
    if (sent > 0) flash(`${sent}件をスプレッドシートに送信しました`);
  };

  // 起動時と、電波が復帰したときに自動送信
  useEffect(() => {
    syncPending();
    const h = () => syncPending();
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, []);

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
    const rec = {
      id: Date.now(),
      date: today(),
      field: field || "(未入力)",
      totalL: effTotalL,
      waterMl,
      synced: false,
      chems: calc.filter(c => c.valid).map(({
        name,
        form,
        ratio,
        ml
      }) => ({
        name: name || "(無名)",
        form,
        ratio,
        ml
      }))
    };
    const next = [rec, ...records];
    setRecords(next);
    save("tankmix:records", next);
    flash("調合記録を保存しました");
    setTab("records");
    syncPending(next); // 電波があればその場でスプレッドシートへ
  };
  const deleteRecord = id => {
    const next = records.filter(r => r.id !== id);
    setRecords(next);
    save("tankmix:records", next);
  };
  const exportCSV = () => {
    const head = "日付,圃場,総量(L),水量(L),薬剤名,剤型,希釈倍率,薬量(mL)\n";
    const body = records.flatMap(r => r.chems.map(c => [r.date, r.field, fmt(r.totalL, 3), fmtL(r.waterMl), c.name, formLabel(c.form), c.ratio, fmt(c.ml)].join(","))).join("\n");
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
  return /*#__PURE__*/_jsxDEV("div", {
    style: S.page,
    children: [/*#__PURE__*/_jsxDEV("header", {
      style: S.header,
      className: "no-print",
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: S.eyebrow,
        children: "TANK MIX NOTE"
      }, void 0, false), /*#__PURE__*/_jsxDEV("h1", {
        style: S.title,
        children: "薬液調合ノート"
      }, void 0, false)]
    }, void 0, true), toast && /*#__PURE__*/_jsxDEV("div", {
      style: S.toast,
      children: toast
    }, void 0, false), /*#__PURE__*/_jsxDEV("main", {
      style: S.main,
      children: [tab === "calc" && /*#__PURE__*/_jsxDEV(CalcTab, {
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
        setField,
        savePreset,
        saveRecord
      }, void 0, false), tab === "presets" && /*#__PURE__*/_jsxDEV(PresetsTab, {
        presets: presets,
        loadPreset: loadPreset,
        deletePreset: deletePreset
      }, void 0, false), tab === "records" && /*#__PURE__*/_jsxDEV(RecordsTab, {
        records: records,
        deleteRecord: deleteRecord,
        exportCSV: exportCSV,
        gasUrl: gasUrl,
        setGasUrl: setGasUrl,
        recorder: recorder,
        setRecorder: setRecorder,
        testConnection: testConnection,
        syncPending: syncPending,
        syncing: syncing
      }, void 0, false)]
    }, void 0, true), /*#__PURE__*/_jsxDEV("nav", {
      style: S.tabbar,
      className: "no-print",
      children: [["calc", "🧮", "調合計算"], ["presets", "⭐", "プリセット"], ["records", "📋", "記録"]].map(([k, icon, label]) => /*#__PURE__*/_jsxDEV("button", {
        onClick: () => setTab(k),
        style: {
          ...S.tabBtn,
          ...(tab === k ? S.tabBtnActive : {})
        },
        children: [/*#__PURE__*/_jsxDEV("span", {
          style: {
            fontSize: 20
          },
          children: icon
        }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
          style: {
            fontSize: 11,
            fontWeight: 700
          },
          children: label
        }, void 0, false)]
      }, k, true))
    }, void 0, false)]
  }, void 0, true);
}

// ═══════════════════ 調合計算タブ ═══════════════════
function CalcTab(p) {
  return /*#__PURE__*/_jsxDEV(React.Fragment, {
    children: [/*#__PURE__*/_jsxDEV("section", {
      style: S.card,
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: S.cardLabel,
        children: "薬液の総量"
      }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
        style: S.segWrap,
        children: [/*#__PURE__*/_jsxDEV("button", {
          onClick: () => p.setMode("direct"),
          style: {
            ...S.seg,
            ...(p.mode === "direct" ? S.segOn : {})
          },
          children: "総量を直接入力"
        }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
          onClick: () => p.setMode("area"),
          style: {
            ...S.seg,
            ...(p.mode === "area" ? S.segOn : {})
          },
          children: "面積から計算"
        }, void 0, false)]
      }, void 0, true), p.mode === "direct" ? /*#__PURE__*/_jsxDEV("div", {
        style: S.totalRow,
        children: [/*#__PURE__*/_jsxDEV("input", {
          type: "number",
          inputMode: "decimal",
          min: "0",
          step: "0.5",
          value: p.totalL,
          onChange: e => p.setTotalL(e.target.value),
          style: S.totalInput,
          className: "num",
          "aria-label": "総量(L)"
        }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
          style: S.totalUnit,
          children: "L"
        }, void 0, false)]
      }, void 0, true) : /*#__PURE__*/_jsxDEV("div", {
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.areaGrid,
          children: [/*#__PURE__*/_jsxDEV("label", {
            style: S.areaField,
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.smallLabel,
              children: "散布面積"
            }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
              style: S.inline,
              children: [/*#__PURE__*/_jsxDEV("input", {
                type: "number",
                inputMode: "decimal",
                min: "0",
                value: p.areaA,
                onChange: e => p.setAreaA(e.target.value),
                style: S.midInput,
                className: "num"
              }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
                style: S.midUnit,
                children: "a"
              }, void 0, false)]
            }, void 0, true)]
          }, void 0, true), /*#__PURE__*/_jsxDEV("label", {
            style: S.areaField,
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.smallLabel,
              children: "10aあたり散布量"
            }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
              style: S.inline,
              children: [/*#__PURE__*/_jsxDEV("input", {
                type: "number",
                inputMode: "decimal",
                min: "0",
                value: p.ratePer10a,
                onChange: e => p.setRatePer10a(e.target.value),
                style: S.midInput,
                className: "num"
              }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
                style: S.midUnit,
                children: "L"
              }, void 0, false)]
            }, void 0, true)]
          }, void 0, true)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
          style: S.derived,
          children: ["必要総量 ", /*#__PURE__*/_jsxDEV("strong", {
            style: {
              fontSize: 26
            },
            className: "num",
            children: fmt(p.effTotalL, 2)
          }, void 0, false), " L"]
        }, void 0, true)]
      }, void 0, true)]
    }, void 0, true), /*#__PURE__*/_jsxDEV("section", {
      style: S.card,
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: S.cardLabel,
        children: "薬剤(名前・剤型・希釈倍率)"
      }, void 0, false), p.calc.map(c => /*#__PURE__*/_jsxDEV("div", {
        style: S.chemBlock,
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.chemTop,
          children: [/*#__PURE__*/_jsxDEV("span", {
            style: {
              ...S.dot,
              background: c.color
            }
          }, void 0, false), /*#__PURE__*/_jsxDEV("input", {
            value: c.name,
            placeholder: "薬剤名",
            onChange: e => p.update(c.id, "name", e.target.value),
            style: S.nameInput
          }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
            onClick: () => p.removeChem(c.id),
            style: S.removeBtn,
            disabled: p.chems.length <= 1,
            "aria-label": "削除",
            children: "✕"
          }, void 0, false)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
          style: S.chemBottom,
          children: [/*#__PURE__*/_jsxDEV("select", {
            value: c.form,
            onChange: e => p.update(c.id, "form", e.target.value),
            style: S.formSelect,
            children: FORMS.map(f => /*#__PURE__*/_jsxDEV("option", {
              value: f.key,
              children: f.label
            }, f.key, false))
          }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
            style: S.inline,
            children: [/*#__PURE__*/_jsxDEV("input", {
              type: "number",
              inputMode: "decimal",
              min: "1",
              placeholder: "倍率",
              value: c.ratio,
              onChange: e => p.update(c.id, "ratio", e.target.value),
              style: S.ratioInput,
              className: "num"
            }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
              style: S.midUnit,
              children: "倍"
            }, void 0, false)]
          }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
            style: S.chemResult,
            className: "num",
            children: c.valid && p.totalMl > 0 ? /*#__PURE__*/_jsxDEV("span", {
              children: ["→ ", /*#__PURE__*/_jsxDEV("strong", {
                children: fmt(c.ml)
              }, void 0, false), " mL"]
            }, void 0, true) : /*#__PURE__*/_jsxDEV("span", {
              style: {
                color: "#aab5ac"
              },
              children: "—"
            }, void 0, false)
          }, void 0, false)]
        }, void 0, true)]
      }, c.id, true)), /*#__PURE__*/_jsxDEV("button", {
        onClick: p.addChem,
        style: S.addBtn,
        children: "＋ 薬剤を追加"
      }, void 0, false)]
    }, void 0, true), /*#__PURE__*/_jsxDEV("section", {
      style: S.card,
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: S.cardLabel,
        children: "調合結果"
      }, void 0, false), p.over && /*#__PURE__*/_jsxDEV("div", {
        style: S.alert,
        children: "⚠ 薬剤の合計がタンク総量を超えています。倍率か総量を見直してください。"
      }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
        style: S.waterBox,
        children: [/*#__PURE__*/_jsxDEV("div", {
          children: [/*#__PURE__*/_jsxDEV("div", {
            style: {
              fontSize: 12,
              fontWeight: 700,
              color: "#2b5a7a"
            },
            children: "水の量"
          }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
            style: {
              fontSize: 34,
              fontWeight: 800,
              lineHeight: 1.1
            },
            className: "num",
            children: [p.over || p.totalMl <= 0 ? "—" : fmtL(p.waterMl), /*#__PURE__*/_jsxDEV("span", {
              style: {
                fontSize: 16
              },
              children: " L"
            }, void 0, false)]
          }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
            style: {
              fontSize: 12.5,
              color: "#4a6a80"
            },
            className: "num",
            children: p.over || p.totalMl <= 0 ? "" : `（${fmt(p.waterMl)} mL）`
          }, void 0, false)]
        }, void 0, true), /*#__PURE__*/_jsxDEV(TankViz, {
          calc: p.calc,
          waterMl: p.waterMl,
          totalMl: p.totalMl,
          over: p.over
        }, void 0, false)]
      }, void 0, true), /*#__PURE__*/_jsxDEV("table", {
        style: S.table,
        children: /*#__PURE__*/_jsxDEV("tbody", {
          children: p.calc.filter(c => c.valid).map(c => /*#__PURE__*/_jsxDEV("tr", {
            style: S.tr,
            children: [/*#__PURE__*/_jsxDEV("td", {
              style: S.tdName,
              children: [/*#__PURE__*/_jsxDEV("span", {
                style: {
                  ...S.dot,
                  background: c.color
                }
              }, void 0, false), c.name || "(無名)", /*#__PURE__*/_jsxDEV("span", {
                style: S.tdSub,
                children: [formLabel(c.form), "・", fmt(parseFloat(c.ratio)), "倍"]
              }, void 0, true)]
            }, void 0, true), /*#__PURE__*/_jsxDEV("td", {
              style: S.tdMl,
              className: "num",
              children: [fmt(c.ml), /*#__PURE__*/_jsxDEV("small", {
                style: S.unit,
                children: " mL"
              }, void 0, false)]
            }, void 0, true)]
          }, c.id, true))
        }, void 0, false)
      }, void 0, false), p.mixOrder.length > 0 && /*#__PURE__*/_jsxDEV("div", {
        style: S.orderBox,
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.orderTitle,
          children: "推奨の混和順序"
        }, void 0, false), /*#__PURE__*/_jsxDEV("ol", {
          style: S.orderList,
          children: [/*#__PURE__*/_jsxDEV("li", {
            style: S.orderItem,
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.orderStep,
              children: "1"
            }, void 0, false), "タンクに水を半量ほど入れる"]
          }, void 0, true), p.mixOrder.map((c, i) => /*#__PURE__*/_jsxDEV("li", {
            style: S.orderItem,
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.orderStep,
              children: i + 2
            }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
              style: {
                ...S.dot,
                background: c.color
              }
            }, void 0, false), /*#__PURE__*/_jsxDEV("strong", {
              children: c.name || "(無名)"
            }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
              style: S.tdSub,
              children: [formLabel(c.form), "・", fmt(c.ml), " mL"]
            }, void 0, true), /*#__PURE__*/_jsxDEV("span", {
              style: {
                marginLeft: "auto",
                fontSize: 12,
                color: "#66756a"
              },
              children: "よく撹拌"
            }, void 0, false)]
          }, c.id, true)), /*#__PURE__*/_jsxDEV("li", {
            style: S.orderItem,
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.orderStep,
              children: p.mixOrder.length + 2
            }, void 0, false), "残りの水を加えて全量にする"]
          }, void 0, true)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("p", {
          style: S.note,
          children: ["※ 一般的な剤型順の目安です。", /*#__PURE__*/_jsxDEV("strong", {
            children: "混用可否と順序は必ず各薬剤のラベル・メーカー指示を優先"
          }, void 0, false), "してください。"]
        }, void 0, true)]
      }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
        style: S.saveRow,
        children: /*#__PURE__*/_jsxDEV("input", {
          value: p.field,
          placeholder: "圃場名(記録用)",
          onChange: e => p.setField(e.target.value),
          style: S.fieldInput
        }, void 0, false)
      }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
        style: S.btnRow,
        children: [/*#__PURE__*/_jsxDEV("button", {
          onClick: p.savePreset,
          style: S.secondaryBtn,
          children: "⭐ プリセット保存"
        }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
          onClick: p.saveRecord,
          disabled: !p.ready,
          style: {
            ...S.primaryBtn,
            opacity: p.ready ? 1 : 0.4
          },
          children: "📋 記録に保存"
        }, void 0, false)]
      }, void 0, true)]
    }, void 0, true)]
  }, void 0, true);
}
function TankViz({
  calc,
  waterMl,
  totalMl,
  over
}) {
  return /*#__PURE__*/_jsxDEV("div", {
    style: S.tank,
    role: "img",
    "aria-label": "タンク内訳",
    children: [!over && totalMl > 0 && /*#__PURE__*/_jsxDEV(React.Fragment, {
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: {
          height: `${waterMl / totalMl * 100}%`,
          background: "#4A90C4"
        }
      }, void 0, false), calc.filter(c => c.valid).map(c => /*#__PURE__*/_jsxDEV("div", {
        style: {
          height: `${c.ml / totalMl * 100}%`,
          background: c.color,
          minHeight: c.ml > 0 ? 3 : 0
        }
      }, c.id, false))]
    }, void 0, true), (over || totalMl <= 0) && /*#__PURE__*/_jsxDEV("div", {
      style: {
        height: "100%",
        background: over ? "#C74E36" : "#dfe6dc",
        opacity: 0.25
      }
    }, void 0, false)]
  }, void 0, true);
}

// ═══════════════════ プリセットタブ ═══════════════════
function PresetsTab({
  presets,
  loadPreset,
  deletePreset
}) {
  return /*#__PURE__*/_jsxDEV("section", {
    style: S.card,
    children: [/*#__PURE__*/_jsxDEV("div", {
      style: S.cardLabel,
      children: "保存済みプリセット"
    }, void 0, false), presets.length === 0 && /*#__PURE__*/_jsxDEV("p", {
      style: S.empty,
      children: ["まだプリセットがありません。", /*#__PURE__*/_jsxDEV("br", {}, void 0, false), "調合計算の画面で「⭐ プリセット保存」を押すと、薬剤の組み合わせをここに保存できます。"]
    }, void 0, true), presets.map(p => /*#__PURE__*/_jsxDEV("div", {
      style: S.listItem,
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: {
          flex: 1,
          minWidth: 0
        },
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.listTitle,
          children: p.name
        }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
          style: S.listSub,
          children: p.chems.map(c => `${c.name || "(無名)"} ${c.ratio}倍`).join(" ／ ")
        }, void 0, false)]
      }, void 0, true), /*#__PURE__*/_jsxDEV("button", {
        onClick: () => loadPreset(p),
        style: S.smallPrimary,
        children: "読込"
      }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
        onClick: () => {
          if (confirm(`「${p.name}」を削除しますか？`)) deletePreset(p.id);
        },
        style: S.smallDanger,
        children: "削除"
      }, void 0, false)]
    }, p.id, true))]
  }, void 0, true);
}

// ═══════════════════ 記録タブ ═══════════════════
function RecordsTab({
  records,
  deleteRecord,
  exportCSV,
  gasUrl,
  setGasUrl,
  recorder,
  setRecorder,
  testConnection,
  syncPending,
  syncing
}) {
  const [showSettings, setShowSettings] = useState(() => !gasUrl);
  const pending = records.filter(r => !r.synced).length;
  return /*#__PURE__*/_jsxDEV(React.Fragment, {
    children: [/*#__PURE__*/_jsxDEV("section", {
      style: S.card,
      className: "no-print",
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        },
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.cardLabel,
          children: "調合記録(防除履歴)"
        }, void 0, false), /*#__PURE__*/_jsxDEV("div", {
          style: {
            display: "flex",
            gap: 8
          },
          children: [/*#__PURE__*/_jsxDEV("button", {
            onClick: exportCSV,
            disabled: records.length === 0,
            style: {
              ...S.smallPrimary,
              opacity: records.length ? 1 : 0.4
            },
            children: "CSV出力"
          }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
            onClick: () => window.print(),
            disabled: records.length === 0,
            style: {
              ...S.smallSecondary,
              opacity: records.length ? 1 : 0.4
            },
            children: "印刷"
          }, void 0, false)]
        }, void 0, true)]
      }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
        style: S.syncBar,
        children: [gasUrl ? pending === 0 ? /*#__PURE__*/_jsxDEV("span", {
          style: {
            color: "#2E7D4F",
            fontWeight: 700
          },
          children: "☁️ すべてスプレッドシートに送信済み"
        }, void 0, false) : /*#__PURE__*/_jsxDEV("span", {
          style: {
            color: "#8a5a1c",
            fontWeight: 700
          },
          children: ["☁️ 未送信 ", pending, "件", /*#__PURE__*/_jsxDEV("button", {
            onClick: () => syncPending(),
            disabled: syncing,
            style: {
              ...S.smallPrimary,
              marginLeft: 10,
              opacity: syncing ? 0.5 : 1
            },
            children: syncing ? "送信中…" : "今すぐ送信"
          }, void 0, false)]
        }, void 0, true) : /*#__PURE__*/_jsxDEV("span", {
          style: {
            color: "#8a978e"
          },
          children: "☁️ スプレッドシート連携:未設定"
        }, void 0, false), /*#__PURE__*/_jsxDEV("button", {
          onClick: () => setShowSettings(!showSettings),
          style: S.linkBtn,
          children: showSettings ? "設定を閉じる" : "設定"
        }, void 0, false)]
      }, void 0, true), showSettings && /*#__PURE__*/_jsxDEV("div", {
        style: S.settingsBox,
        children: [/*#__PURE__*/_jsxDEV("label", {
          style: S.areaField,
          children: [/*#__PURE__*/_jsxDEV("span", {
            style: S.smallLabel,
            children: "送信先URL(Apps ScriptのウェブアプリURL)"
          }, void 0, false), /*#__PURE__*/_jsxDEV("input", {
            value: gasUrl,
            onChange: e => setGasUrl(e.target.value),
            placeholder: "https://script.google.com/macros/s/…/exec",
            style: S.fieldInput,
            inputMode: "url",
            autoCapitalize: "off"
          }, void 0, false)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("label", {
          style: {
            ...S.areaField,
            marginTop: 10
          },
          children: [/*#__PURE__*/_jsxDEV("span", {
            style: S.smallLabel,
            children: "記録者名(シートに記載されます・任意)"
          }, void 0, false), /*#__PURE__*/_jsxDEV("input", {
            value: recorder,
            onChange: e => setRecorder(e.target.value),
            placeholder: "例:藤本",
            style: S.fieldInput
          }, void 0, false)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("button", {
          onClick: testConnection,
          style: {
            ...S.secondaryBtn,
            width: "100%",
            marginTop: 12
          },
          children: "接続テスト"
        }, void 0, false)]
      }, void 0, true)]
    }, void 0, true), /*#__PURE__*/_jsxDEV("section", {
      style: S.card,
      id: "print-area",
      children: [/*#__PURE__*/_jsxDEV("div", {
        style: {
          ...S.cardLabel,
          display: "none"
        },
        className: "print-only",
        children: "調合記録一覧"
      }, void 0, false), records.length === 0 && /*#__PURE__*/_jsxDEV("p", {
        style: S.empty,
        children: ["まだ記録がありません。", /*#__PURE__*/_jsxDEV("br", {}, void 0, false), "調合計算の画面で「📋 記録に保存」を押すと、日付・圃場・薬量が履歴として残ります。"]
      }, void 0, true), records.map(r => /*#__PURE__*/_jsxDEV("div", {
        style: S.record,
        children: [/*#__PURE__*/_jsxDEV("div", {
          style: S.recordHead,
          children: [/*#__PURE__*/_jsxDEV("div", {
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: S.recordDate,
              className: "num",
              children: r.date
            }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
              style: S.recordField,
              children: r.field
            }, void 0, false), /*#__PURE__*/_jsxDEV("span", {
              style: r.synced ? S.badgeOk : S.badgePending,
              className: "no-print",
              children: r.synced ? "✓送信済" : "未送信"
            }, void 0, false)]
          }, void 0, true), /*#__PURE__*/_jsxDEV("button", {
            onClick: () => {
              if (confirm("この記録を削除しますか？")) deleteRecord(r.id);
            },
            style: {
              ...S.smallDanger,
              padding: "4px 10px"
            },
            className: "no-print",
            children: "削除"
          }, void 0, false)]
        }, void 0, true), /*#__PURE__*/_jsxDEV("div", {
          style: S.recordBody,
          children: [/*#__PURE__*/_jsxDEV("div", {
            style: S.recordTotal,
            className: "num",
            children: ["総量 ", /*#__PURE__*/_jsxDEV("strong", {
              children: [fmt(r.totalL, 2), " L"]
            }, void 0, true), "(水 ", fmtL(r.waterMl), " L)"]
          }, void 0, true), r.chems.map((c, i) => /*#__PURE__*/_jsxDEV("div", {
            style: S.recordChem,
            className: "num",
            children: [/*#__PURE__*/_jsxDEV("span", {
              style: {
                ...S.dot,
                background: SWATCHES[i % SWATCHES.length]
              }
            }, void 0, false), c.name, /*#__PURE__*/_jsxDEV("span", {
              style: S.tdSub,
              children: [formLabel(c.form), "・", c.ratio, "倍"]
            }, void 0, true), /*#__PURE__*/_jsxDEV("span", {
              style: {
                marginLeft: "auto",
                fontWeight: 700
              },
              children: [fmt(c.ml), " mL"]
            }, void 0, true)]
          }, i, true))]
        }, void 0, true)]
      }, r.id, true))]
    }, void 0, true)]
  }, void 0, true);
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
    fontSize: 10,
    letterSpacing: "0.2em",
    fontWeight: 700,
    color: "#2E7D4F"
  },
  title: {
    fontSize: 24,
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
    fontSize: 11,
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
    padding: "10px 0",
    fontSize: 13.5,
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
    fontSize: 38,
    fontWeight: 800,
    width: 150,
    border: "none",
    borderBottom: "3px solid #2E7D4F",
    background: "transparent",
    padding: "0 4px 2px",
    color: "#1C2B21"
  },
  totalUnit: {
    fontSize: 20,
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
    fontSize: 12,
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
    fontSize: 22,
    fontWeight: 700,
    padding: "8px 10px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 9,
    background: "#FAFBF8"
  },
  midUnit: {
    fontSize: 14,
    fontWeight: 700,
    color: "#66756a"
  },
  derived: {
    marginTop: 12,
    padding: "10px 14px",
    background: "#EDF5EE",
    borderRadius: 9,
    fontSize: 14,
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
    fontSize: 16,
    padding: "10px 10px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff"
  },
  formSelect: {
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 8px",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff"
  },
  ratioInput: {
    width: 82,
    fontSize: 17,
    fontWeight: 700,
    padding: "9px 8px",
    textAlign: "right",
    border: "1.5px solid #D8E0D2",
    borderRadius: 8,
    background: "#fff"
  },
  chemResult: {
    fontSize: 14.5,
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
    padding: "13px 0",
    fontSize: 14.5,
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
    padding: "10px 12px",
    fontSize: 13.5,
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
    padding: "10px 4px",
    fontSize: 14.5,
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap"
  },
  tdSub: {
    fontSize: 11.5,
    color: "#8a978e",
    marginLeft: 3
  },
  tdMl: {
    padding: "10px 4px",
    textAlign: "right",
    fontSize: 17,
    fontWeight: 700,
    whiteSpace: "nowrap"
  },
  unit: {
    fontSize: 11,
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
    fontSize: 13,
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
    fontSize: 13.5,
    flexWrap: "wrap"
  },
  orderStep: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "#B78A1F",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  note: {
    fontSize: 11.5,
    color: "#8a978e",
    margin: "10px 0 0"
  },
  saveRow: {
    marginBottom: 10
  },
  fieldInput: {
    width: "100%",
    fontSize: 15,
    padding: "11px 12px",
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
    padding: "14px 0",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 11,
    cursor: "pointer"
  },
  secondaryBtn: {
    padding: "14px 0",
    fontSize: 15,
    fontWeight: 800,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #2E7D4F",
    borderRadius: 11,
    cursor: "pointer"
  },
  smallPrimary: {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    background: "#2E7D4F",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  smallSecondary: {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    color: "#2E7D4F",
    background: "#EDF5EE",
    border: "1.5px solid #2E7D4F",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0
  },
  smallDanger: {
    padding: "8px 12px",
    fontSize: 13,
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
    fontSize: 15,
    fontWeight: 800
  },
  listSub: {
    fontSize: 12.5,
    color: "#66756a",
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  empty: {
    fontSize: 14,
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
    fontSize: 13.5,
    fontWeight: 800
  },
  recordField: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "#2E7D4F",
    marginLeft: 10
  },
  recordBody: {
    padding: "10px 12px"
  },
  recordTotal: {
    fontSize: 13.5,
    marginBottom: 8,
    color: "#33443a"
  },
  recordChem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 13.5,
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
    fontSize: 13,
    flexWrap: "wrap"
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#3B7EA1",
    fontSize: 13,
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
    fontSize: 11,
    fontWeight: 800,
    color: "#2E7D4F",
    background: "#EDF5EE",
    borderRadius: 6,
    padding: "2px 7px",
    marginLeft: 8
  },
  badgePending: {
    fontSize: 11,
    fontWeight: 800,
    color: "#8a5a1c",
    background: "#FBF7EC",
    border: "1px solid #E4D6AC",
    borderRadius: 6,
    padding: "2px 7px",
    marginLeft: 8
  }
};
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/_jsxDEV(App, {}, void 0, false));
