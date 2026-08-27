# 使い方・初期設定マニュアル(PDF)を作る。配布物ではない(生成スクリプト)。
#
#   python tools/make_manual_pdf.py
#   → docs/マニュアル_使い方と初期設定.pdf
#
# フォントについて
#   日本語を PDF に埋め込む。埋め込まないと、開く側の環境に日本語フォントが
#   無いときに文字化けではなく「何も表示されない」状態になる。
#   Windows 同梱の NotoSansJP-VF.ttf は可変フォントで、既定インスタンスが
#   Thin(細すぎる)ため、fontTools で wght=400 / 700 に固定してから埋め込む。
#   このフォントは SIL Open Font License 1.1(font の name ID 13/14 で確認済み)。
#   OFL は「そのフォントで作った文書」には制限を課さないため、PDF への埋め込みと
#   その PDF の配布は可。フォントファイル自体はリポジトリに置かない。
#
# 未確認: Windows 以外(macOS / Linux)でのフォント探索は実装していない。
#         FONT_SRC を書き換えて使うこと。

import io
import os
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLTTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "マニュアル_使い方と初期設定.pdf")
FONT_SRC = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"
BUILD = os.path.join(ROOT, "tools", "_fontcache")

APP_VERSION = "v8.69"

GREEN = colors.HexColor("#2F6B45")
GREEN_L = colors.HexColor("#EDF5EE")
INK = colors.HexColor("#2A362E")
SUB = colors.HexColor("#5B6B60")
LINE = colors.HexColor("#D8E0D2")
BLUE = colors.HexColor("#2A5F80")
BLUE_L = colors.HexColor("#EAF3FA")
RED = colors.HexColor("#9A3B26")
RED_L = colors.HexColor("#F6E4E0")
AMB = colors.HexColor("#7A6414")
AMB_L = colors.HexColor("#F5F0E4")


def register_fonts():
    """可変フォントを Regular / Bold に固定して登録する。"""
    os.makedirs(BUILD, exist_ok=True)
    if not os.path.exists(FONT_SRC):
        sys.exit("フォントが見つかりません: %s" % FONT_SRC)
    for name, wght, ps in (("JP", 400, "TankmixJP-Regular"), ("JP-B", 700, "TankmixJP-Bold")):
        path = os.path.join(BUILD, "%s.ttf" % ps)
        if not os.path.exists(path):
            vf = TTFont(FONT_SRC)
            static = instancer.instantiateVariableFont(vf, {"wght": wght})
            # 内部の書体名を書き換える。可変フォントを固定しても name テーブルは
            # 元のまま("NotoSansJP-Thin")なので、Regular と Bold が同じ書体名になる。
            # ReportLab は書体名で face を引くため、名前が同じだと後から登録した方が
            # 前のものと同一視され、太字にならない(実測: 見分けがつかない)。
            fam, sub = ps.split("-")
            full = fam + " " + sub
            for rec in static["name"].names:
                if rec.nameID == 1:
                    rec.string = fam
                elif rec.nameID == 2:
                    rec.string = sub
                elif rec.nameID == 4:
                    rec.string = full
                elif rec.nameID == 6:
                    rec.string = ps
                elif rec.nameID in (16, 17):
                    rec.string = fam if rec.nameID == 16 else sub
            static.save(path)
        pdfmetrics.registerFont(RLTTFont(name, path))
    # <b> を JP-B に対応づける。これが無いと Paragraph の <b> が無視される
    pdfmetrics.registerFontFamily("JP", normal="JP", bold="JP-B", italic="JP", boldItalic="JP-B")


def styles():
    def s(name, size, leading, font="JP", color=INK, space_before=0, space_after=3,
          left=0, bullet=None):
        return ParagraphStyle(name, fontName=font, fontSize=size, leading=leading,
                              textColor=color, spaceBefore=space_before,
                              spaceAfter=space_after, leftIndent=left,
                              alignment=TA_LEFT, wordWrap="CJK",
                              bulletFontName=font, bulletFontSize=size)
    return {
        "cover_t": s("cover_t", 26, 36, "JP-B", colors.white),
        "cover_s": s("cover_s", 12, 19, "JP", colors.HexColor("#CFE4D8")),
        "h1": s("h1", 16, 23, "JP-B", GREEN, space_before=6, space_after=7),
        "h2": s("h2", 12.5, 19, "JP-B", INK, space_before=7, space_after=4),
        "p": s("p", 10, 16.5, "JP", INK, space_after=4),
        "small": s("small", 9, 14.5, "JP", SUB, space_after=3),
        "li": s("li", 10, 16.5, "JP", INK, space_after=2, left=11),
        "box": s("box", 9.5, 15.5, "JP", INK, space_after=2),
        "boxb": s("boxb", 9.5, 15.5, "JP-B", INK, space_after=2),
        "stepn": s("stepn", 11, 16, "JP-B", colors.white),
        "toc": s("toc", 10.5, 18, "JP", INK, space_after=1),
    }


