import { createDiagnostic, DiagnosticCode, type Diagnostic } from './diagnostics';

/** Address letter with its number, the atomic unit of G-code: `X10.5`, `G1`. */
export interface GCodeWord {
  /** Upper-case address letter. */
  readonly letter: string;
  readonly value: number;
  /** Number exactly as written in the source. */
  readonly numberText: string;
  /** One-based character position in the line. */
  readonly column: number;
}

/** Result of tokenizing one source line. */
export interface TokenizedLine {
  readonly words: readonly GCodeWord[];
  readonly diagnostics: readonly Diagnostic[];
}

const DIGIT_ZERO_CODE = 48;
const DIGIT_NINE_CODE = 57;

const isDigitAt = (text: string, index: number): boolean => {
  const code = text.charCodeAt(index);
  return code >= DIGIT_ZERO_CODE && code <= DIGIT_NINE_CODE;
};

const isAddressLetter = (character: string): boolean =>
  (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');

const isWhitespace = (character: string): boolean => character === ' ' || character === '\t' || character === '\r';

/**
 * Finds the end of a number and counts its digits.
 *
 * @returns Index just past the number and how many digits it has;
 * zero digits means there is no valid number at `startIndex`.
 */
function scanNumber(text: string, startIndex: number): { endIndex: number; digitCount: number } {
  let index = startIndex;
  let digitCount = 0;
  if (text.charAt(index) === '+' || text.charAt(index) === '-') index += 1;
  while (isDigitAt(text, index)) {
    index += 1;
    digitCount += 1;
  }
  if (text.charAt(index) === '.') {
    index += 1;
    while (isDigitAt(text, index)) {
      index += 1;
      digitCount += 1;
    }
  }
  return { endIndex: index, digitCount };
}

/**
 * Splits one line of G-code into words.
 * Handles compact notation (`G1X10Y-5.5`), `( )` and `;` comments, the `/` block-delete marker
 * (blocks are always executed), the `%` delimiter and `*` checksums.
 *
 * @param text - Source line.
 * @param line - One-based line number used in diagnostics.
 */
export function tokenizeLine(text: string, line: number): TokenizedLine {
  const words: GCodeWord[] = [];
  const diagnostics: Diagnostic[] = [];
  let index = 0;

  while (index < text.length) {
    const character = text.charAt(index);

    if (isWhitespace(character) || character === '%' || (character === '/' && words.length === 0)) {
      index += 1;
    } else if (character === ';' || character === '*') {
      break;
    } else if (character === '(') {
      const closingIndex = text.indexOf(')', index + 1);
      if (closingIndex === -1) {
        diagnostics.push(createDiagnostic(DiagnosticCode.UnterminatedComment, line, index + 1));
        break;
      }
      index = closingIndex + 1;
    } else if (isAddressLetter(character)) {
      const letter = character.toUpperCase();
      const column = index + 1;
      index += 1;
      while (isWhitespace(text.charAt(index))) index += 1;

      const { endIndex, digitCount } = scanNumber(text, index);
      if (digitCount === 0) {
        diagnostics.push(createDiagnostic(DiagnosticCode.MissingNumber, line, column, { character: letter }));
      } else {
        const numberText = text.slice(index, endIndex);
        words.push({ letter, value: Number(numberText), numberText, column });
        index = endIndex;
      }
    } else {
      // One diagnostic per garbage line reads better than dozens of identical ones.
      diagnostics.push(createDiagnostic(DiagnosticCode.UnexpectedCharacter, line, index + 1, { character }));
      break;
    }
  }

  return { words, diagnostics };
}
