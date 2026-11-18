/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

const isLineBreak = char =>
  char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';

exports.removeBackslashes = str => {
  const length = str.length;
  const nextClosingBracket = new Int32Array(length + 2);
  const nextLineBreak = new Int32Array(length + 2);
  let closing = length;
  let lineBreak = length;

  // The old regex searched forward for every '[', causing quadratic work on
  // unmatched brackets. Precompute the nearest viable closing bracket and
  // line terminator so every input character is inspected a bounded number
  // of times. A line terminator directly before ']' is valid in the old regex.
  for (let i = length - 1; i >= 0; i--) {
    if (str[i] === ']' && i > 0 && str[i - 1] !== '\\') {
      closing = i;
    }
    if (isLineBreak(str[i])) {
      lineBreak = i;
    }
    nextClosingBracket[i] = closing;
    nextLineBreak[i] = lineBreak;
  }

  let result = '';
  let segmentStart = 0;
  for (let i = 0; i < length; i++) {
    if (str[i] === '[' && i + 2 < length) {
      const end = nextClosingBracket[i + 2];
      if (end < length && nextLineBreak[i + 1] >= end - 1) {
        // A complete bracket class is kept verbatim, including its escapes.
        i = end;
        continue;
      }
    }

    if (str[i] === '\\' && i + 1 < length && !isLineBreak(str[i + 1])) {
      result += str.slice(segmentStart, i);
      segmentStart = i + 1;
    }
  }

  return result + str.slice(segmentStart);
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
