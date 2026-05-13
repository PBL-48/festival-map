# Festival Map — シフト可視化 (簡易プロトタイプ)

このリポジトリは学園祭の屋台と友達のシフトをOpenStreetMap上に表示する簡易Webアプリのプロトタイプです。

## ファイル

- [index.html](index.html) — エントリ。
- [app.js](app.js) — メインロジック（Leaflet + PapaParse）。
- [styles.css](styles.css) — スタイル。
- [places.csv](places.csv) — サンプルの場所CSV。
- [stalls.csv](stalls.csv) — サンプルの出店CSV。
- [shifts.csv](shifts.csv) — 参考用のシフトCSV。

## CSVフォーマット

### 場所CSV (`places.csv`)

- ヘッダ: `id,name,lat,lng`
- `name` は場所名です。
- 例: `1,ステージ,35.6815,139.7669`
- [Google マイマップ](https://www.google.com/maps/d/u/0/edit?mid=1BythfKWsq5MXOL_D3_keSonX1tmgkkM&usp=sharing)を利用して作成しました。

### 出店CSV (`stalls.csv`)

- ヘッダ: `name,place,owner,content`
- `place` は [places.csv](places.csv) の `name` と結合するキーです。
  - 建物系は教室の部分を手作業で削除して場所csvと結合するようにしています。
  - 複数個所にまたがる場合も一か所だけ代表点として扱いました。
- `name` は出店名です。重複しない前提です。
- `owner` / `content` は出店詳細です。
- 例: `軽音ライブ,ステージ,軽音部,焼きそば`
- 五月祭公式のAPIから取得したjsonファイル `stalls.json` を、`json_parse.py`でcsvに変換しました。

### シフトCSV (`shifts.csv`)

- ヘッダ: `name,stall_name,date,start,end`
- `stall_name` は [stalls.csv](stalls.csv) の `name` と一致させる必要があります。
  - 本当は企画IDを外部キーとするのが最も良いのですが、企画責任者ではない人たちが知っていることは少なく、そのほかの情報で最も表記ゆれが少ないであろう属性がこれだと判断したためです。
- `date` は省略可能（空なら今日として扱う）。
- `start` / `end`: `HH:MM` (24時間)
- 例: `Taro,軽音ライブ,2026-05-16,10:00,12:30`

## 使い方

1. ブラウザで [index.html](index.html) を開きます。
2. [places.csv](places.csv) と [stalls.csv](stalls.csv) を自動読み込みし、`places.name` と `stalls.place` で結合します。
3. 右側に [shifts.csv](shifts.csv) のサンプルシフトが表示されます。`stall_name` は企画名で、`stalls.csv` の `name` と完全一致させます。
4. シフトCSVを選択して「このデバイスとブラウザに保存」を押すと、CSV内容を取り込み、ブラウザの `localStorage` にJSONで保存します。
5. 再読み込み時は localStorage のシフトが自動反映されます。
6. マップ上のピンにホバーすると、出店名、出店主体、出店内容、予定が表示されます。

## 入力チェック

- `stall_name` は [stalls.csv](stalls.csv) の `name` と完全一致が必須です。
- 未登録の企画名が含まれるシフトCSVは保存できません。
