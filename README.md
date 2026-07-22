# 認証機能の導入手順

## ファイル構成

```
festival-map-auth/
├── .nojekyll             ★リポジトリのルートに置く(READMEが誤って表示される問題を防ぐ)
├── auth.html            ログイン・新規登録ページ
├── dashboard.html        ログイン後のページ。グループ作成・参加のUIを含む
├── supabase-config.js    ★ここにSupabaseの接続情報を書く
├── css/style.css         共通スタイル
└── js/
    ├── supabaseClient.js  Supabaseクライアントの初期化
    ├── sessionGuard.js     ログイン必須ページ用の共通処理
    ├── auth.js             ログイン・新規登録フォームの処理
    ├── groups.js           グループ作成・参加・招待コード管理の処理
    └── dashboard.js        ダッシュボードの処理
```

## GitHub PagesでREADMEが表示されてしまう場合

GitHub Pagesは標準でJekyllを使ってビルドしており、`index.html`が無いフォルダには
`README.md`を自動でトップページとして表示する仕様があります。
リポジトリの**ルート**(既存の`index.html`と同じ階層)に空の`.nojekyll`ファイルを
1つ置くと、この挙動を含めJekyll処理自体が無効になり解消します。

## 導入手順

1. これらのファイル一式を、既存の `festival-map` リポジトリの直下(もしくは任意のサブフォルダ)にコピーする
2. `supabase-config.js` を開き、以下を書き換える
   - `SUPABASE_URL`: Supabaseダッシュボードの Project Settings → API に表示されている Project URL
   - `SUPABASE_ANON_KEY`: 同じ画面の anon public key
3. GitHub Pagesの設定で、Supabaseダッシュボードの **Authentication → URL Configuration** の
   Site URL / Redirect URLs に、あなたのGitHub PagesのURL
   (例: `https://pbl-48.github.io/festival-map/`)を追加しておく
   (パスワードリセットメールなどのリンクが正しく機能するようになります)
4. コミット・プッシュしてGitHub Pagesにデプロイすれば、`auth.html` からログイン・新規登録ができます

## 動作の流れ

- `auth.html` を開く → ログイン/新規登録タブを切り替えてフォーム送信
- 新規登録すると、Supabase側の `handle_new_user` トリガーが自動で `profiles` テーブルに行を作る
- ログイン成功後は `dashboard.html` にリダイレクトされる
- `dashboard.html` は読み込み時に `requireAuth()` でセッションを確認し、
  ログインしていなければ自動的に `auth.html` に戻す
- ログアウトボタンでセッションを破棄して `auth.html` に戻る

## 既存の index.html への組み込み方

既存のトップページ(CSV入力・シフト表示のページ)にログイン状態を反映させたい場合は、
ページの `<script type="module">` 内で以下のように呼び出してください。

```js
import { requireAuth } from './js/sessionGuard.js';

const user = await requireAuth(); // 未ログインなら自動でauth.htmlへ
// user.id を使って、以降のグループ・シフト機能のAPI呼び出しに利用する
```

## グループ機能について

`dashboard.html`に以下を追加しました。

- **グループを作成する**: フォームに名前を入れて送信すると、8桁の招待コードが
  その場に一度だけ表示されます。必ずメモしてから閉じてください(仕組み上、あとから
  同じコードを見返すことはできません。忘れた場合は「招待コードを再発行」で新しいコードを発行できます)
- **招待コードで参加する**: 作成者から受け取ったコードを入力するだけで参加できます
- **参加しているグループ一覧**: 自分が所属する全グループが表示され、作成者は
  「招待コードを再発行」、メンバーは「グループを抜ける」操作ができます

この機能を有効にするには、Supabase側のSQL Editorで以下のマイグレーションを
実行してください(チャット本文に記載したSQL)。

## シフト機能について

`shifts.html`を追加しました。

- **シフトを提出する**: 所属グループを選ぶと、そのグループ(サークル)のメンバー一覧が
  その場に表示されます。イベント・ブースは任意選択で、一覧になければ
  「+ 新しいイベントを追加」「+ 新しいブースを追加」でその場に作成できます
  (誰でも投稿できる仕様です)
- **みんなのシフト**: デフォルトで自分が所属する全グループのシフトを日時順に表示します。
  「表示するグループ」で特定の1グループだけに絞り込むこともできます(advanced機能)

この機能を使うには、Supabase側で以下のマイグレーションを実行してください
(チャット本文に記載したSQL。`shifts`と`group_members`の`user_id`が
`profiles`テーブルと結びつくよう外部キーを張り替え、氏名を一度のクエリで
取得できるようにしています)。

## 次のステップ

ここまでで「アカウント」「グループ」「シフト入力・閲覧」「イベント/ブース投稿」の
主要機能がひと通り揃いました。既存の`index.html`(CSV読み込み版)をこの新しい仕組みに
置き換えるか、しばらく並行運用するか、方針を決めていきましょう。