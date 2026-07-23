import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('shift-message');

const shiftForm = document.getElementById('shift-form');
const groupSelect = document.getElementById('shift-group-select');
const circleMembersEl = document.getElementById('circle-members');
const eventSelect = document.getElementById('shift-event-select');
const boothInput = document.getElementById('shift-booth-input');
const boothIdInput = document.getElementById('shift-booth-id');
const boothSuggestions = document.getElementById('shift-booth-suggestions');

let eventBooths = [];

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

// 他人の自由入力(ブース名・メモ等)をinnerHTMLに差し込む際は必ずエスケープする
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fillSelect(select, items, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
}

// ---------- グループ ----------
async function loadMyGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name)')
    .eq('user_id', userId);

  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).map((row) => row.groups);
}

async function renderCircleMembers(groupId) {
  circleMembersEl.innerHTML = '';
  if (!groupId) {
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
    return;
  }

  const { data, error } = await supabase
    .from('group_members')
    .select('profiles(display_name)')
    .eq('group_id', groupId);

  if (error || !data || data.length === 0) {
    circleMembersEl.innerHTML = '<li class="empty">メンバーが見つかりませんでした</li>';
    return;
  }

  for (const row of data) {
    const li = document.createElement('li');
    li.textContent = row.profiles?.display_name ?? '(不明なユーザー)';
    circleMembersEl.appendChild(li);
  }
}

// ---------- イベント・ブース ----------
async function loadEvents() {
  const { data, error } = await supabase.from('events').select('id, name').order('event_date', { ascending: true });
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

async function loadBooths(eventId) {
  const { data, error } = await supabase.from('booths').select('id, name').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function syncBoothSelection() {
  const value = boothInput.value.trim();
  if (!value) {
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    return;
  }

  const matchedBooth = eventBooths.find((booth) => booth.name.toLowerCase() === value.toLowerCase());
  if (matchedBooth) {
    boothIdInput.value = matchedBooth.id;
    boothInput.setCustomValidity('');
  } else {
    boothIdInput.value = '';
    boothInput.setCustomValidity('候補からブースを選んでください');
  }
}

function renderBoothSuggestions(booths) {
  boothSuggestions.innerHTML = '';
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.name;
    boothSuggestions.appendChild(opt);
  }
}

eventSelect.addEventListener('change', async () => {
  const eventId = eventSelect.value;
  boothInput.value = '';
  boothIdInput.value = '';
  boothInput.setCustomValidity('');
  boothSuggestions.innerHTML = '';

  if (!eventId) {
    boothInput.disabled = true;
    return;
  }

  boothInput.disabled = false;
  eventBooths = await loadBooths(eventId);
  renderBoothSuggestions(eventBooths);
});

groupSelect.addEventListener('change', () => renderCircleMembers(groupSelect.value));
boothInput.addEventListener('input', syncBoothSelection);
boothInput.addEventListener('change', syncBoothSelection);

// ---------- シフト提出 ----------
function initShiftSubmit(userId) {
  shiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    syncBoothSelection();
    if (boothInput.value.trim() && !boothIdInput.value) {
      showMessage('候補からブースを選んでください', 'error');
      return;
    }

    const payload = {
      user_id: userId,
      group_id: groupSelect.value,
      event_id: eventSelect.value || null,
      booth_id: boothIdInput.value || null,
      shift_date: document.getElementById('shift-date').value,
      start_time: document.getElementById('shift-start').value,
      end_time: document.getElementById('shift-end').value,
      note: document.getElementById('shift-note').value.trim() || null,
    };

    const { error } = await supabase.from('shifts').insert(payload);
    if (error) { showMessage(translateError(error), 'error'); return; }

    showMessage('シフトを提出しました', 'success');
    shiftForm.reset();
    boothInput.disabled = true;
    boothSuggestions.innerHTML = '';
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
  });
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  const myGroups = await loadMyGroups(user.id);
  fillSelect(groupSelect, myGroups, 'グループを選択してください');

  const events = await loadEvents();
  fillSelect(eventSelect, events, '選択しない');
  boothInput.disabled = true;

  initShiftSubmit(user.id);
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});