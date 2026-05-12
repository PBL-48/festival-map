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
- `name` は表示用の場所名です。重複して構いません。
- 例: `1,ステージ,35.6815,139.7669`

### 出店CSV (`stalls.csv`)

- ヘッダ: `name,place,owner,content`
- `place` は [places.csv](places.csv) の `name` と結合するキーです。
- `name` は出店名です。重複しない前提です。
- `owner` / `content` は出店詳細です。
- 例: `軽音ライブ,ステージ,軽音部,焼きそば`

### シフトCSV (`shifts.csv`)

- ヘッダ: `name,stall_name,date,start,end`
- `stall_name` は [stalls.csv](stalls.csv) の `name` と一致させます。
- `date` は省略可能（空なら今日として扱う）。
- `start` / `end`: `HH:MM` (24時間)
- 例: `Taro,軽音ライブ,2026-05-12,10:00,12:30`

## 使い方

1. ブラウザで [index.html](index.html) を開きます。
2. [places.csv](places.csv) と [stalls.csv](stalls.csv) を自動読み込みし、`places.name` と `stalls.place` で結合します。
3. 右側に [shifts.csv](shifts.csv) のサンプルシフトが表示されます。`stall_name` は企画名で、`stalls.csv` の `name` と完全一致させます。
4. シフトCSVを選択して「保存（localStorage）」を押すと、CSV内容を取り込み、ブラウザの `localStorage` にJSONで保存します。
5. 再読み込み時は localStorage のシフトが自動反映されます。
6. マップ上のピンにホバーすると、出店名、出店主体、出店内容、予定が表示されます。

## 入力チェック

- `stall_name` は [stalls.csv](stalls.csv) の `name` と完全一致が必須です。
- 未登録の企画名が含まれるシフトCSVは保存できません。
- 企画名はコピーペーストではなく、サンプル表示を見ながら正確に入力する前提です。

## プライバシーとデプロイについて（懸念点への回答）

- 場所CSVは全員で共通に使う想定です。これを真に共有したい場合は、サーバ上にホストしてURLから読み込むか、GitHub Pagesなどで静的に置く方法が便利です（無料）。
- シフトCSVは個人情報なので、ユーザーごとにローカル保存するのは妥当で、`localStorage` は簡単で完全無料の選択肢です。ただしブラウザ/端末故障や他人の端末使用時に見られるリスクがあります。より安全にしたいなら暗号化してlocalStorageに保存するか、ログイン付きの無料バックエンド（例: Firebase Free）を使う方法があります。

## 次の改善案

- マーカーの見た目を色分けする、またはユーザーごとにアイコンを割り当てる。
- 時刻表の重複可視化（同じ場所で複数人がいる場合など）。
- サーバを用意して場所CSVを共通ホスト、シフトは認証付きで保存する（無料枠を活用）。