ST = None
CMAP = set()
STRIPPED = {}

# 絵文字はフォントに字が無い。埋め込みフォント(Noto Sans JP)に無い文字は
# PDF では豆腐(□)になるので、本文に出す前に落とす。落としたぶんは
# ビルドの最後に一覧で出して、消し過ぎていないか目で見る。
# 絵文字フォントを埋め込む手もあるが、Windows 同梱の Segoe UI Emoji は
# 再配布の許諾が無いため使わない。
KEEP = {"⚠", "→", "←", "・", "／", "☓"}


def load_cmap():
    f = TTFont(os.path.join(BUILD, "TankmixJP-Regular.ttf"))
    for t in f["cmap"].tables:
        CMAP.update(chr(c) for c in t.cmap)


def clean(text):
    out = []
    for ch in text:
        if ch in CMAP or ch in KEEP:
            out.append(ch)
        else:
            STRIPPED[ch] = STRIPPED.get(ch, 0) + 1
    t = "".join(out)
    t = re.sub(r"[ 　]+", " ", t)
    t = t.replace("「 ", "「").replace(" 」", "」").replace("（ ", "（").replace(" ）", "）")
    t = t.replace("<b> ", "<b>").replace(" </b>", "</b>")
    return t.strip()


def P(text, kind="p"):
    return Paragraph(clean(text), ST[kind])


def LI(text):
    return Paragraph(clean(text), ST["li"], bulletText="・")


def box(rows, bg, border, pad=6):
    """段落のリストを色付きの箱に入れる。"""
    t = Table([[rows]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.9, border),
        ("LEFTPADDING", (0, 0), (-1, -1), pad + 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad + 2),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def note(title, lines, tone="amber"):
    tone_map = {"amber": (AMB_L, colors.HexColor("#E2D8A9"), AMB),
                "blue": (BLUE_L, colors.HexColor("#C6DAE7"), BLUE),
                "red": (RED_L, colors.HexColor("#E7C3BA"), RED),
                "green": (GREEN_L, colors.HexColor("#BFDDCB"), GREEN)}
    bg, br, fg = tone_map[tone]
    inner = [Paragraph(clean(title), ParagraphStyle("nt", parent=ST["boxb"], textColor=fg))]
    inner += [P(x, "box") for x in lines]
    return box(inner, bg, br)


def step(n, title, lines):
    """番号つきの手順ブロック。改ページで割れないようにまとめる。"""
    num = Table([[Paragraph(str(n), ST["stepn"])]], colWidths=[9 * mm], rowHeights=[9 * mm])
    num.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    body = [Paragraph(clean(title), ST["h2"])] + [P(x) for x in lines]
    t = Table([[num, body]], colWidths=[12 * mm, 162 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE),
    ]))
    return KeepTogether(t)


