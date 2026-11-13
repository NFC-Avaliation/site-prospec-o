const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
export { normalize };

export function parseCsv(text, separator) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === separator) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      rows.push([...row, cell]);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Há aspas abertas no CSV. Confira a planilha e tente novamente.');
  if (row.length || cell) rows.push([...row, cell]);
  return rows;
}

function headerColumns(row) {
  const headers = row.map(value => normalize(value).replace(/[^a-z0-9]/g, ''));
  return {
    name: headers.findIndex(value => ['nome','empresa','nomedaempresa','nomeempresa','estabelecimento','nomedoestabelecimento','nomefantasia','razaosocial','cliente'].includes(value)),
    phone: ['whatsapp','numerowhatsapp','numerodowhatsapp','telefonewhatsapp','telefone','celular','contato','fone','telefonecomddd'].map(value => headers.indexOf(value)).find(index => index >= 0) ?? -1
  };
}

export function brazilianPhone(value) {
  const raw = String(value ?? '').trim().replace(/\.0+$/, '');
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0055')) digits = digits.slice(2);
  if (!raw.startsWith('+') && (digits.length === 10 || digits.length === 11)) digits = '55' + digits;
  return /^55[1-9]\d[2-9]\d{7,8}$/.test(digits) ? digits : null;
}

export function contactsFromRows(rows, existing) {
  const header = rows.findIndex(row => {
    const cols = headerColumns(row);
    return cols.name >= 0 && cols.phone >= 0;
  });
  if (header === -1) throw new Error('As colunas Nome e WhatsApp precisam aparecer na mesma linha da planilha.');
  const columns = headerColumns(rows[header]);
  const phones = new Set(existing.map(contact => contact.phone));
  const added = [];
  let duplicates = 0, invalid = 0;
  for (const row of rows.slice(header + 1)) {
    if (!row.some(value => String(value ?? '').trim())) continue;
    const name = String(row[columns.name] ?? '').trim();
    const phone = brazilianPhone(row[columns.phone]);
    if (!name || !phone) { invalid++; continue; }
    if (phones.has(phone)) { duplicates++; continue; }
    phones.add(phone);
    added.push({name, phone, sentAt: null});
  }
  return {added, duplicates, invalid};
}

const elements = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
const richText = node => elements(node, 't').filter(t => t.parentElement.localName !== 'rPh').map(t => t.textContent).join('');

async function parseXlsx(file) {
  const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  async function readXml(path, optional = false) {
    const part = zip.file(path);
    if (!part && optional) return null;
    if (!part) throw new Error('Não foi possível localizar a primeira aba da planilha.');
    const doc = new DOMParser().parseFromString(await part.async('string'), 'application/xml');
    if (elements(doc, 'parsererror').length) throw new Error('A planilha contém uma aba inválida.');
    return doc;
  }
  const workbook = await readXml('xl/workbook.xml');
  const sheet = elements(workbook, 'sheet')[0];
  const id = sheet?.getAttribute('r:id') ?? Array.from(sheet?.attributes ?? []).find(attr => attr.localName === 'id')?.value;
  const relations = await readXml('xl/_rels/workbook.xml.rels');
  const links = elements(relations, 'Relationship');
  const target = links.find(link => link.getAttribute('Id') === id)?.getAttribute('Target');
  if (!target) throw new Error('A planilha precisa ter pelo menos uma aba.');
  const partPath = target => new URL(target, 'https://planilha.invalid/xl/workbook.xml').pathname.slice(1);
  const sharedTarget = links.find(link => link.getAttribute('Type')?.endsWith('/sharedStrings'))?.getAttribute('Target');
  const [sharedXml, worksheet] = await Promise.all([readXml(sharedTarget ? partPath(sharedTarget) : 'xl/sharedStrings.xml', true), readXml(partPath(target))]);
  const shared = sharedXml ? elements(sharedXml, 'si').map(richText) : [];
  return elements(worksheet, 'row').map(row => {
    const values = [];
    let position = 0;
    for (const cell of elements(row, 'c')) {
      const reference = cell.getAttribute('r')?.match(/^[A-Z]+/i)?.[0];
      if (reference) position = Array.from(reference.toUpperCase()).reduce((column, char) => column * 26 + char.charCodeAt(0) - 64, 0) - 1;
      const type = cell.getAttribute('t');
      const value = elements(cell, 'v')[0]?.textContent ?? '';
      values[position++] = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? richText(cell) : value;
    }
    return values;
  });
}

export async function readSheet(file) {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(file);
  if (!/\.csv$/i.test(file.name)) throw new Error('Escolha um arquivo XLSX ou CSV.');
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder().decode(bytes);
  const text = utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  for (const separator of [';', ',', '\t']) {
    try {
      const rows = parseCsv(text, separator);
      if (rows.some(row => {
        const columns = headerColumns(row);
        return columns.name >= 0 && columns.phone >= 0;
      })) return rows;
    } catch {
      // A different separator may correctly parse quoted values.
    }
  }
  throw new Error('Use as colunas Nome e WhatsApp ou baixe o modelo disponível no painel.');
}
