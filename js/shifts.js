import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('shift-message');

const shiftForm = document.getElementById('shift-form');
const groupCheckboxesEl = document.getElementById('shift-group-checkboxes');
const circleMembersEl = document.getElementById('circle-members');
const eventSelect = document.getElementById('shift-event-select');
const boothInput = document.getElementById('shift-booth-input');
const boothIdInput = document.getElementById('shift-booth-id');
const boothSuggestions = document.getElementById('shift-booth-suggestions');
const myShiftListEl = document.getElementById('my-shift-list');

let eventBooths = [];
let groups = [];
let selectedGroupIds = new Set();
let currentUserId = null;

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
    opt.textContent = item.label ?? item.name;
    select.appendChild(opt);
  }
}

// ---------- グループ ----------
async function loadMyGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name, event_id)')
    .eq('user_id', userId);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).map((row) => row.groups).filter(Boolean);
}

function renderGroupCheckboxes(targetEventId) {
  groupCheckboxesEl.innerHTML = '';
  selectedGroupIds = new Set();

  const groupsForEvent = groups.filter((g) => g.event_id === targetEventId);
  if (!targetEventId) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';
    return;
  }
  if (groupsForEvent.length === 0) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">このイベントのグループがありません</p>';
    return;
  }
  for (const group of groupsForEvent) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = group.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedGroupIds.add(group.id);
      else selectedGroupIds.delete(group.id);
      renderCircleMembers([...selectedGroupIds]);
    });
    label.append(checkbox, document.createTextNode(group.name));
    groupCheckboxesEl.appendChild(label);
  }
}

async function renderCircleMembers(groupIds) {
  circleMembersEl.innerHTML = '';
  if (!groupIds.length) {
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
    return;
  }
  const { data, error } = await supabase
    .from('group_members')
    .select('profiles(display_name)')
    .in('group_id', groupIds);
  if (error) {
    showMessage(translateError(error), 'error');
    circleMembersEl.innerHTML = '<li class="empty">メンバーが見つかりませんでした</li>';
    return;
  }
  const names = [...new Set((data || []).map((row) => row.profiles?.display_name).filter(Boolean))];
  if (names.length === 0) {
    circleMembersEl.innerHTML = '<li class="empty">メンバーが見つかりませんでした</li>';
    return;
  }
  for (const name of names) {
    const li = document.createElement('li');
    li.textContent = name;
    circleMembersEl.appendChild(li);
  }
}

// ---------- イベント・ブース ----------
async function loadMyEvents(myGroups) {
  const eventIds = [...new Set(myGroups.map((g) => g.event_id).filter(Boolean))];
  if (eventIds.length === 0) return [];
  const result = await loadEventsWithRange(supabase, eventIds);
  if (result.error) { showMessage(translateError(result.error), 'error'); return []; }
  return result.events.map((ev) => ({ ...ev, label: buildEventLabel(ev) }));
}

async function loadBooths(eventId) {
  const { data, error } = await supabase
    .from('booths').select('id, name').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function syncBoothSelection() {
  const value = boothInput.value.trim();
  if (!value) { boothIdInput.value = ''; boothInput.setCustomValidity(''); return; }
  const matched = eventBooths.find((b) => b.name.toLowerCase() === value.toLowerCase());
  if (matched) {
    boothIdInput.value = matched.id;
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
  renderGroupCheckboxes(eventId);
  await renderCircleMembers([]);
  boothInput.value = '';
  boothIdInput.value = '';
  boothInput.setCustomValidity('');
  boothSuggestions.innerHTML = '';
  boothInput.disabled = !eventId;
  if (!eventId) return;
  eventBooths = await loadBooths(eventId);
  renderBoothSuggestions(eventBooths);
});

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
    if (selectedGroupIds.size === 0) {
      showMessage('提出するグループを1つ以上選択してください', 'error');
      return;
    }
    if (!eventSelect.value) {
      showMessage('イベントを選択してください', 'error');
      return;
    }

    const commonPayload = {
      user_id: userId,
      event_id: eventSelect.value,
      booth_id: boothIdInput.value || null,
      shift_date: document.getElementById('shift-date').value,
      start_time: document.getElementById('shift-start').value,
      end_time: document.getElementById('shift-end').value,
      note: document.getElementById('shift-note').value.trim() || null,
    };

    const payloads = [...selectedGroupIds].map((groupId) => ({ ...commonPayload, group_id: groupId }));
    const { error } = await supabase.from('shifts').insert(payloads);
    if (error) { showMessage(translateError(error), 'error'); return; }

    showMessage('シフトを提出しました', 'success');
    shiftForm.reset();
    selectedGroupIds = new Set();
    groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';
    boothInput.disabled = true;
    boothSuggestions.innerHTML = '';
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';

    const refreshed = await loadMyShifts(userId);
    renderMyShifts(refreshed);
  });
}