def grid(header, rows, widths):
    data = [[Paragraph(clean(c), ST["boxb"]) for c in header]]
    data += [[Paragraph(clean(c), ST["box"]) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN_L),
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def on_page(canv, doc):
    canv.saveState()
    if doc.page > 1:
        canv.setFillColor(GREEN)
        canv.rect(0, A4[1] - 12 * mm, A4[0], 12 * mm, stroke=0, fill=1)
        canv.setFillColor(colors.white)
        canv.setFont("JP-B", 8.5)
        canv.drawString(18 * mm, A4[1] - 8.2 * mm, "薬液調合ノート（農薬散布防除記録）　使い方・初期設定マニュアル")
        canv.drawRightString(A4[0] - 18 * mm, A4[1] - 8.2 * mm, APP_VERSION)
        canv.setFillColor(SUB)
        canv.setFont("JP", 8.5)
        canv.drawCentredString(A4[0] / 2, 10 * mm, "- %d -" % doc.page)
    canv.restoreState()


def on_cover(canv, doc):
    canv.saveState()
    canv.setFillColor(GREEN)
    canv.rect(0, A4[1] - 78 * mm, A4[0], 78 * mm, stroke=0, fill=1)
    canv.setFillColor(colors.white)
    canv.setFont("JP-B", 24)
    canv.drawString(20 * mm, A4[1] - 40 * mm, "薬液調合ノート")
    canv.setFont("JP-B", 15)
    canv.drawString(20 * mm, A4[1] - 51 * mm, "（農薬散布防除記録）")
    canv.setFont("JP", 12)
    canv.setFillColor(colors.HexColor("#CFE4D8"))
    canv.drawString(20 * mm, A4[1] - 64 * mm, "使い方・初期設定マニュアル")
    canv.setFont("JP-B", 14)
    canv.setFillColor(colors.white)
    canv.drawRightString(A4[0] - 20 * mm, A4[1] - 40 * mm, APP_VERSION)
    canv.setFont("JP", 9)
    canv.setFillColor(colors.HexColor("#CFE4D8"))
    canv.drawRightString(A4[0] - 20 * mm, A4[1] - 50 * mm, "2026-08 時点")
    canv.setFillColor(SUB)
    canv.setFont("JP", 8.5)
    canv.drawCentredString(A4[0] / 2, 12 * mm,
                           "農薬の登録内容は変わります。使用前に必ず容器のラベルを確認してください。")
    canv.restoreState()


def build_story():
    s = []
    # ── 表紙 ──
    s.append(Spacer(1, 62 * mm))
    s.append(note("このマニュアルの使い方", [
        "初期設定は<b>2段階</b>です。①代表者が1回だけやること（Googleスプレッドシートの用意）と、",
        "②各端末で1回ずつやること（アプリの追加と設定）に分かれます。",
        "1人で使う場合も①は必要です。共有しないなら「チームコード」は空のままで構いません。",
    ], "green"))
    s.append(Spacer(1, 6 * mm))
    s.append(P("目次", "h1"))
    for i, t in enumerate([
        "このアプリでできること",
        "用意するもの",
        "初期設定①　代表者が1回だけやること",
        "初期設定②　各端末で1回ずつやること",
        "初期設定③　任意の設定（農薬データ・地図）",
        "使い方　1日の流れ",
        "共有のオン・オフ",
        "困ったとき",
        "注意と免責",
    ], start=1):
        s.append(Paragraph(clean("%d. %s" % (i, t)), ST["toc"]))
    s.append(PageBreak())

    # ── 1 ──
    s.append(P("1. このアプリでできること", "h1"))
    s.append(P("農薬タンクミックスの薬量・水量の計算と、防除記録をまとめるアプリです。"
               "ブラウザで一度開けば、<b>電波の届かない圃場でも動きます</b>（PWA）。"
               "データは各端末の中に保存され、電波のある場所で自分のGoogleスプレッドシートへ送られます。"))
    s.append(Spacer(1, 2 * mm))
    s.append(grid(
        ["タブ", "できること"],
        [["🧮 薬剤登録・希釈計算",
          "タンク1杯分の水量と薬量を計算します。薬剤（名前・剤型・希釈倍率）を登録でき、"
          "よく使う組み合わせは「⭐ プリセットに保存」で残せます。"],
         ["🚁 作業予定・進捗確認",
          "その日に回る圃場を並べ、薬剤を当て、実績を入力します。「🚦 進捗地図」に切り替えると、"
          "どこまで終わったかが色で分かります（緑＝実施済／赤＝未実施／灰＝その日の対象外）。"],
         ["🗺 圃場登録・圃場一覧",
          "地図で圃場を指で囲むと、位置と面積が登録されます。「📋 圃場一覧」で名前・作物・地区を直せます。"],
         ["⚙ 設定",
          "単位・作物マスタ・散布タンク容量・送信先の設定・農薬データの取り込み・地図の設定。"
          "使い方ガイドとバージョン履歴もここにあります。"]],
        [40, 134]))
    s.append(Spacer(1, 3 * mm))
    s.append(note("圏外でも記録できます", [
        "記録は端末の中に保存されます。電波が戻ると、未送信ぶんが自動で送られます（共有オンのとき）。",
        "地図のタイル画像だけは通信が要るので、圏外では一度見た範囲しか表示されません。",
    ], "blue"))

    # ── 2 ──
    s.append(P("2. 用意するもの", "h1"))
    s.append(LI("<b>スマホまたはタブレット</b>（iPhone は Safari、Android は Chrome）"))
    s.append(LI("<b>Googleアカウント</b>（代表者の1つで足ります。記録の保管に使います）"))
    s.append(LI("<b>チームコード</b>（自分で決める合言葉。例：<b>kashima2026</b>。同じ文字列を入れた端末どうしが共有します）"))
    s.append(LI("<b>共有パスワード</b>（推奨。他人に書き込まれないようにする合言葉。決めておいてください）"))
    s.append(Spacer(1, 2 * mm))
    s.append(note("チームコードと共有パスワードは別ものです", [
        "<b>チームコード</b>＝どのグループのデータかを分ける名札。パスワードではありません。",
        "<b>共有パスワード</b>＝書き込んでよい端末かを確かめる合言葉。Googleスプレッドシート側にも同じ文字列を設定します。",
        "共有パスワードを設定しないと、送信先のURLを知っている人なら誰でも書き込めます。",
    ], "red"))
    s.append(PageBreak())

    # ── 3 ──
    s.append(P("3. 初期設定①　代表者が1回だけやること", "h1"))
    s.append(P("記録を貯めるGoogleスプレッドシートと、その受け口（Apps Script）を用意します。"
               "<b>この作業はパソコンでやると楽です。</b>", "p"))
    s.append(step(1, "Googleスプレッドシートを新規作成する", [
        "名前は自由です（例：防除記録2026）。中身は空のままで構いません。",
        "シートは、最初の送信のときにアプリが自動で作ります。",
    ]))
    s.append(step(2, "メニューの「拡張機能 → Apps Script」を開く", [
        "最初から入っているコードを<b>すべて消して</b>、配布物の <b>Code.gs</b> の中身を貼り付け、保存します。",
    ]))
    s.append(step(3, "共有パスワードを設定する（推奨）", [
        "Apps Script の左メニュー「プロジェクトの設定」（歯車）→「スクリプト プロパティ」を開きます。",
        "プロパティ名 <b>SHARED_SECRET</b> ／ 値に自分で決めた合言葉を入れて保存します。",
        "この合言葉は、あとで各端末の「共有パスワード」欄に入れる文字列と<b>同じもの</b>にします。",
    ]))
    s.append(step(4, "ウェブアプリとしてデプロイする", [
        "右上の「デプロイ → 新しいデプロイ」→ 歯車で種類「<b>ウェブアプリ</b>」を選びます。",
        "・次のユーザーとして実行：<b>自分</b>",
        "・アクセスできるユーザー：<b>全員</b>　←ここが重要です",
        "初回は「アクセスを承認」→ 自分のアカウントを選択 →「詳細」→「（プロジェクト名）に移動」→ 許可、と進みます。",
    ]))
    s.append(step(5, "ウェブアプリのURLを控える", [
        "<b>https://script.google.com/macros/s/…/exec</b> の形のURLが表示されます。",
        "これを各端末に入れます。メールやメモアプリで共有しておくと入力が楽です。",
    ]))
    s.append(Spacer(1, 2 * mm))
    s.append(note("「アクセスできるユーザー：全員」にする理由と、その注意", [
        "各端末がログインなしで送信できるようにするための設定です。そのぶん、"
        "<b>URLを知っている人なら誰でも書き込める状態</b>になります。",
        "だから手順3の共有パスワード（SHARED_SECRET）を設定してください。設定すると、"
        "同じ合言葉を入れた端末からしか書き込めなくなります。",
    ], "red"))
    s.append(PageBreak())

    # ── 4 ──
    s.append(P("4. 初期設定②　各端末で1回ずつやること", "h1"))
    s.append(step(1, "アプリをホーム画面に追加する", [
        "配布されたURLをスマホのブラウザで開きます。",
        "<b>iPhone</b>：Safariで開く → 共有ボタン →「ホーム画面に追加」",
        "<b>Android</b>：Chromeで開く → メニュー（縦の三点マーク）→「ホーム画面に追加」または「アプリをインストール」",
        "以後はアイコンから起動でき、圏外でも動きます。",
    ]))
    s.append(step(2, "設定タブを開く", [
        "画面下の「<b>⚙ 設定</b>」→「<b>送信・共有</b>」をタップして開きます。",
    ]))
    s.append(step(3, "４つの欄を埋める", [
        "<b>送信先URL</b>：代表者から受け取った <b>…/exec</b> のURLを貼り付けます。",
        "<b>記録者名</b>：あなたの名前。スプレッドシートの「記録者」列に入ります。",
        "<b>チームコード（共有用）</b>：一緒に作業する端末で<b>まったく同じ文字列</b>にします。大文字と小文字は区別されます。",
        "<b>共有パスワード</b>：代表者が SHARED_SECRET に設定した合言葉を入れます。",
    ]))
    s.append(step(4, "「接続テスト」を押す", [
        "「<b>✅ 接続OK！</b>」と出れば完了です。",
        "「✅ 接続OK（ただし共有パスワード未設定…）」と出たときは、スプレッドシート側の SHARED_SECRET が未設定です。",
        "「古い版のスクリプトです」と出たときは、Apps Script で「デプロイ → デプロイを管理 → 鉛筆 → "
        "バージョン『新バージョン』→ デプロイ」をやり直してください（URLは変わりません）。",
    ]))
    s.append(Spacer(1, 2 * mm))
    s.append(note("同時に散布する班どうしは、同じチームコードにしてください", [
        "別のチームコードにすると、互いの圃場も進捗も見えません。班の区別は「記録者名」で行います。",
    ], "amber"))
    s.append(PageBreak())

    # ── 5 ──
    s.append(P("5. 初期設定③　任意の設定", "h1"))
    s.append(P("ここから先は、必要になったときで構いません。", "small"))

    s.append(P("5-1　農薬データの取り込み（登録番号・農薬名・成分で検索したいとき）", "h2"))
    s.append(P("農薬の登録データはアプリに同梱していません（FAMICの利用規約により再配布しない方針のため）。"
               "自分でデータを用意し、自分のGoogleドライブ経由で端末に取り込みます。"))
    s.append(LI("代表者が <b>python tools/update_chemdb.py</b> を実行して chemdb.json を作ります"))
    s.append(LI("その chemdb.json を自分のGoogleドライブにアップロードし、ファイルIDを控えます"
                "（URL の /file/d/<b>ここ</b>/view の部分）"))
    s.append(LI("Apps Script の「スクリプト プロパティ」に <b>CHEMDB_FILE_ID</b> ／ ファイルID を設定し、"
                "「新バージョン」でデプロイし直します"))
    s.append(LI("各端末で 「設定」タブ →「農薬データ」→「<b>⬇ 農薬データを取り込む</b>」を押します"
                "（約940KBを分割して受け取るので少し時間がかかります）"))
    s.append(P("一度取り込めば端末内（IndexedDB）に残り、<b>圏外でも検索できます</b>。"
               "取り込まなくてもアプリは動きます（薬剤名は手で登録できます）。", "small"))

    s.append(P("5-2　地図の設定", "h2"))
    s.append(grid(
        ["地図", "内容"],
        [["無料（既定）",
          "国土地理院タイル（標準地図・写真）を使います。APIキーは要りません。回転はできません。"],
         ["Googleマップ（任意）",
          "「設定」タブ → 地図の欄に <b>APIキー</b> を入れると使えます。Google Cloud の課金対象になります。"],
         ["指で回す（任意）",
          "さらに <b>マップID</b>（種類「ベクター」・回転と傾斜を有効にしたもの）を入れると、"
          "地図を指二本で回せます。APIキーだけでは回りません。空にすれば元に戻ります。"]],
        [40, 134]))

    s.append(P("5-3　単位・作物・散布タンク", "h2"))
    s.append(LI("<b>単位</b>：面積（a／ha／反／町）と薬量（L／mL／kg／g）の表示を切り替えられます。"
                "データは常に a・L で保存され、表示だけが変わります"))
    s.append(LI("<b>作物マスタ</b>：よく使う作物を登録しておくと、圃場登録で選べます"))
    s.append(LI("<b>散布タンク</b>：散布車の水タンク容量（既定200L）。作業一覧の「⛽ ここで補給」の目印に使われます"))
    s.append(PageBreak())

    # ── 6 ──
    s.append(P("6. 使い方　1日の流れ", "h1"))

    s.append(P("6-1　圃場を登録する（最初に1回）", "h2"))
    s.append(LI("<b>🗺 圃場登録</b>タブ →「<b>✏ 圃場を囲む</b>」→ 地図を順にタップして圃場の外周を囲みます"))
    s.append(LI("囲んだ形から<b>面積が自動で計算</b>されます。「<b>✓ 登録</b>」で圃場名・作物・地区を入力します"))
    s.append(LI("全画面ボタン（画面右上の四隅マーク）で全画面にしたまま作図でき、登録するとそのまま次の圃場を囲めます"))
    s.append(LI("登録した圃場は、共有オンなら<b>その場で他の端末に送られます</b>（1.5秒ほどまとめてから1回だけ送信）"))
    s.append(Spacer(1, 1.5 * mm))
    s.append(note("「線が交差しています」と出たら", [
        "外周をたどる順に打てていません。たとえば <b>左 → 右上 → 左下 → 右</b> の順だと2本目と4本目が交差します。"
        "正しくは <b>左 → 右上 → 右 → 左下</b> です。",
        "打ち直さなくても「<b>🔀 並び順を直す</b>」で直せます（頂点は動かさず、順番だけ並べ替えます）。"
        "大きくへこんだ形では意図と違う形になることがあるので、結果を見てから登録してください。",
        "ねじれた形のまま登録すると面積が実際よりはるかに小さく出て、その面積が薬液量にそのまま流れます。",
    ], "amber"))

    s.append(P("6-2　薬剤を登録する・調合を計算する", "h2"))
    s.append(LI("<b>🧮 薬剤登録・希釈計算</b>タブ →「<b>🧪 薬剤・プリセット</b>」で薬剤（名前・種類・剤型・希釈倍率）を登録します"))
    s.append(LI("「<b>🧮 調合電卓</b>」はタンク1杯分の計算です。総量から、または面積から計算できます"))
    s.append(LI("よく使う組み合わせは「<b>⭐ プリセットに保存</b>」で名前を付けて残し、作業タブから呼び出せます"))
    s.append(P("薬剤も共有オンなら自動で共有されます（登録・編集・削除した時点で、変わったものだけ送られます）。", "small"))

    s.append(P("6-3　その日の作業を組む", "h2"))
    s.append(LI("<b>🚁 作業予定・進捗確認</b>タブで<b>作業日</b>を選び、「<b>圃場を追加</b>」でその日に回る圃場を入れます"
                "（地区で絞り込むと、その地区をまとめて投入できます）"))
    s.append(LI("「<b>本日の散布投下量（L/10a）</b>」を入れて「<b>面積から一括計算</b>」を押すと、"
                "各圃場の予定薬液量が「面積÷10×投下量」で入ります"))
    s.append(LI("「<b>この日に使用した薬剤</b>」に、その日使う薬剤と希釈倍率を入れて圃場に当てます。"
                "薬量は「予定薬液量÷希釈倍率」で自動計算されます"))
    s.append(LI("各行の右端にある並べ替えマークを長押ししてドラッグすると散布順を並べ替えられます。"
                "タンク容量を超える手前に「<b>ここで補給</b>」の区切りが入ります"))
    s.append(LI("各行の「<b>🚗 ナビ</b>」でその圃場までの道順をGoogleマップで開けます（地図で囲んだ圃場のみ）"))
    s.append(PageBreak())

    s.append(P("6-4　散布しながら進捗を見る", "h2"))
    s.append(LI("作業日の下の「<b>📋 作業一覧 ／ 🚦 進捗地図</b>」で切り替えます"))
    s.append(LI("進捗地図で圃場をタップ →「<b>✓ 散布済にする</b>」でその場で緑に変わります。"
                "取り消すときはもう一度タップして「<b>↩ 散布済を取り消す</b>」"))
    s.append(LI("色は3つだけです。<b>緑＝実施済</b>／<b>赤＝未実施</b>／<b>灰＝その日の作業に入っていない圃場</b>"))
    s.append(LI("開いている間は一定間隔で自動的に取り直します。他の端末で「散布済」が押されると、待っていれば色が変わります"))
    s.append(LI("「<b>⊙ 今日の圃場へ</b>」でその日の圃場が入る位置へ寄せ直せます"))

    s.append(P("6-5　実績を入力して送信する", "h2"))
    s.append(LI("作業一覧の各行の「<b>🚁 実績入力</b>」で、実際の散布量とフライト数を入れます"
                "（散布面積は圃場の登録面積が自動で入ります）"))
    s.append(LI("入力後も圃場は一覧に残り、「<b>✎ 実績を修正</b>」でいつでも直せます"))
    s.append(LI("台帳（スプレッドシートの「防除記録」）へは、作業タブ下の"
                "「<b>☁ ○/○ の未送信 ○件を送信</b>」で送ります。送信済みは「<b>✓送信済</b>」と表示されます"))
    s.append(LI("圏外でも記録は端末に残り、電波が戻ると自動で再送されます。"
                "送信中に「<b>■ 送信を中止</b>」を押すと途中で止められ、どの圃場から再開するか選べます"))
    s.append(Spacer(1, 1.5 * mm))
    s.append(note("2つの「送信」の違い", [
        "<b>自動で送られるもの</b>：圃場・薬剤・その日の作業予定・進み具合。"
        "他の端末と見え方を揃えるためのもので、変えた1.5秒後に自動で送られます。",
        "<b>手で送るもの</b>：台帳の「防除記録」。作業タブ下のボタンで送ります。"
        "1行ずつ記録として残るので、あとから並べ替え・集計・印刷ができます。",
    ], "blue"))

    s.append(P("6-6　記録を取り出す", "h2"))
    s.append(LI("<b>スプレッドシート</b>：「防除記録」シートに1行ずつ貯まります。並べ替え・集計・印刷はここで"))
    s.append(LI("<b>CSV</b>：作業タブ下部の「記録」欄からCSV出力・印刷ができます"))
    s.append(LI("<b>📋 アグリノート</b>：アグリノートへ転記するための集計表を出せます"
                "（アグリノートはウォーターセル株式会社の商標です）"))
    s.append(PageBreak())

    # ── 7 ──
    s.append(P("7. 共有のオン・オフ", "h1"))
    s.append(P("画面<b>右上</b>の「<b>☁ 共有オン</b>／<b>🚫 共有オフ</b>」を押すだけで切り替わります。"
               "「設定」タブ →「送信・共有 → ０ 共有の入切」にも同じボタンがあります。"))
    s.append(Spacer(1, 2 * mm))
    s.append(grid(
        ["状態", "この端末の動き"],
        [["☁ 共有オン（既定）",
          "圃場・薬剤・作業予定・進み具合を自動でやりとりします。台帳への送信もできます。"],
         ["🚫 共有オフ",
          "<b>送りも受け取りもしません。</b>自動共有・進捗の送信・「☁ …件を送信」・"
          "「☁↑ 端末→共有へ保存」「☁↓ 共有→端末へ読込」がすべて止まります。"
          "記録は今までどおり端末に残ります。"],
         ["オンに戻したとき",
          "オフの間にたまった未送信ぶんを自動で送り、最新を取り直します。"]],
        [42, 132]))
    s.append(Spacer(1, 3 * mm))
    s.append(note("アプリを閉じても「切断」されません", [
        "このアプリは、常時つないだままの接続（WebSocketなど）を持っていません。"
        "<b>送るときだけHTTPSで1回ずつ通信する</b>作りです。",
        "そのため、アプリを閉じている間は自動の送受信が動かないだけで、"
        "次に開けば設定はそのまま、未送信ぶんから再開します。",
        "共有オン／オフの設定も端末に残り、閉じても消えません。",
    ], "green"))

    # ── 8 ──
    s.append(P("8. 困ったとき", "h1"))
    s.append(grid(
        ["症状", "確認すること"],
        [["他の端末に圃場が出ない",
          "①両方の端末の<b>チームコードが完全に同じ</b>か（大文字小文字を区別します）。"
          "②画面右上が「☁ 共有オン」か。③「設定」タブの「接続テスト」が通るか。"],
         ["「共有パスワードが違います」と出る",
          "「設定」タブの「共有パスワード」と、Apps Script のスクリプト プロパティ <b>SHARED_SECRET</b> の"
          "文字列を見比べてください。前後の空白にも注意してください。"],
         ["「古い版のスクリプトです」と出る",
          "Code.gs を貼り替えただけではウェブアプリは古い版を返し続けます。"
          "「デプロイ → デプロイを管理 → 鉛筆 → バージョン『新バージョン』→ デプロイ」をやり直してください。"],
         ["「データが大きすぎます」と出る",
          "古い方式の「☁↑ 端末→共有へ保存」の上限（45,000文字）です。"
          "通常は「🔁 今すぐ同期する」を使ってください。こちらに上限はありません。"],
         ["更新したのに画面が古いまま",
          "「設定」タブの「アプリを最新版に更新」を、<b>電波のある場所で</b>押してください。"
          "保存データ（圃場・記録・設定）は消えません。"],
         ["進捗地図に出ない圃場がある",
          "地図で囲んでいない圃場は表示できません。「地図に出せない圃場 n件（位置未登録）」と出ます。"
          "「圃場登録」タブで囲んでください。"],
         ["圏外で地図が真っ白",
          "地図のタイル画像は通信が要ります。一度見た範囲は残りますが、初めての範囲は表示できません。"]],
        [45, 129]))
    s.append(PageBreak())

    # ── 9 ──
    s.append(P("9. 注意と免責", "h1"))
    s.append(note("薬剤の使用について", [
        "アプリの農薬検索は<b>登録番号・名称の確認補助</b>です。取り込んだデータは時間とともに実態とずれます。",
        "実際に使ってよいかは、<b>必ず各薬剤の容器・ラベルの表示を優先</b>してください。",
        "農薬使用回数の警告は簡易的な目安です。作期の区切りなど、実際の運用と合っているか確認してください。",
    ], "red"))
    s.append(Spacer(1, 2 * mm))
    s.append(note("データの取り扱い", [
        "送信されるもの：圃場名／作物／面積／圃場の位置（地図で囲んだ緯度経度）／地区／薬剤／"
        "作業記録／記録者名／端末ID。",
        "端末IDは初回起動時に作られる意味のない文字列で、機種や電話番号とは関係ありません。",
        "<b>作業者の現在地（GPSの居場所）は送信しません。</b>",
        "送信先は、あなたが設定したGoogleスプレッドシートだけです。"
        "このアプリの作者を含む第三者のサーバーは通りません。",
    ], "blue"))
    s.append(Spacer(1, 2 * mm))
    s.append(note("端末を手放すとき", [
        "「設定」タブの「<b>🗑 この端末のデータをすべて消去</b>」で、端末内のデータを消せます。"
        "確認のあと「消去」と入力する二段階の確認があります。送信済みの記録はスプレッドシート側に残ります。",
    ], "amber"))
    s.append(Spacer(1, 3 * mm))
    s.append(P("このマニュアルは %s 時点のアプリに合わせて作っています。"
               "画面の文言はバージョンによって変わることがあります。"
               "最新の変更点は 「設定」タブ →「バージョン履歴」で確認できます。" % APP_VERSION, "small"))
    return s


def main():
    register_fonts()
    load_cmap()
    global ST
    ST = styles()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=18 * mm, bottomMargin=16 * mm,
                          title="薬液調合ノート 使い方・初期設定マニュアル",
                          author="", subject="農薬散布防除記録アプリ %s" % APP_VERSION)
    frame_cover = Frame(18 * mm, 16 * mm, 174 * mm, A4[1] - 34 * mm, id="cover")
    frame_body = Frame(18 * mm, 16 * mm, 174 * mm, A4[1] - 34 * mm, id="body")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame_cover], onPage=on_cover),
        PageTemplate(id="body", frames=[frame_body], onPage=on_page),
    ])
    story = build_story()
    # 表紙のあとは本文テンプレートに切り替える
    from reportlab.platypus import NextPageTemplate
    story.insert(0, NextPageTemplate("body"))
    doc.build(story)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
    if STRIPPED:
        rep = " ".join("U+%04X(%d)" % (ord(k), v) for k, v in sorted(STRIPPED.items()))
        print("フォントに無いため落とした文字:", rep)


if __name__ == "__main__":
    main()
