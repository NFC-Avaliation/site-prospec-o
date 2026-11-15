import { brazilianPhone } from './import.js';

export function readLocalContacts() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('zafer-prospeccao', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Feche as outras abas do painel e tente de novo.'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('state', 'readonly');
      const contacts = transaction.objectStore('state').get('contacts');
      transaction.oncomplete = () => {
        db.close();
        resolve(contacts.result ?? []);
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}

export function parseBackup(backup) {
  if (backup?.format !== 'prospeccao-marcelo' || backup.version !== 1 || !Array.isArray(backup.contacts)) {
    throw new Error('Selecione o backup JSON exportado pelo painel de prospecção.');
  }
  const contacts = new Map();
  for (const record of backup.contacts) {
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    const phone = brazilianPhone(record?.phone);
    const sentAt = record?.sentAt ?? null;
    if (!name || !phone || (sentAt !== null && (!Number.isFinite(sentAt) || sentAt <= 0 || !Number.isFinite(new Date(sentAt).getTime())))) {
      throw new Error('O backup contém um contato ou uma data inválida.');
    }
    const existing = contacts.get(phone);
    if (!existing || (sentAt ?? 0) > (existing.sentAt ?? 0)) contacts.set(phone, { name, phone, sentAt });
  }
  return [...contacts.values()];
}
