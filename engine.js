(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SheetEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function indexToCol(index) {
    let n = index + 1;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function colToIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
  }

  function addrOf(col, row) {
    return indexToCol(col) + String(row + 1);
  }

  function parseAddr(addr) {
    const m = /^([A-Z]+)(\d+)$/.exec(String(addr).toUpperCase());
    if (!m) return null;
    return { col: colToIndex(m[1]), row: Number(m[2]) - 1, addr: m[1] + m[2] };
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "#NUM!";
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, "e");
    const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
    return String(rounded);
  }

  function parseLiteral(input) {
    const raw = String(input);
    const trimmed = raw.trim();
    if (trimmed.startsWith("'")) {
      return { type: "str", value: raw.slice(1), display: raw.slice(1), numeric: false };
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      return { type: "num", value: n, display: formatNumber(n), numeric: true };
    }
    return { type: "str", value: raw, display: raw, numeric: false };
  }

  function blankValue() {
    return { type: "num", value: 0, blank: true, display: "", numeric: false };
  }

  function isAlpha(ch) {
    return ch && /[A-Za-z]/.test(ch);
  }

  function isDigit(ch) {
    return ch && ch >= "0" && ch <= "9";
  }

  function asNumber(v) {
    if (!v || v.type === "err") return null;
    if (v.blank) return 0;
    if (v.type === "num") return v.value;
    if (v.type === "str") {
      const t = v.value.trim();
      if (t === "") return 0;
      if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
      if (/^true$/i.test(t)) return 1;
      if (/^false$/i.test(t)) return 0;
    }
    return null;
  }

  function asString(v) {
    if (!v) return "";
    if (v.type === "err") return v.value;
    if (v.blank) return "";
    if (v.bool) return v.value ? "TRUE" : "FALSE";
    if (v.type === "num") return formatNumber(v.value);
    return String(v.value);
  }

  function numResult(n) {
    return { type: "num", value: n };
  }

  function err(code) {
    return { type: "err", value: code };
  }

  function callFn(name, args) {
    if (name === "SUM" || name === "AVERAGE" || name === "MIN" || name === "MAX" || name === "COUNT" || name === "COUNTA") {
      const flat = [];
      for (const arg of args) {
        const list = arg.type === "range" ? arg.values : [arg];
        for (const item of list) {
          if (item.type === "err") return item;
          flat.push(item);
        }
      }
      if (name === "COUNT") {
        return numResult(flat.filter((item) => !item.blank && item.type === "num").length);
      }
      if (name === "COUNTA") {
        return numResult(flat.filter((item) => !item.blank && item.display !== "").length);
      }
      const nums = [];
      for (const item of flat) {
        if (item.blank) continue;
        if (item.type === "num") nums.push(item.value);
        else if (!ignoreTextForAgg(name)) return err("#VALUE!");
      }
      if (name === "SUM") return numResult(nums.reduce((a, b) => a + b, 0));
      if (name === "MIN") return nums.length ? numResult(Math.min.apply(null, nums)) : numResult(0);
      if (name === "MAX") return nums.length ? numResult(Math.max.apply(null, nums)) : numResult(0);
      if (!nums.length) return err("#DIV/0!");
      return numResult(nums.reduce((a, b) => a + b, 0) / nums.length);
    }

    if (name === "ROUND") {
      const n = asNumber(args[0]);
      const d = args[1] ? asNumber(args[1]) : 0;
      if (n == null || d == null) return err("#VALUE!");
      const p = 10 ** Math.trunc(d);
      return numResult(Math.round(n * p) / p);
    }
    if (name === "ABS") {
      const n = asNumber(args[0]);
      if (n == null) return err("#VALUE!");
      return numResult(Math.abs(n));
    }
    if (name === "INT") {
      const n = asNumber(args[0]);
      if (n == null) return err("#VALUE!");
      return numResult(Math.floor(n));
    }
    if (name === "LEN") {
      if (!args[0] || args[0].type === "range") return err("#VALUE!");
      if (args[0].type === "err") return args[0];
      return numResult(asString(args[0]).length);
    }
    if (name === "TRIM") {
      if (!args[0] || args[0].type === "range") return err("#VALUE!");
      if (args[0].type === "err") return args[0];
      return { type: "str", value: asString(args[0]).replace(/\s+/g, " ").trim() };
    }
    if (name === "IF") {
      const cond = args[0];
      if (!cond || cond.type === "range") return err("#VALUE!");
      if (cond.type === "err") return cond;
      let truth = false;
      if (cond.type === "num") truth = cond.value !== 0;
      else if (cond.type === "str") truth = cond.value !== "";
      const chosen = truth ? args[1] : args[2];
      if (!chosen) return blankValue();
      if (chosen.type === "range") return err("#VALUE!");
      return chosen;
    }
    return err("#NAME?");
  }

  function ignoreTextForAgg(name) {
    return name === "SUM" || name === "AVERAGE" || name === "MIN" || name === "MAX";
  }

  function evalFormula(src, resolveCell) {
    const s = String(src);
    let i = 0;

    function skip() {
      while (s[i] === " " || s[i] === "\t") i++;
    }

    function parseComparison() {
      let left = parseConcat();
      if (left.type === "err") return left;
      skip();
      const ops = ["<=", ">=", "<>", "=", "<", ">"];
      for (let k = 0; k < ops.length; k++) {
        const op = ops[k];
        if (s.startsWith(op, i)) {
          i += op.length;
          const right = parseConcat();
          return compare(op, left, right);
        }
      }
      return left;
    }

    function parseConcat() {
      let left = parseAdd();
      skip();
      while (s[i] === "&") {
        i++;
        const right = parseAdd();
        if (left.type === "err") return left;
        if (right.type === "err") return right;
        left = { type: "str", value: asString(left) + asString(right) };
        skip();
      }
      return left;
    }

    function parseAdd() {
      let left = parseMul();
      skip();
      while (s[i] === "+" || s[i] === "-") {
        const op = s[i++];
        const right = parseMul();
        left = applyNum(op, left, right);
        skip();
      }
      return left;
    }

    function parseMul() {
      let left = parseUnary();
      skip();
      while (s[i] === "*" || s[i] === "/") {
        const op = s[i++];
        const right = parseUnary();
        if (left.type === "err") return left;
        if (right.type === "err") return right;
        if (op === "/") {
          const divisor = asNumber(right);
          if (divisor == null) return err("#VALUE!");
          if (divisor === 0) return err("#DIV/0!");
        }
        left = applyNum(op, left, right);
        skip();
      }
      return left;
    }

    function parseUnary() {
      skip();
      if (s[i] === "-") {
        i++;
        const v = parseUnary();
        if (v.type === "err") return v;
        const n = asNumber(v);
        if (n == null) return err("#VALUE!");
        return numResult(-n);
      }
      if (s[i] === "+") {
        i++;
        return parseUnary();
      }
      return parsePrimary();
    }

    function parsePrimary() {
      skip();
      if (i >= s.length) return err("#ERR!");
      if (s[i] === "(") {
        i++;
        const v = parseComparison();
        skip();
        if (s[i] !== ")") return err("#ERR!");
        i++;
        return v;
      }
      if (s[i] === '"') {
        i++;
        let out = "";
        while (i < s.length) {
          if (s[i] === '"') {
            if (s[i + 1] === '"') {
              out += '"';
              i += 2;
              continue;
            }
            i++;
            return { type: "str", value: out };
          }
          out += s[i++];
        }
        return err("#ERR!");
      }
      if (isDigit(s[i]) || (s[i] === "." && isDigit(s[i + 1]))) {
        const start = i;
        while (isDigit(s[i])) i++;
        if (s[i] === ".") {
          i++;
          while (isDigit(s[i])) i++;
        }
        return numResult(Number(s.slice(start, i)));
      }
      if (isAlpha(s[i])) {
        const start = i;
        while (isAlpha(s[i])) i++;
        const name = s.slice(start, i).toUpperCase();
        skip();
        if (s[i] === "(") {
          i++;
          const args = [];
          skip();
          if (s[i] !== ")") {
            while (true) {
              const arg = parseArg();
              args.push(arg);
              skip();
              if (s[i] === ",") {
                i++;
                continue;
              }
              break;
            }
          }
          skip();
          if (s[i] !== ")") return err("#ERR!");
          i++;
          return callFn(name, args);
        }
        if (isDigit(s[i])) {
          const rowStart = i;
          while (isDigit(s[i])) i++;
          return cellRef(name + s.slice(rowStart, i));
        }
        if (name === "TRUE") return { type: "num", value: 1, bool: true };
        if (name === "FALSE") return { type: "num", value: 0, bool: true };
        return err("#NAME?");
      }
      return err("#ERR!");
    }

    function tryReadCell() {
      const save = i;
      skip();
      if (!isAlpha(s[i])) {
        i = save;
        return null;
      }
      const start = i;
      while (isAlpha(s[i])) i++;
      const letters = s.slice(start, i).toUpperCase();
      if (!isDigit(s[i])) {
        i = save;
        return null;
      }
      const rowStart = i;
      while (isDigit(s[i])) i++;
      const row = Number(s.slice(rowStart, i));
      if (!row) {
        i = save;
        return null;
      }
      return letters + String(row);
    }

    function parseArg() {
      const save = i;
      const first = tryReadCell();
      if (first) {
        skip();
        if (s[i] === ":") {
          i++;
          const second = tryReadCell();
          if (!second) return err("#ERR!");
          return makeRange(first, second);
        }
        i = save;
      }
      return parseComparison();
    }

    function cellRef(addr) {
      const parsed = parseAddr(addr);
      if (!parsed) return err("#REF!");
      const value = resolveCell(parsed.addr);
      return value || blankValue();
    }

    function makeRange(a, b) {
      const pa = parseAddr(a);
      const pb = parseAddr(b);
      if (!pa || !pb) return err("#REF!");
      const c1 = Math.min(pa.col, pb.col);
      const c2 = Math.max(pa.col, pb.col);
      const r1 = Math.min(pa.row, pb.row);
      const r2 = Math.max(pa.row, pb.row);
      if ((c2 - c1 + 1) * (r2 - r1 + 1) > 20000) return err("#REF!");
      const values = [];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          values.push(resolveCell(addrOf(c, r)) || blankValue());
        }
      }
      return { type: "range", values: values };
    }

    function applyNum(op, left, right) {
      if (left.type === "err") return left;
      if (right.type === "err") return right;
      const a = asNumber(left);
      const b = asNumber(right);
      if (a == null || b == null) return err("#VALUE!");
      if (op === "+") return numResult(a + b);
      if (op === "-") return numResult(a - b);
      if (op === "*") return numResult(a * b);
      return numResult(a / b);
    }

    function compare(op, left, right) {
      if (left.type === "err") return left;
      if (right.type === "err") return right;
      let result = false;
      const an = left.blank ? 0 : left.type === "num" ? left.value : null;
      const bn = right.blank ? 0 : right.type === "num" ? right.value : null;
      if (an != null && bn != null && left.type !== "str" && right.type !== "str") {
        if (op === "=") result = an === bn;
        else if (op === "<>") result = an !== bn;
        else if (op === "<") result = an < bn;
        else if (op === ">") result = an > bn;
        else if (op === "<=") result = an <= bn;
        else result = an >= bn;
      } else {
        const as = asString(left);
        const bs = asString(right);
        if (op === "=") result = as === bs;
        else if (op === "<>") result = as !== bs;
        else if (op === "<") result = as < bs;
        else if (op === ">") result = as > bs;
        else if (op === "<=") result = as <= bs;
        else result = as >= bs;
      }
      return { type: "num", value: result ? 1 : 0, bool: true };
    }

    skip();
    if (!s.trim()) return blankValue();
    const value = parseComparison();
    skip();
    if (i < s.length) return err("#ERR!");
    return value;
  }

  function present(value) {
    if (!value) return { display: "", numeric: false, error: false, align: "left" };
    if (value.type === "err") {
      return { display: value.value, numeric: false, error: true, align: "center" };
    }
    if (value.blank) return { display: "", numeric: false, error: false, align: "left" };
    if (value.bool) {
      return { display: value.value ? "TRUE" : "FALSE", numeric: false, error: false, align: "center" };
    }
    if (value.type === "num") {
      return { display: formatNumber(value.value), numeric: true, error: false, align: "right" };
    }
    return { display: value.value == null ? "" : String(value.value), numeric: false, error: false, align: "left" };
  }

  function evaluateCell(cells, addr, stack, cache) {
    const key = String(addr).toUpperCase();
    if (cache.has(key)) return cache.get(key);
    if (stack.has(key)) {
      const circular = err("#CIRC!");
      return circular;
    }
    const rec = cells[key];
    if (!rec || rec.input == null || rec.input === "") {
      const blank = blankValue();
      cache.set(key, blank);
      return blank;
    }
    const input = String(rec.input);
    if (!input.startsWith("=")) {
      const lit = parseLiteral(input);
      cache.set(key, lit);
      return lit;
    }
    stack.add(key);
    const value = evalFormula(input.slice(1), function (dep) {
      return evaluateCell(cells, dep, stack, cache);
    });
    stack.delete(key);
    if (value && value.type === "err" && value.value === "#CIRC!") {
      return value;
    }
    cache.set(key, value);
    return value;
  }

  function evaluateAll(cells) {
    const cache = new Map();
    const display = {};
    const keys = Object.keys(cells);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].toUpperCase();
      display[key] = present(evaluateCell(cells, key, new Set(), cache));
    }
    return {
      display: display,
      valueOf: function (addr) {
        return present(evaluateCell(cells, addr, new Set(), cache));
      },
    };
  }

  return {
    indexToCol: indexToCol,
    colToIndex: colToIndex,
    addrOf: addrOf,
    parseAddr: parseAddr,
    formatNumber: formatNumber,
    evaluateAll: evaluateAll,
    present: present,
  };
});
