import crc from 'crc';
import QRCode from 'qrcode';

export function convertCRC16(str) {
  const value = crc.crc16ccitt(Buffer.from(str, 'utf8')).toString(16).toUpperCase();
  return value.padStart(4, '0').slice(-4);
}

function parseTlv(payload) {
  const fields = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) throw new Error('Format QRIS tidak valid: field TLV terpotong.');
    const id = payload.slice(i, i + 2);
    const lengthText = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) {
      throw new Error('Format QRIS tidak valid: header field rusak.');
    }
    const length = Number(lengthText);
    const start = i + 4;
    const end = start + length;
    if (end > payload.length) throw new Error(`Format QRIS tidak valid: field ${id} melebihi panjang payload.`);
    fields.push({ id, value: payload.slice(start, end) });
    i = end;
  }
  return fields;
}

function encodeTlv(id, value) {
  const text = String(value);
  if (text.length > 99) throw new Error(`Field QRIS ${id} terlalu panjang.`);
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

export function buildDynamicQris(staticQris, amount) {
  const cleaned = String(staticQris || '').trim();
  const numericAmount = Number(amount);
  if (!Number.isInteger(numericAmount) || numericAmount <= 0) throw new Error('Nominal harus berupa bilangan bulat positif.');
  if (!cleaned) throw new Error('QRIS_STRING belum diatur.');

  // Parse the COMPLETE QRIS. A normal QRIS ends with 6304 + 4 CRC digits.
  // The previous version removed only the CRC digits and accidentally left 6304,
  // which caused the parser to read the next bytes as a new field header.
  const fields = parseTlv(cleaned);
  const poi = fields.find((field) => field.id === '01');
  const country = fields.find((field) => field.id === '58');
  if (!poi || !country) throw new Error('Format QRIS tidak valid — field 01/58 tidak ditemukan. Pastikan QRIS_STRING adalah payload QRIS merchant.');
  if (!['11', '12'].includes(poi.value)) throw new Error(`Format QRIS tidak didukung — field 01 bernilai ${poi.value}, harus 11 atau 12.`);

  const output = [];
  let hadAmountField = false;
  for (const field of fields) {
    if (field.id === '63') continue; // rebuild CRC later
    if (field.id === '01') {
      output.push(encodeTlv('01', '12'));
    } else if (field.id === '54') {
      // Keep exactly ONE top-level amount field. This also repairs QRIS strings
      // that were accidentally generated with duplicate 54 fields.
      if (!hadAmountField) {
        output.push(encodeTlv('54', String(numericAmount)));
        hadAmountField = true;
      }
    } else {
      output.push(encodeTlv(field.id, field.value));
    }
  }

  if (!hadAmountField) {
    const countryIndex = output.findIndex((field) => field.startsWith('58'));
    const amountField = encodeTlv('54', String(numericAmount));
    if (countryIndex === -1) output.push(amountField);
    else output.splice(countryIndex, 0, amountField);
  }

  const payload = output.join('');
  return `${payload}6304${convertCRC16(`${payload}6304`)}`;
}

export async function qrisDataUrl(qrisString) {
  return QRCode.toDataURL(qrisString, { scale: 8, margin: 2, errorCorrectionLevel: 'M' });
}
