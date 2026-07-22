import { supabase } from './supabaseClient.js';

const listEl = document.getElementById('group-list');
const emptyEl = document.getElementById('group-empty');
const messageEl = document.getElementById('group-message');
const createForm = document.getElementById('create-group-form');
const joinForm = document.getElementById('join-group-form');

const codeModal = document.getElementById('code-modal');
const codeModalTitle = document.getElementById('code-modal-title');
const codeDisplay = document.getElementById('code-display');
const codeCopyBtn = document.getElementById('code-copy-btn');
const codeCloseBtn = document.getElementById('code-close-btn');

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function hideMessage() {
  messageEl.className = 'message';
  messageEl.textContent = '';
}

function openCodeModal(title, code) {
  codeModalTitle.textContent = title;
  codeDisplay.textContent = code;
  codeModal.hidden = false;
}
codeCloseBtn.addEventListener('click', () => { codeModal.hidden = true; });
codeCopyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(codeDisplay.textContent);
  codeCopyBtn.textContent = 'コピーしました';
  setTimeout(() => { codeCopyBtn.textContent = 'コピーする'; }, 1500);
});

function translateGroupError(error) {
  const msg = error?.message || '';
  if (msg.includes('invalid code')) return '招待コードが正しくありません';
  if (msg.includes('not authorized')) return 'この操作を行う権限がありません';
  return `エラーが発生しました: ${msg}`;
}

async function loadGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('role, groups(id, name)')
    .eq('user_id', userId);

  if (error) {
    showMessage(translateGroupError(error), 'error');
    return;
  }

  listEl.innerHTML = '';

  if (!data || data.length === 0) {
    listEl.appendChild(emptyEl);
    return;
  }

  for (const row of data) {
    const group = row.groups;
    const li = document.createElement('li');
    li.className = 'group-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = group.name;
    if (row.role === 'owner') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '作成者';
      nameSpan.appendChild(badge);
    }

    const actionBtn = document.createElement('button');
    actionBtn.className = 'button-secondary';

    if (row.role === 'owner') {
      actionBtn.textContent = '招待コードを再発行';
      actionBtn.addEventListener('click', () => regenerateCode(group.id));
    } else {
      actionBtn.textContent = 'グループを抜ける';
      actionBtn.addEventListener('click', () => leaveGroup(group.id, userId));
    }

    li.append(nameSpan, actionBtn);
    listEl.appendChild(li);
  }
}

async function regenerateCode(groupId) {
  hideMessage();
  const { data, error } = await supabase.rpc('regenerate_invite_code', { p_group_id: groupId });
  if (error) {
    showMessage(translateGroupError(error), 'error');
    return;
  }
  openCodeModal('新しい招待コード', data);
}

async function leaveGroup(groupId, userId) {
  hideMessage();
  if (!confirm('このグループを抜けますか?')) return;

  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) {
    showMessage(translateGroupError(error), 'error');
    return;
  }
  await loadGroups(userId);
}

export function initGroupFeatures(userId) {
  loadGroups(userId);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();
    const nameInput = document.getElementById('new-group-name');
    const name = nameInput.value.trim();
    if (!name) return;

    const { data, error } = await supabase
      .rpc('create_group', { p_name: name })
      .single();

    if (error) {
      showMessage(translateGroupError(error), 'error');
      return;
    }

    nameInput.value = '';
    await loadGroups(userId);
    openCodeModal(`「${name}」の招待コード`, data.invite_code);
  });

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();
    const codeInput = document.getElementById('invite-code-input');
    const code = codeInput.value.trim();
    if (!code) return;

    const { data, error } = await supabase
      .rpc('join_group_by_code', { p_code: code })
      .single();

    if (error) {
      showMessage(translateGroupError(error), 'error');
      return;
    }

    codeInput.value = '';
    showMessage(`「${data.group_name}」に参加しました`, 'success');
    await loadGroups(userId);
  });
}
