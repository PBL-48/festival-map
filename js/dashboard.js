import { supabase } from './supabaseClient.js';
import { requireAuth, watchAuthChanges } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;
}

watchAuthChanges();

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});