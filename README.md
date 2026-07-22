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