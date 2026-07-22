# 認証機能の導入手順

## ファイル構成

```
festival-map-auth/
├── auth.html            ログイン・新規登録ページ
├── dashboard.html        ログイン後のページ(この上に今後グループ機能等を追加)
├── supabase-config.js    ★ここにSupabaseの接続情報を書く
├── css/style.css         共通スタイル
└── js/
    ├── supabaseClient.js  Supabaseクライアントの初期化
    ├── sessionGuard.js     ログイン必須ページ用の共通処理
    ├── auth.js             ログイン・新規登録フォームの処理
    └── dashboard.js        ダッシュボードの処理
```

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

## 次のステップ

このダッシュボード(`dashboard.html`)の中身に、次は
「グループ作成・招待コードで参加」の機能を追加していきます。