// ---------- マイシフト一覧 ----------
async function loadMyShifts(userId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, group_id, booth_id, shift_date, start_time, end_time, note, groups(name), booths(name)')
    .eq('user_id', userId)
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function renderMyShifts(myShifts) {
  myShiftListEl.innerHTML = '';
  if (myShifts.length === 0) {
    myShiftListEl.innerHTML = '<li class="group-empty">まだシフトがありません</li>';
    return;
  }
  for (const s of myShifts) {
    const li = document.createElement('li');
    li.className = 'group-item';

    const locationLabel = s.booths?.name ?? '場所未設定';
    const info = document.createElement('span');
    info.className = 'name';
    info.style.fontSize = '13.5px';
    info.innerHTML = `${s.shift_date} ${s.start_time?.slice(0, 5)}〜${s.end_time?.slice(0, 5)}<br>
      <span style="color:var(--color-ink-soft); font-size:12px;">${locationLabel} / ${s.groups?.name ?? ''}</span>`;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button-secondary';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => startEditShift(li, s));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-secondary';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteShift(s.id));

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(editBtn, deleteBtn);

    li.append(info, actions);
    myShiftListEl.appendChild(li);
  }
}

function startEditShift(li, shift) {
  li.innerHTML = '';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = shift.shift_date;

  const startInput = document.createElement('input');
  startInput.type = 'time';
  startInput.value = shift.start_time?.slice(0, 5) ?? '';

  const endInput = document.createElement('input');
  endInput.type = 'time';
  endInput.value = shift.end_time?.slice(0, 5) ?? '';

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.value = shift.note ?? '';
  noteInput.placeholder = 'メモ(任意)';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'button-secondary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const { error } = await supabase
      .from('shifts')
      .update({
        shift_date: dateInput.value,
        start_time: startInput.value,
        end_time: endInput.value,
        note: noteInput.value.trim() || null,
      })
      .eq('id', shift.id);
    if (error) { showMessage(translateError(error), 'error'); return; }
    showMessage('シフトを更新しました', 'success');
    const refreshed = await loadMyShifts(currentUserId);
    renderMyShifts(refreshed);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'link-button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', async () => {
    const refreshed = await loadMyShifts(currentUserId);
    renderMyShifts(refreshed);
  });

  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.append(dateInput, startInput, endInput, noteInput, saveBtn, cancelBtn);
  li.appendChild(row);
}

async function deleteShift(shiftId) {
  if (!confirm('このシフトを削除しますか?')) return;
  const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
  if (error) { showMessage(translateError(error), 'error'); return; }
  showMessage('シフトを削除しました', 'success');
  const refreshed = await loadMyShifts(currentUserId);
  renderMyShifts(refreshed);
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  currentUserId = user.id;
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  groups = await loadMyGroups(user.id);
  const events = await loadMyEvents(groups);
  fillSelect(eventSelect, events, 'イベントを選択してください');
  boothInput.disabled = true;
  groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';

  initShiftSubmit(user.id);

  const myShifts = await loadMyShifts(user.id);
  renderMyShifts(myShifts);
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});