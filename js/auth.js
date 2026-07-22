import { supabase } from './supabaseClient.js';

const heading = document.getElementById('heading');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const fieldName = document.getElementById('field-name');
const displayNameInput = document.getElementById('display-name');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const form = document.getElementById('auth-form');
const submitBtn = document.getElementById('submit-btn');
const messageBox = document.getElementById('message');

let mode = 'login'; // 'login' | 'signup'

// すでにログイン済みなら、フォームを見せずにダッシュボードへ
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = 'dashboard.html';
});

function setMode(newMode) {
  mode = newMode;
  const isLogin = mode === 'login';

  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabSignup.setAttribute('aria-selected', String(!isLogin));
  heading.textContent = isLogin ? 'ログイン' : '新規登録';
  submitBtn.textContent = isLogin ? 'ログイン' : 'アカウントを作成';
  fieldName.hidden = isLogin;
  passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  hideMessage();
}

tabLogin.addEventListener('click', () => setMode('login'));
tabSignup.addEventListener('click', () => setMode('signup'));

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
}

function hideMessage() {
  messageBox.className = 'message';
  messageBox.textContent = '';
}

// Supabaseのエラーメッセージを、ユーザー向けの日本語に変換する
function translateError(error) {
  const msg = error?.message || '';
  if (msg.includes('Invalid login credentials')) {
    return 'メールアドレスまたはパスワードが違います';
  }
  if (msg.includes('already registered') || msg.includes('already been registered')) {
    return 'このメールアドレスは既に登録されています。ログインをお試しください';
  }
  if (msg.includes('Password should be at least')) {
    return 'パスワードは6文字以上にしてください';
  }
  return `エラーが発生しました: ${msg}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage();
  submitBtn.disabled = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = 'dashboard.html';
    } else {
      const displayName = displayNameInput.value.trim() || email.split('@')[0];
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) throw error;

      if (data.session) {
        // メール確認が無効な設定の場合は、そのままログイン状態になる
        window.location.href = 'dashboard.html';
      } else {
        showMessage('登録が完了しました。届いた確認メールのリンクを開いてからログインしてください。', 'success');
        setMode('login');
      }
    }
  } catch (error) {
    showMessage(translateError(error), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});