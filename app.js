import { contactsFromRows, normalize, readSheet } from './import.js';

const $ = id => document.getElementById(id);
const icons = {
  edit:'<path d="m16 4 4 4M4 20l4-.9L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  download:'<path d="M12 4v12m-5-5 5 5 5-5M4 17v3h16v-3"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-15a3 3 0 0 1 0 6m3 9v-2a4 4 0 0 0-2-3.5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  clip:'<path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m4 6-7 7a1.5 1.5 0 0 1-2-2l6-6"/>',
  external:'<path d="M13 4h7v7m0-7-9 9m8 0v6H5V5h6"/>',
  chat:'<path d="M20 11a8 8 0 0 1-8 8 8 8 0 0 1-3.5-.8L4 19l.8-4.4A8 8 0 1 1 20 11z"/><path d="M8.5 11h7"/>',
  inbox:'<path d="m4 13 2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>'
};

function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  return span;
}
document.querySelectorAll('[data-icon]').forEach(el => el.append(icon(el.dataset.icon).firstChild));

let contacts = [];
let settings = {text: '', files: []};
let draftFiles = [];
let toastTimer;
let activeSend = null;
let downloadUrls = [];

const timeZone = 'America/Sao_Paulo';
const hourFormat = new Intl.DateTimeFormat('pt-BR', {timeZone, hour:'numeric', hourCycle:'h23'});
const dateFormat = new Intl.DateTimeFormat('pt-BR', {timeZone, dateStyle:'short', timeStyle:'short'});

