import { HighlightStyle, StreamLanguage, type StreamParser } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const MOTION_COMMAND_PATTERN = /^[gG]\s*[0-9.]+/;
const MACHINE_COMMAND_PATTERN = /^[mM]\s*[0-9.]+/;
const AXIS_WORD_PATTERN = /^[xyzXYZ]\s*[+-]?[0-9.]+/;
const PARAMETER_WORD_PATTERN = /^[a-zA-Z]\s*[+-]?[0-9.]+/;

/** Tokenizer for coloring G-code. Purely cosmetic: all real parsing is done by the core. */
const gcodeStreamParser: StreamParser<unknown> = {
  name: 'gcode',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === ';') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.peek() === '(') {
      if (!stream.skipTo(')')) stream.skipToEnd();
      else stream.next();
      return 'comment';
    }
    if (stream.match(MOTION_COMMAND_PATTERN)) return 'keyword';
    if (stream.match(MACHINE_COMMAND_PATTERN)) return 'atom';
    if (stream.match(AXIS_WORD_PATTERN)) return 'number';
    if (stream.match(PARAMETER_WORD_PATTERN)) return 'string';
    stream.next();
    return null;
  },
};

export const gcodeLanguage = StreamLanguage.define(gcodeStreamParser);

export const gcodeHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#9aa0ab', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#1c1c1e', fontWeight: '700' },
  { tag: tags.atom, color: '#b76e00', fontWeight: '600' },
  { tag: tags.number, color: '#2b5fd9' },
  { tag: tags.string, color: '#6d7380' },
]);
