/* Reading and writing CSV text. No DOM access. */
(function (root) {
  'use strict';

  const QUOTE = '"';
  const BYTE_ORDER_MARK = '﻿';

  /** Files exported in many European locales separate fields with ; because , is the decimal sign there. */
  function delimiterOf(text) {
    const firstLine = text.split('\n', 1)[0];
    const count = (sign) => firstLine.split(sign).length;
    return count(';') > count(',') ? ';' : ',';
  }

  /** The rows of a CSV text, each a list of field texts. Quoted fields may hold the delimiter, line breaks and doubled quotes. */
  function parseCsv(csv) {
    const text = csv.replace(BYTE_ORDER_MARK, '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    if (text === '') return [];
    const delimiter = delimiterOf(text);
    const rows = [[]];
    let field = '';
    let isQuoted = false;
    const endField = () => { rows[rows.length - 1].push(field); field = ''; };
    for (let i = 0; i < text.length; i++) {
      const sign = text[i];
      const isDoubledQuote = isQuoted && sign === QUOTE && text[i + 1] === QUOTE;
      if (isDoubledQuote) { field += QUOTE; i++; }
      else if (sign === QUOTE && (isQuoted || field === '')) isQuoted = !isQuoted;
      else if (isQuoted) field += sign;
      else if (sign === delimiter) endField();
      else if (sign === '\n') { endField(); rows.push([]); }
      else field += sign;
    }
    endField();
    return rows;
  }

  function csvLine(fields) {
    return fields.map((text) => (/[",;\n]/.test(text) ? QUOTE + text.replace(/"/g, '""') + QUOTE : text)).join(',');
  }

  Object.assign(root.XL, { parseCsv, csvLine });
})(typeof window !== 'undefined' ? window : globalThis);
