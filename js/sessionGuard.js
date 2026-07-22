// ログインが必要なページの先頭でimportして使う。
// セッションがなければ自動的にauth.htmlへ飛ばす。
import { supabase } from './supabaseClient.js';

/**
 * ログイン済みならユーザー情報を返す。未ログインならauth.htmlへリダイレクトする。
 * @returns {Promise<import('@supabase/supabase-js').User|null>}
 */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = 'auth.html';
    return null;
  }
  return session.user;
}

// ログイン状態が変化したとき(他タブでログアウトした等)も追従する
export function watchAuthChanges(onSignedOut) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      onSignedOut ? onSignedOut() : (window.location.href = 'auth.html');
    }
  });
}