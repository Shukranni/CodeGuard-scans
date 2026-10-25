const CP1252_EXTENDED_BYTES = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const CP1252_EXTENDED_CHAR =
  '[\\u0080-\\u00bf\\u201a-\\u203a\\u20ac\\u2122\\u0192\\u02c6\\u02dc\\u0160\\u0161\\u0152\\u0153\\u0178\\u017d\\u017e]';
const MOJIBAKE_MARKERS = new RegExp(
  `(?:Ã[\\u0080-\\u00ff]|Â[\\u0080-\\u00ff]|â€${CP1252_EXTENDED_CHAR}|â[\\u0080-\\u00bf]{2}|ï¿½)`,
  'g',
);

const markerCount = (text) => (text.match(MOJIBAKE_MARKERS) || []).length;

const decodeAsUtf8 = (text) => {
  const bytes = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else if (CP1252_EXTENDED_BYTES.has(codePoint)) {
      bytes.push(CP1252_EXTENDED_BYTES.get(codePoint));
    } else {
      return null;
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
};

export const normalizeTextEncoding = (value) => {
  if (typeof value !== 'string' || !MOJIBAKE_MARKERS.test(value)) return value;
  MOJIBAKE_MARKERS.lastIndex = 0;

  let result = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decoded = result.replace(
      MOJIBAKE_MARKERS,
      (sequence) => decodeAsUtf8(sequence) ?? sequence,
    );
    if (decoded === result || markerCount(decoded) >= markerCount(result)) break;
    result = decoded;
  }

  return result;
};

export const normalizeAiText = (value) => {
  if (typeof value === 'string') return normalizeTextEncoding(value);
  if (Array.isArray(value)) return value.map(normalizeAiText);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeAiText(item)]),
    );
  }
  return value;
};
