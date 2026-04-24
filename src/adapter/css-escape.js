export function cssEscape(value) {
  const str = String(value);
  const len = str.length;
  let result = '';

  for (let i = 0; i < len; i++) {
    const ch = str.charCodeAt(i);

    if (ch === 0) {
      result += '�';
      continue;
    }

    if (
      (ch >= 0x0001 && ch <= 0x001F) ||
      ch === 0x007F
    ) {
      result += '\\' + ch.toString(16) + ' ';
      continue;
    }

    if (i === 0 && ch >= 0x0030 && ch <= 0x0039) {
      result += '\\' + ch.toString(16) + ' ';
      continue;
    }

    if (
      i === 1 &&
      ch >= 0x0030 && ch <= 0x0039 &&
      str.charCodeAt(0) === 0x002D
    ) {
      result += '\\' + ch.toString(16) + ' ';
      continue;
    }

    if (i === 0 && len === 1 && ch === 0x002D) {
      result += '\\' + str.charAt(i);
      continue;
    }

    if (
      ch >= 0x0080 ||
      ch === 0x002D ||
      ch === 0x005F ||
      (ch >= 0x0030 && ch <= 0x0039) ||
      (ch >= 0x0041 && ch <= 0x005A) ||
      (ch >= 0x0061 && ch <= 0x007A)
    ) {
      result += str.charAt(i);
      continue;
    }

    result += '\\' + str.charAt(i);
  }

  return result;
}
