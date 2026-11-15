import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_USER_ID } from './config.js?v=appwrite-1';

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

const address = { databaseId: 'prospeccao', tableId: 'contatos' };
const pageSize = 100;
const asContact = row => ({
  phone: row.$id,
  name: row.name,
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

async function createContact(record) {
  try {
    await tables.createRow({
      ...address,
      rowId: record.phone,
      data: { name: record.name, sentAt: record.sentAt ? new Date(record.sentAt).toISOString() : null }
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

export async function changeStatus(phone, sentAt) {
  const row = await tables.updateRow({
    ...address,
    rowId: phone,
    data: { sentAt: sentAt ? new Date(sentAt).toISOString() : null }
  });
  return asContact(row);
}
