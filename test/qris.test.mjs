import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDynamicQris, convertCRC16 } from '../qris.js';

function tlv(id, value) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function payload({ amount = null } = {}) {
  const parts = [
    tlv('00', '01'),
    tlv('01', '11'),
    tlv('26', '00140011ID.CO.EXAMPLE0115A1234567890123'),
    ...(amount ? [tlv('54', String(amount))] : []),
    tlv('58', 'ID'),
    tlv('59', 'MERCHANT TEST')
  ];
  return parts.join('');
}

test('buildDynamicQris replaces existing amount field and recalculates CRC', () => {
  const original = `${payload({ amount: 1000 })}6304${convertCRC16(`${payload({ amount: 1000 })}6304`)}`;
  const dynamic = buildDynamicQris(original, 2000);
  assert.equal((dynamic.match(/54\d{2}/g) || []).length, 1);
  assert.match(dynamic, /010212/);
  assert.match(dynamic, /54042000/);
  assert.ok(dynamic.endsWith(convertCRC16(dynamic.slice(0, -4))));
});

test('buildDynamicQris adds amount when static QRIS has no field 54', () => {
  const original = `${payload()}6304${convertCRC16(`${payload()}6304`)}`;
  const dynamic = buildDynamicQris(original, 50000);
  assert.match(dynamic, /540550000/);
  assert.match(dynamic, /5802ID/);
});

test('buildDynamicQris preserves significant spaces and collapses duplicate top-level amount fields', () => {
  const original = '00020101021226610014COM.GO-JEK.WWW01189360091430973426920210G0973426920303UMI51440014ID.CO.QRIS.WWW0215ID10265700401900303UMI5204581653033605403517540115402205802ID5925XS-PEDIAGATEAWAY,Gaming  6009TANGERANG61051512362070703A016304CE41';
  const dynamic = buildDynamicQris(original, 20);
  assert.equal((dynamic.match(/54\d{2}/g) || []).length, 1);
  assert.match(dynamic, /540220/);
  assert.match(dynamic, /5925XS-PEDIAGATEAWAY,Gaming  6009/);
  assert.ok(dynamic.endsWith(convertCRC16(dynamic.slice(0, -4))));
});