function greeting() {
  const hour = Number(hourFormat.formatToParts(new Date()).find(part => part.type === 'hour').value);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

const db = new Promise((resolve, reject) => {
  const request = indexedDB.open('zafer-prospeccao', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('state');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Banco ocupado'));
});
async function read(key) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const request = database.transaction('state').objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function write(key, value) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put(value, key);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

function feedback(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}

function toast(message, persistent = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  if (!persistent) toastTimer = setTimeout(() => $('toast').hidden = true, 4200);
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(label, css, action, symbol) {
  const el = element('button', css);
  el.type = 'button';
  if (symbol) el.append(icon(symbol));
  el.append(label);
  el.addEventListener('click', action);
  return el;
}

function formattedPhone(phone) {
  const number = phone.slice(4);
  return '+55 (' + phone.slice(2, 4) + ') ' + number.slice(0, -4) + '-' + number.slice(-4);
}

function contactCard(contact) {
  const card = element('article', 'card');
  const head = element('div', 'card-heading');
  const initials = contact.name.split(/\s+/).slice(0,2).map(word => [...word][0]).join('').toLocaleUpperCase('pt-BR');
  const detail = element('div');
  detail.append(element('h3', '', contact.name), element('span', 'phone', formattedPhone(contact.phone)));
  if (contact.sentAt) detail.append(element('span', 'date', 'Enviada em ' + dateFormat.format(new Date(contact.sentAt))));
  head.append(element('span', 'avatar', initials), detail);
  head.firstChild.setAttribute('aria-hidden', 'true');
  const actions = element('div', 'card-actions');
  actions.append(
    button('Boas-vindas', 'button wa', () => openChat(contact, 'greeting'), 'chat'),
    button('Mensagem personalizada', 'button secondary', () => openChat(contact, 'custom'), 'chat')
  );
  card.append(head, actions);
  if (contact.sentAt) card.append(button('Voltar para A enviar', 'text-action', async () => {
    try {
      await updateStatus(contact.phone, null);
      toast('Contato movido para A enviar.');
    } catch { toast('Não foi possível alterar o status. Tente novamente.'); }
  }));
  return card;
}

function render() {
  const query = normalize($('search').value);
  const digits = query.replace(/\D/g, '');
  const matches = contact => !query || normalize(contact.name).includes(query) || (digits && /^[\d\s+().-]+$/.test(query) && contact.phone.includes(digits));
  $('total').textContent = contacts.length;
  for (const [id, sent, title, help] of [
    ['pending', false, 'Nenhum contato a enviar', 'Importe uma planilha para adicionar seus contatos.'],
    ['sent', true, 'Nenhuma mensagem confirmada', 'Os contatos aparecem aqui quando você confirma o envio.']
  ]) {
    const list = contacts.filter(contact => Boolean(contact.sentAt) === sent);
    if (sent) list.sort((a, b) => b.sentAt - a.sentAt);
    $(id + '-count').textContent = list.length;
    $(id + '-pill').textContent = list.length;
    const visible = list.filter(matches);
    if (visible.length) $(id).replaceChildren(...visible.map(contactCard));
    else {
      const empty = element('div', 'empty');
      empty.append(icon(sent ? 'check' : 'inbox'), element('strong', '', query ? 'Nenhum resultado' : title), element('p', '', query ? 'Tente buscar outro nome ou telefone.' : help));
      $(id).replaceChildren(empty);
    }
  }
}

async function changeContacts(transform) {
  const database = await db;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite');
    const state = transaction.objectStore('state');
    const request = state.get('contacts');
    let next, failure;
    request.onsuccess = () => {
      try {
        next = transform(request.result ?? []);
        state.put(next, 'contacts');
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      contacts = next;
      resolve();
    };
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
  render();
}
function updateStatus(phone, sentAt) {
  return changeContacts(list => list.map(contact => contact.phone === phone ? {...contact, sentAt} : contact));
}

function openEditor() {
  $('message').value = settings.text;
  draftFiles = [...settings.files];
  $('media-input').value = '';
  feedback('message-feedback', '');
  renderDraft();
  $('message-dialog').showModal();
}

function renderDraft() {
  $('draft-media').replaceChildren(...draftFiles.map((file, index) => {
    const li = element('li');
    li.append(element('span', '', file.name), button('Remover', 'text-action', () => {
      draftFiles.splice(index, 1);
      renderDraft();
    }));
    return li;
  }));
}

function openChat(contact, type) {
  const custom = type === 'custom';
  if (custom && !settings.text && !settings.files.length) {
    openEditor();
    feedback('message-feedback', 'Salve sua mensagem para abrir a conversa com este contato.');
    return;
  }
  const salutation = greeting();
  const text = custom
    ? settings.text.replace(/\{nome\}|\{saudacao\}/g, field => field === '{nome}' ? contact.name : salutation)
    : salutation + ', tudo bem?';
  const url = new URL('https://web.whatsapp.com/send');
  url.searchParams.set('phone', contact.phone);
  if (text) url.searchParams.set('text', text);
  window.open(url.href, '_blank', 'noopener,noreferrer');
  $('reopen').href = url.href;
  activeSend = contact;
  $('send-description').textContent = 'Depois de enviar a mensagem para ' + contact.name + ' no WhatsApp Web, confirme o envio aqui.';
  const files = custom ? settings.files : [];
  $('send-media-area').hidden = !files.length;
  $('send-media').replaceChildren(...files.map(file => {
    const li = element('li');
    const link = element('a', 'text-action', 'Baixar');
    const objectUrl = URL.createObjectURL(file.blob);
    downloadUrls.push(objectUrl);
    link.href = objectUrl;
    link.download = file.name;
    link.setAttribute('aria-label', 'Baixar ' + file.name);
    li.append(element('span', '', file.name), link);
    return li;
  }));
  feedback('send-feedback', '');
  $('send-dialog').showModal();
}

$('send-dialog').addEventListener('close', () => {
  downloadUrls.forEach(url => URL.revokeObjectURL(url));
  downloadUrls = [];
});
document.querySelectorAll('.close').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
$('import').onclick = () => {
  $('sheet').value = '';
  feedback('import-feedback', '');
  $('import-dialog').showModal();
};
$('edit-message').onclick = openEditor;
$('search').addEventListener('input', render);

$('sheet').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.disabled = true;
  feedback('import-feedback', 'Lendo planilha…');
  try {
    const rows = await readSheet(file);
    let result;
    await changeContacts(list => {
      result = contactsFromRows(rows, list);
      return [...list, ...result.added];
    });
    feedback('import-feedback', [
      result.added.length + ' contato(s) importado(s).',
      result.duplicates ? result.duplicates + ' duplicado(s) ignorado(s).' : '',
      result.invalid ? result.invalid + ' linha(s) ignorada(s) por falta de nome ou telefone válido com DDD.' : ''
    ].filter(Boolean).join('\n'));
  } catch (error) {
    feedback('import-feedback', error instanceof Error ? error.message : 'Não foi possível importar a planilha.', true);
  } finally {
    event.target.disabled = false;
    event.target.value = '';
  }
});

$('media-input').addEventListener('change', event => {
  const picked = Array.from(event.target.files);
  const supported = picked.filter(file => /^(image|video)\//.test(file.type));
  draftFiles.push(...supported.map(file => ({name: file.name, blob: file})));
  event.target.value = '';
  renderDraft();
  feedback('message-feedback', supported.length < picked.length ? 'Selecione arquivos de imagem ou vídeo.' : '', supported.length < picked.length);
});
$('message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const next = {text: $('message').value.trim(), files: [...draftFiles]};
  $('save-message').disabled = true;
  try {
    await write('settings', next);
    settings = next;
    $('message-dialog').close();
    toast('Mensagem personalizada salva.');
  } catch {
    feedback('message-feedback', 'Não foi possível salvar. Confira o espaço disponível no navegador e tente novamente.', true);
  } finally { $('save-message').disabled = false; }
});
$('confirm-send').onclick = async () => {
  const contact = activeSend;
  if (!contact) return;
  $('confirm-send').disabled = true;
  try {
    await updateStatus(contact.phone, Date.now());
    $('send-dialog').close();
    toast('Envio registrado para ' + contact.name + '.');
  } catch {
    feedback('send-feedback', 'Não foi possível registrar o envio. Tente novamente.', true);
  } finally { $('confirm-send').disabled = false; }
};

$('import').disabled = $('edit-message').disabled = true;
try {
  const [savedContacts, savedSettings] = await Promise.all([read('contacts'), read('settings')]);
  contacts = savedContacts ?? contacts;
  settings = savedSettings ?? settings;
  $('import').disabled = $('edit-message').disabled = false;
} catch {
  toast('O navegador bloqueou o armazenamento. Abra a página em uma janela normal e tente novamente.', true);
}
render();
