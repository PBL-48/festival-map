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
const programInput = document.getElementById('shift-program-input');
const programIdInput = document.getElementById('shift-program-id');
const boothIdInput = document.getElementById('shift-booth-id');
const programSuggestions = document.getElementById('shift-program-suggestions');

let eventPrograms = []; // {id, label, boothId}
let groups = [];
let selectedGroupIds = new Set();

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

  const groupsForEvent = groups.filter((group) => group.event_id === targetEventId);
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
      if (checkbox.checked) {
        selectedGroupIds.add(group.id);
      } else {
        selectedGroupIds.delete(group.id);
      }
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

// ---------- イベント・企画 ----------
// 変更後: 自分が所属するグループのイベントだけに絞り込む
async function loadMyEvents(myGroups) {
  // groupsのevent_idをユニークに集める
  const eventIds = [...new Set(myGroups.map((g) => g.event_id).filter(Boolean))];
  if (eventIds.length === 0) return [];

  const result = await loadEventsWithRange(supabase, eventIds);
  if (result.error) { showMessage(translateError(result.error), 'error'); return []; }
  return result.events.map((event) => ({ ...event, label: buildEventLabel(event) }));
}

// 企画をブース名付きで取得(1ブースに複数企画がある前提)
async function loadProgramsForEvent(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, name, booth_id, booths!inner(name, event_id)')
    .eq('booths.event_id', eventId)
    .order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).map((p) => ({
    id: p.id,
    boothId: p.booth_id,
    label: `${p.name}(${p.booths?.name ?? '場所不明'})`,
  }));
}

function syncProgramSelection() {
  const value = programInput.value.trim();
  if (!value) {
    programIdInput.value = '';
    boothIdInput.value = '';
    programInput.setCustomValidity('');
    return;
  }

  const matched = eventPrograms.find((p) => p.label.toLowerCase() === value.toLowerCase());
  if (matched) {
    programIdInput.value = matched.id;
    boothIdInput.value = matched.boothId;
    programInput.setCustomValidity('');
  } else {
    programIdInput.value = '';
    boothIdInput.value = '';
    programInput.setCustomValidity('候補から企画を選んでください');
  }
}

function renderProgramSuggestions(programs) {
  programSuggestions.innerHTML = '';
  for (const program of programs) {
    const opt = document.createElement('option');
    opt.value = program.label;
    programSuggestions.appendChild(opt);
  }
}

eventSelect.addEventListener('change', async () => {
  const eventId = eventSelect.value;
  renderGroupCheckboxes(eventId);
  await renderCircleMembers([]);
  programInput.value = '';
  programIdInput.value = '';
  boothIdInput.value = '';
  programInput.setCustomValidity('');
  programSuggestions.innerHTML = '';

  if (!eventId) {
    programInput.disabled = true;
    return;
  }

  programInput.disabled = false;
  eventPrograms = await loadProgramsForEvent(eventId);
  renderProgramSuggestions(eventPrograms);
});

programInput.addEventListener('input', syncProgramSelection);
programInput.addEventListener('change', syncProgramSelection);

// ---------- シフト提出 ----------
function initShiftSubmit(userId) {
  shiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    syncProgramSelection();
    if (programInput.value.trim() && !programIdInput.value) {
      showMessage('候補から企画を選んでください', 'error');
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
      program_id: programIdInput.value || null,
      booth_id: boothIdInput.value || null,
      shift_date: document.getElementById('shift-date').value,
      start_time: document.getElementById('shift-start').value,
      end_time: document.getElementById('shift-end').value,
      note: document.getElementById('shift-note').value.trim() || null,
    };

    const payloads = [...selectedGroupIds].map((groupId) => ({
      ...commonPayload,
      group_id: groupId,
    }));

    const { error } = await supabase.from('shifts').insert(payloads);
    if (error) { showMessage(translateError(error), 'error'); return; }

    showMessage('シフトを提出しました', 'success');
    const refreshed = await loadMyShifts(user.id);
    renderMyShifts(refreshed);
    shiftForm.reset();
    selectedGroupIds = new Set();
    groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';
    programInput.disabled = true;
    programSuggestions.innerHTML = '';
    programIdInput.value = '';
    boothIdInput.value = '';
    programInput.setCustomValidity('');
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
  });
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  groups = await loadMyGroups(user.id);

  // 変更: loadEvents() → loadMyEvents(groups)
  const events = await loadMyEvents(groups);
  fillSelect(eventSelect, events, 'イベントを選択してください');
  programInput.disabled = true;
  groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';

  initShiftSubmit(user.id);
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});

// ---------- マイシフト一覧+編集 ----------
const myShiftListEl = document.getElementById('my-shift-list');

async function loadMyShifts(userId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, group_id, booth_id, program_id, shift_date, start_time, end_time, note, groups(name), booths(name), programs(name)')
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
    li.dataset.shiftId = s.id;

    const locationLabel = s.programs?.name
      ? `${s.programs.name}(${s.booths?.name ?? ''})`
      : (s.booths?.name ?? '場所未設定');

    const info = document.createElement('span');
    info.className = 'name';
    info.style.fontSize = '13.5px';
    info.innerHTML = `${s.shift_date} ${s.start_time?.slice(0,5)}〜${s.end_time?.slice(0,5)}<br>
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
    deleteBtn.addEventListener('click', () => deleteShift(s.id, userId));

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
    const myShifts = await loadMyShifts(user.id);
    renderMyShifts(myShifts);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'link-button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', async () => {
    const myShifts = await loadMyShifts(user.id);
    renderMyShifts(myShifts);
  });

  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.append(dateInput, startInput, endInput, noteInput, saveBtn, cancelBtn);
  li.appendChild(row);
}

async function deleteShift(shiftId, userId) {
  if (!confirm('このシフトを削除しますか?')) return;
  const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
  if (error) { showMessage(translateError(error), 'error'); return; }
  showMessage('シフトを削除しました', 'success');
  const myShifts = await loadMyShifts(userId);
  renderMyShifts(myShifts);
}

// 初期ロード(initShiftSubmitの呼び出しのあとに追加)
const myShifts = await loadMyShifts(user.id);
renderMyShifts(myShifts);
