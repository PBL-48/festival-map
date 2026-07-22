import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('shift-message');

const shiftForm = document.getElementById('shift-form');
const groupSelect = document.getElementById('shift-group-select');
const circleMembersEl = document.getElementById('circle-members');
const eventSelect = document.getElementById('shift-event-select');
const boothSelect = document.getElementById('shift-booth-select');

const toggleNewEvent = document.getElementById('toggle-new-event');
const newEventBox = document.getElementById('new-event-box');
const newEventName = document.getElementById('new-event-name');
const addEventBtn = document.getElementById('add-event-btn');

const toggleNewBooth = document.getElementById('toggle-new-booth');
const newBoothBox = document.getElementById('new-booth-box');
const newBoothName = document.getElementById('new-booth-name');
const addBoothBtn = document.getElementById('add-booth-btn');

const viewGroupSelect = document.getElementById('view-group-select');
const shiftListEl = document.getElementById('shift-list');

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
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

toggleNewEvent.addEventListener('click', () => { newEventBox.hidden = !newEventBox.hidden; });
toggleNewBooth.addEventListener('click', () => { newBoothBox.hidden = !newBoothBox.hidden; });

addEventBtn.addEventListener('click', async () => {
  const name = newEventName.value.trim();
  if (!name) return;

  const { data, error } = await supabase.from('events').insert({ name }).select('id, name').single();
  if (error) { showMessage(translateError(error), 'error'); return; }

  const opt = document.createElement('option');
  opt.value = data.id;
  opt.textContent = data.name;
  eventSelect.appendChild(opt);
  eventSelect.value = data.id;
  eventSelect.dispatchEvent(new Event('change'));

  newEventName.value = '';
  newEventBox.hidden = true;
});

addBoothBtn.addEventListener('click', async () => {
  const name = newBoothName.value.trim();
  const eventId = eventSelect.value;
  if (!name || !eventId) return;

  const { data, error } = await supabase
    .from('booths')
    .insert({ name, event_id: eventId })
    .select('id, name')
    .single();
  if (error) { showMessage(translateError(error), 'error'); return; }

  const opt = document.createElement('option');
  opt.value = data.id;
  opt.textContent = data.name;
  boothSelect.appendChild(opt);
  boothSelect.value = data.id;

  newBoothName.value = '';
  newBoothBox.hidden = true;
});

eventSelect.addEventListener('change', async () => {
  const eventId = eventSelect.value;
  boothSelect.innerHTML = '<option value="">選択しない</option>';

  if (!eventId) {
    boothSelect.disabled = true;
    toggleNewBooth.disabled = true;
    return;
  }

  boothSelect.disabled = false;
  toggleNewBooth.disabled = false;
  const booths = await loadBooths(eventId);
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.id;
    opt.textContent = booth.name;
    boothSelect.appendChild(opt);
  }
});

groupSelect.addEventListener('change', () => renderCircleMembers(groupSelect.value));

// ---------- シフト提出 ----------
function initShiftSubmit(userId) {
  shiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      user_id: userId,
      group_id: groupSelect.value,
      event_id: eventSelect.value || null,
      booth_id: boothSelect.value || null,
      shift_date: document.getElementById('shift-date').value,
      start_time: document.getElementById('shift-start').value,
      end_time: document.getElementById('shift-end').value,
      note: document.getElementById('shift-note').value.trim() || null,
    };

    const { error } = await supabase.from('shifts').insert(payload);
    if (error) { showMessage(translateError(error), 'error'); return; }

    showMessage('シフトを提出しました', 'success');
    shiftForm.reset();
    boothSelect.disabled = true;
    toggleNewBooth.disabled = true;
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
    await loadShiftList(userId);
  });
}

// ---------- シフト閲覧 ----------
function formatTime(t) { return t ? t.slice(0, 5) : ''; }

async function loadShiftList(userId) {
  shiftListEl.innerHTML = '<li class="group-empty">読み込み中...</li>';

  let query = supabase
    .from('shifts')
    .select('id, shift_date, start_time, end_time, note, profiles(display_name), groups(name), events(name), booths(name)')
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  const selectedGroup = viewGroupSelect.value;
  if (selectedGroup && selectedGroup !== 'all') {
    query = query.eq('group_id', selectedGroup);
  }

  const { data, error } = await query;
  if (error) { showMessage(translateError(error), 'error'); return; }

  shiftListEl.innerHTML = '';
  if (!data || data.length === 0) {
    shiftListEl.innerHTML = '<li class="group-empty">まだシフトがありません</li>';
    return;
  }

  for (const s of data) {
    const li = document.createElement('li');
    li.className = 'shift-item';

    const metaParts = [s.groups?.name];
    if (s.events?.name) metaParts.push(s.events.name);
    if (s.booths?.name) metaParts.push(s.booths.name);

    li.innerHTML = `
      <div class="top-row">
        <span class="time">${s.shift_date} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}</span>
        <span class="who-name">${s.profiles?.display_name ?? ''}</span>
      </div>
      <div class="meta">${metaParts.filter(Boolean).join(' / ')}</div>
      ${s.note ? `<div class="note">${s.note}</div>` : ''}
    `;
    shiftListEl.appendChild(li);
  }
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  const myGroups = await loadMyGroups(user.id);
  fillSelect(groupSelect, myGroups, 'グループを選択してください');

  viewGroupSelect.innerHTML = '<option value="all">すべてのグループ</option>';
  for (const g of myGroups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    viewGroupSelect.appendChild(opt);
  }

  const events = await loadEvents();
  fillSelect(eventSelect, events, '選択しない');

  initShiftSubmit(user.id);
  viewGroupSelect.addEventListener('change', () => loadShiftList(user.id));
  await loadShiftList(user.id);
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});