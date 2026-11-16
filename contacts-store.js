import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_USER_ID } from './config.js?v=mensagem-2';

let account, tables, Query;
export let configured = false;
export let setupMessage = 'Preencha o endpoint, o ID do projeto e o ID do usuário no config.js.';

if ([APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_USER_ID].every(Boolean)) {
  try {
    const endpoint = new URL(APPWRITE_ENDPOINT);
    const isCloudHost = endpoint.hostname === 'cloud.appwrite.io' || endpoint.hostname.endsWith('.cloud.appwrite.io');
    if (!isCloudHost || endpoint.protocol !== 'https:' || endpoint.pathname.replace(/\/$/, '') !== '/v1' ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Use o endpoint HTTPS do Appwrite Cloud que termina em /v1.');
    }
    const sdk = globalThis.Appwrite;
    const client = new sdk.Client().setEndpoint(endpoint.origin + '/v1').setProject(APPWRITE_PROJECT_ID);
    account = new sdk.Account(client);
    tables = new sdk.TablesDB(client);
    Query = sdk.Query;
    configured = true;
  } catch (error) {
    setupMessage = error.message;
  }
}

async function checkOwner(id) {
  if (id === APPWRITE_USER_ID) return id;
  await signOut();
  throw new Error('Esta conta não tem acesso ao painel de prospecção.');
}

export async function restoreAccount() {
  let user;
  try {
    user = await account.get();
  } catch (error) {
    if (error.code === 401) return null;
    throw error;
  }
  return checkOwner(user.$id);
}

export async function signIn(email, password) {
  const session = await account.createEmailPasswordSession({ email, password });
  return checkOwner(session.userId);
}

export async function signOut() {
  try {
    await account.deleteSession({ sessionId: 'current' });
  } catch (error) {
    if (error.code !== 401) throw error;
  }
}

const address = { databaseId: 'prospecca', tableId: '6afa2da80026e5b19f37' };
const template = { databaseId: address.databaseId, tableId: 'mensagens', rowId: 'personalizada' };
const pageSize = 100;
const isoDate = value => value ? new Date(value).toISOString() : null;
const asContact = row => ({
  phone: row.$id,
  name: row.name,
  welcomedAt: row.welcomedAt ? Date.parse(row.welcomedAt) : null,
  sentAt: row.sentAt ? Date.parse(row.sentAt) : null
});

export async function listContacts() {
  const contacts = [];
  let cursor;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.limit(pageSize)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const { rows } = await tables.listRows({ ...address, queries });
    contacts.push(...rows.map(asContact));
    if (rows.length < pageSize) return contacts;
    cursor = rows.at(-1).$id;
  }
}

export async function createContact(record) {
  try {
    await tables.createRow({
      ...address,
      rowId: record.phone,
      data: {
        name: record.name,
        sentAt: isoDate(record.sentAt),
        ...(record.welcomedAt ? { welcomedAt: isoDate(record.welcomedAt) } : {})
      }
    });
    return 1;
  } catch (error) {
    if (error.code === 409 && error.type === 'row_already_exists') return 0;
    throw error;
  }
}

export async function insertContacts(records) {
  if (!records.length) return 0;
  if (records.some(record => record.name.length > 1024)) {
    throw new Error('A planilha contém um nome de contato com mais de 1.024 caracteres.');
  }
  const existing = new Set((await listContacts()).map(contact => contact.phone));
  const missing = records.filter(record => !existing.has(record.phone));
  const parallel = 4;
  let inserted = 0;
  for (let offset = 0; offset < missing.length; offset += parallel) {
    const results = await Promise.allSettled(missing.slice(offset, offset + parallel).map(createContact));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      if (failure.reason.code === 429) {
        throw new Error('O Appwrite limitou os envios por enquanto. Aguarde um minuto e reimporte o mesmo arquivo.');
      }
      throw new Error('A importação foi interrompida. Confira a conexão e as permissões da tabela, depois reimporte o mesmo arquivo.', { cause: failure.reason });
    }
    inserted += results.reduce((total, result) => total + result.value, 0);
  }
  return inserted;
}

export async function changeStatus(phone, stage, time = Date.now()) {
  const stamp = isoDate(time);
  const data = stage === 'sent' ? { sentAt: stamp }
    : stage === 'welcome' ? { welcomedAt: stamp, sentAt: null }
    : { welcomedAt: null, sentAt: null };
  const row = await tables.updateRow({ ...address, rowId: phone, data });
  return asContact(row);
}

export async function readTemplate() {
  try {
    const row = await tables.getRow(template);
    return row.texto ?? '';
  } catch (error) {
    if (error.code === 404 && error.type === 'row_not_found') return null;
    throw error;
  }
}

export async function saveTemplate(texto) {
  const entry = { ...template, data: { texto } };
  try {
    await tables.updateRow(entry);
    return;
  } catch (error) {
    if (error.code !== 404 || error.type !== 'row_not_found') throw error;
  }

  try {
    await tables.createRow(entry);
  } catch (error) {
    if (error.code !== 409 || error.type !== 'row_already_exists') throw error;
    await tables.updateRow(entry);
  }
}

export function templateErrorMessage(error) {
  const code = Number(error?.code);
  const type = typeof error?.type === 'string' && /^[a-z_]+$/.test(error.type) ? error.type : '';
  const detail = Number.isInteger(code) && code >= 400 && code <= 599
    ? ' (' + code + (type ? ' / ' + type : '') + ')' : '';
  const table = 'Mensagens (ID: ' + template.tableId + ')';

  if (type === 'table_not_found' || type === 'database_not_found') {
    return 'O Appwrite não encontrou a tabela ' + table + ' no banco Prospecção. Confira o ID cinza ao lado do nome.' + detail + '.';
  }
  if (code === 401 || code === 403) {
    return 'No Appwrite, abra ' + table + ' → Security. Confira se Marcelo tem Create, Read e Update e entre novamente no painel.' + detail;
  }
  if (code === 400) {
    return 'Em ' + table + ' → Columns, confira se texto é do tipo Text, com status Available e Array desmarcado.' + detail;
  }
  if (code === 429) return 'O Appwrite limitou as tentativas. Aguarde um minuto e tente novamente.' + detail;
  return 'Não foi possível salvar no Appwrite. Tente novamente.' + detail;
}
