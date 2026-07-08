type Operand = (p: number) => number;
type Predicate = (p: number) => boolean;
type Operator = "<" | "<=" | ">" | ">=" | "==" | "===" | "!=" | "!==" | "&&" | "||";

type Token =
  | { type: "number"; value: number }
  | { type: "p" }
  | { type: "op"; value: Operator }
  | { type: "paren"; value: "(" | ")" };

export type RExpressionFilter = {
  error: string | null;
  test: Predicate;
};

const noFilter: Predicate = () => true;
const numberPattern = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const intervalPattern = new RegExp(`^\\s*([\\[(])\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*([\\])])\\s*$`);

export function compileRExpressionFilter(expression: string): RExpressionFilter {
  const trimmed = expression.trim();
  if (trimmed === "") return { error: null, test: noFilter };

  const interval = compileInterval(trimmed);
  if (interval) return interval;

  try {
    const parser = new Parser(tokenize(trimmed));
    const test = parser.parse();
    return { error: null, test };
  } catch {
    return { error: "INVALID_EXPRESSION", test: noFilter };
  }
}

function compileInterval(expression: string): RExpressionFilter | null {
  const match = intervalPattern.exec(expression);
  if (!match) return null;

  const [, left, minText, maxText, right] = match;
  const min = Number(minText);
  const max = Number(maxText);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { error: "INVALID_EXPRESSION", test: noFilter };
  }

  return {
    error: null,
    test: (p) => {
      const aboveMin = left === "[" ? p >= min : p > min;
      const belowMax = right === "]" ? p <= max : p < max;
      return aboveMin && belowMax;
    },
  };
}

function tokenize(expression: string) {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const op = /^(===|!==|<=|>=|==|!=|&&|\|\||<|>)/.exec(rest);
    if (op) {
      tokens.push({ type: "op", value: op[0] as Operator });
      index += op[0].length;
      continue;
    }

    const number = new RegExp(`^${numberPattern}`).exec(rest);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    if (rest[0] === "p") {
      tokens.push({ type: "p" });
      index += 1;
      continue;
    }

    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ type: "paren", value: rest[0] });
      index += 1;
      continue;
    }

    throw new Error("Unknown token");
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse() {
    const expression = this.parseOr();
    if (!this.isDone()) throw new Error("Unexpected token");
    return expression;
  }

  private parseOr(): Predicate {
    let left = this.parseAnd();
    while (this.matchOp("||")) {
      const right = this.parseAnd();
      const previous = left;
      left = (p) => previous(p) || right(p);
    }
    return left;
  }

  private parseAnd(): Predicate {
    let left = this.parsePrimary();
    while (this.matchOp("&&")) {
      const right = this.parsePrimary();
      const previous = left;
      left = (p) => previous(p) && right(p);
    }
    return left;
  }

  private parsePrimary(): Predicate {
    if (this.matchParen("(")) {
      const expression = this.parseOr();
      if (!this.matchParen(")")) throw new Error("Missing closing parenthesis");
      return expression;
    }

    return this.parseComparison();
  }

  private parseComparison(): Predicate {
    const left = this.parseOperand();
    const operator = this.consumeComparisonOperator();
    const right = this.parseOperand();

    return (p) => {
      const leftValue = left(p);
      const rightValue = right(p);
      switch (operator) {
        case "<":
          return leftValue < rightValue;
        case "<=":
          return leftValue <= rightValue;
        case ">":
          return leftValue > rightValue;
        case ">=":
          return leftValue >= rightValue;
        case "==":
        case "===":
          return leftValue === rightValue;
        case "!=":
        case "!==":
          return leftValue !== rightValue;
      }
    };
  }

  private parseOperand(): Operand {
    const token = this.tokens[this.index];
    if (!token) throw new Error("Missing operand");

    if (token.type === "p") {
      this.index += 1;
      return (p) => p;
    }

    if (token.type === "number") {
      this.index += 1;
      return () => token.value;
    }

    throw new Error("Invalid operand");
  }

  private consumeComparisonOperator() {
    const token = this.tokens[this.index];
    if (
      token?.type !== "op"
      || token.value === "&&"
      || token.value === "||"
    ) {
      throw new Error("Missing comparison operator");
    }

    this.index += 1;
    return token.value;
  }

  private matchOp(value: "&&" | "||") {
    const token = this.tokens[this.index];
    if (token?.type !== "op" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private matchParen(value: "(" | ")") {
    const token = this.tokens[this.index];
    if (token?.type !== "paren" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private isDone() {
    return this.index === this.tokens.length;
  }
}
