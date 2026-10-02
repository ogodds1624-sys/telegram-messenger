(function () {
  const COLS = 26;
  const ROWS = 80;
  const STORAGE_KEY = "white-spreadsheet-v1";
  const engine = window.SheetEngine;

  const gridWrap = document.getElementById("grid-wrap");
  const nameBox = document.getElementById("name-box");
  const formulaInput = document.getElementById("formula-input");
  const docTitle = document.getElementById("doc-title");
  const statusText = document.getElementById("status-text");
  const statusMeta = document.getElementById("status-meta");

  const state = {
    cells: {},
    colWidths: Array.from({ length: COLS }, function () { return 112; }),
    anchor: { c: 0, r: 0 },
    focus: { c: 0, r: 0 },
    editing: false,
    undo: [],
    redo: [],
  };

  const canvas = document.createElement("div");
  canvas.className = "grid-canvas";
  canvas.id = "grid-canvas";
  const table = document.createElement("table");
  table.className = "grid";
  const editor = document.createElement("input");
  editor.id = "cell-editor";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Cell editor");
  canvas.appendChild(table);
  canvas.appendChild(editor);
  gridWrap.appendChild(canvas);

  const cellEls = [];

  function keyOf(c, r) {
    return engine.addrOf(c, r);
  }

  function ensure(addr) {
    if (!state.cells[addr]) state.cells[addr] = { input: "", style: {} };
    if (!state.cells[addr].style) state.cells[addr].style = {};
    return state.cells[addr];
  }

  function getInput(c, r) {
    const rec = state.cells[keyOf(c, r)];
    return rec && rec.input ? String(rec.input) : "";
  }

  function bounds() {
    return {
      c1: Math.min(state.anchor.c, state.focus.c),
      c2: Math.max(state.anchor.c, state.focus.c),
      r1: Math.min(state.anchor.r, state.focus.r),
      r2: Math.max(state.anchor.r, state.focus.r),
    };
  }

  function buildGrid() {
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "corner";
    headRow.appendChild(corner);
    for (let c = 0; c < COLS; c++) {
      const th = document.createElement("th");
      th.className = "col-head";
      th.dataset.col = String(c);
      th.textContent = engine.indexToCol(c);
      th.style.width = state.colWidths[c] + "px";
      const handle = document.createElement("span");
      handle.className = "col-resizer";
      handle.dataset.col = String(c);
      th.appendChild(handle);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let r = 0; r < ROWS; r++) {
      const tr = document.createElement("tr");
      const rh = document.createElement("th");
      rh.dataset.row = String(r);
      rh.textContent = String(r + 1);
      tr.appendChild(rh);
      const rowEls = [];
      for (let c = 0; c < COLS; c++) {
        const td = document.createElement("td");
        td.dataset.col = String(c);
        td.dataset.row = String(r);
        td.style.width = state.colWidths[c] + "px";
        tr.appendChild(td);
        rowEls.push(td);
      }
      cellEls.push(rowEls);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function selectedCells() {
    const b = bounds();
    const out = [];
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) out.push({ c: c, r: r });
    }
    return out;
  }

  function snapshot() {
    return JSON.stringify({
      cells: state.cells,
      colWidths: state.colWidths,
      title: docTitle.value,
    });
  }

  function pushUndo() {
    state.undo.push(snapshot());
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
  }

  function restore(raw) {
    const data = JSON.parse(raw);
    state.cells = data.cells || {};
    if (Array.isArray(data.colWidths) && data.colWidths.length === COLS) {
      state.colWidths = data.colWidths;
    }
    docTitle.value = data.title || "Untitled spreadsheet";
    applyColWidths();
    render();
    save();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      localStorage.setItem(STORAGE_KEY, snapshot());
    }, 150);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.cells = data.cells || {};
      if (Array.isArray(data.colWidths) && data.colWidths.length === COLS) {
        state.colWidths = data.colWidths;
      }
      if (data.title) docTitle.value = data.title;
      applyColWidths();
    } catch (e) {
      state.cells = {};
    }
  }

  function applyColWidths() {
    const heads = table.querySelectorAll("thead th.col-head");
    for (let c = 0; c < COLS; c++) {
      if (heads[c]) heads[c].style.width = state.colWidths[c] + "px";
      for (let r = 0; r < ROWS; r++) {
        cellEls[r][c].style.width = state.colWidths[c] + "px";
      }
    }
  }

  function render() {
    const evaluated = engine.evaluateAll(state.cells);
    const b = bounds();
    for (let r = 0; r < ROWS; r++) {
      const rowHead = cellEls[r][0].parentElement.firstChild;
      const rowHot = r >= b.r1 && r <= b.r2;
      rowHead.classList.toggle("hot", rowHot);
      for (let c = 0; c < COLS; c++) {
        const td = cellEls[r][c];
        const addr = keyOf(c, r);
        const rec = state.cells[addr];
        const view = evaluated.display[addr];
        const text = view ? view.display : "";
        if (td.textContent !== text) td.textContent = text;
        td.classList.toggle("num", !!(view && view.numeric));
        td.classList.toggle("error", !!(view && view.error));
        td.classList.toggle("in-range", c >= b.c1 && c <= b.c2 && r >= b.r1 && r <= b.r2);
        td.classList.toggle("active", c === state.focus.c && r === state.focus.r);
        const style = (rec && rec.style) || {};
        td.classList.toggle("bold", !!style.bold);
        td.classList.toggle("italic", !!style.italic);
        td.classList.toggle("underline", !!style.underline);
        td.classList.remove("align-left", "align-center", "align-right");
        if (style.align) td.classList.add("align-" + style.align);
        else if (view && view.align === "right") td.classList.add("num");
      }
    }
    const heads = table.querySelectorAll("thead th.col-head");
    for (let c = 0; c < COLS; c++) {
      heads[c].classList.toggle("hot", c >= b.c1 && c <= b.c2);
    }
    const addr = keyOf(state.focus.c, state.focus.r);
    nameBox.textContent = addr;
    if (document.activeElement !== formulaInput && !state.editing) {
      formulaInput.value = getInput(state.focus.c, state.focus.r);
    }
    const count = (b.c2 - b.c1 + 1) * (b.r2 - b.r1 + 1);
    statusMeta.textContent = count > 1 ? count + " cells selected" : COLS + " × " + ROWS;
    const view = evaluated.valueOf(addr);
    statusText.textContent = view && view.error ? view.display : "Ready";
    if (state.editing) positionEditor();
  }

  function setFocus(c, r, extend) {
    c = Math.max(0, Math.min(COLS - 1, c));
    r = Math.max(0, Math.min(ROWS - 1, r));
    if (!extend) state.anchor = { c: c, r: r };
    state.focus = { c: c, r: r };
    render();
    const td = cellEls[r][c];
    const wrapRect = gridWrap.getBoundingClientRect();
    const rect = td.getBoundingClientRect();
    if (rect.right > wrapRect.right) gridWrap.scrollLeft += rect.right - wrapRect.right + 8;
    if (rect.left < wrapRect.left + 48) gridWrap.scrollLeft -= wrapRect.left + 48 - rect.left;
    if (rect.bottom > wrapRect.bottom) gridWrap.scrollTop += rect.bottom - wrapRect.bottom + 8;
    if (rect.top < wrapRect.top + 30) gridWrap.scrollTop -= wrapRect.top + 30 - rect.top;
  }

  function commitInput(raw) {
    const addr = keyOf(state.focus.c, state.focus.r);
    const next = raw == null ? "" : String(raw);
    const prev = getInput(state.focus.c, state.focus.r);
    if (next === prev) return;
    pushUndo();
    if (!next) {
      if (state.cells[addr] && !hasStyle(state.cells[addr].style)) delete state.cells[addr];
      else if (state.cells[addr]) state.cells[addr].input = "";
    } else {
      ensure(addr).input = next;
    }
    save();
  }

  function hasStyle(style) {
    if (!style) return false;
    return !!(style.bold || style.italic || style.underline || style.align);
  }

  function positionEditor() {
    const td = cellEls[state.focus.r][state.focus.c];
    const canvasRect = canvas.getBoundingClientRect();
    const rect = td.getBoundingClientRect();
    editor.style.display = "block";
    editor.style.left = rect.left - canvasRect.left + "px";
    editor.style.top = rect.top - canvasRect.top + "px";
    editor.style.width = rect.width + "px";
    editor.style.height = rect.height + "px";
  }

  function beginEdit(seed) {
    state.editing = true;
    editor.value = seed == null ? getInput(state.focus.c, state.focus.r) : seed;
    formulaInput.value = editor.value;
    positionEditor();
    editor.focus();
    const end = editor.value.length;
    if (seed == null) editor.setSelectionRange(end, end);
    else editor.setSelectionRange(end, end);
  }

  function endEdit(commit) {
    if (!state.editing) return;
    const value = editor.value;
    state.editing = false;
    editor.style.display = "none";
    if (commit) commitInput(value);
    if (document.activeElement === editor) editor.blur();
    formulaInput.value = getInput(state.focus.c, state.focus.r);
    render();
  }

  function clearSelection() {
    const cells = selectedCells();
    const changed = cells.some(function (cell) { return getInput(cell.c, cell.r); });
    if (!changed) return;
    pushUndo();
    cells.forEach(function (cell) {
      const addr = keyOf(cell.c, cell.r);
      if (!state.cells[addr]) return;
      if (!hasStyle(state.cells[addr].style)) delete state.cells[addr];
      else state.cells[addr].input = "";
    });
    save();
    render();
  }

  function applyStyle(mutator) {
    pushUndo();
    selectedCells().forEach(function (cell) {
      const addr = keyOf(cell.c, cell.r);
      const rec = ensure(addr);
      mutator(rec.style);
      if (!rec.input && !hasStyle(rec.style)) delete state.cells[addr];
    });
    save();
    render();
    updateToolbar();
  }

  function updateToolbar() {
    const rec = state.cells[keyOf(state.focus.c, state.focus.r)];
    const style = (rec && rec.style) || {};
    document.querySelectorAll(".toolbar button").forEach(function (btn) {
      const cmd = btn.dataset.cmd;
      let on = false;
      if (cmd === "bold") on = !!style.bold;
      if (cmd === "italic") on = !!style.italic;
      if (cmd === "underline") on = !!style.underline;
      if (cmd === "align-left") on = style.align === "left";
      if (cmd === "align-center") on = style.align === "center";
      if (cmd === "align-right") on = style.align === "right";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function csvEscape(value) {
    const s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv() {
    const evaluated = engine.evaluateAll(state.cells);
    let maxC = 0;
    let maxR = 0;
    let any = false;
    Object.keys(state.cells).forEach(function (addr) {
      const parsed = engine.parseAddr(addr);
      if (!parsed) return;
      if (parsed.col < COLS && parsed.row < ROWS && state.cells[addr].input) {
        any = true;
        if (parsed.col > maxC) maxC = parsed.col;
        if (parsed.row > maxR) maxR = parsed.row;
      }
    });
    const lines = [];
    const lastR = any ? maxR : 0;
    const lastC = any ? maxC : 0;
    for (let r = 0; r <= lastR; r++) {
      const row = [];
      for (let c = 0; c <= lastC; c++) {
        const view = evaluated.display[keyOf(c, r)];
        row.push(csvEscape(view ? view.display : ""));
      }
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (docTitle.value || "spreadsheet").replace(/[\\/:*?"<>|]+/g, " ") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onGridMouseDown(event) {
    const handle = event.target.closest(".col-resizer");
    if (handle) {
      event.preventDefault();
      const col = Number(handle.dataset.col);
      const startX = event.clientX;
      const startW = state.colWidths[col];
      const before = snapshot();
      function move(ev) {
        state.colWidths[col] = Math.max(48, startW + ev.clientX - startX);
        applyColWidths();
        if (state.editing) positionEditor();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (state.colWidths[col] !== startW) {
          state.undo.push(before);
          if (state.undo.length > 80) state.undo.shift();
          state.redo = [];
          save();
        }
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      return;
    }

    const th = event.target.closest("th");
    if (th && th.dataset.col != null && !th.classList.contains("corner")) {
      if (state.editing) endEdit(true);
      const c = Number(th.dataset.col);
      state.anchor = { c: c, r: ROWS - 1 };
      state.focus = { c: c, r: 0 };
      render();
      return;
    }
    if (th && th.dataset.row != null) {
      if (state.editing) endEdit(true);
      const r = Number(th.dataset.row);
      state.anchor = { c: COLS - 1, r: r };
      state.focus = { c: 0, r: r };
      render();
      return;
    }

    const td = event.target.closest("td");
    if (!td) return;
    if (state.editing) endEdit(true);
    const c = Number(td.dataset.col);
    const r = Number(td.dataset.row);
    setFocus(c, r, event.shiftKey);
    formulaInput.blur();

    function move(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el && el.closest ? el.closest("td") : null;
      if (!cell || !table.contains(cell)) return;
      setFocus(Number(cell.dataset.col), Number(cell.dataset.row), true);
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  table.addEventListener("mousedown", onGridMouseDown);
  table.addEventListener("dblclick", function (event) {
    const td = event.target.closest("td");
    if (!td) return;
    setFocus(Number(td.dataset.col), Number(td.dataset.row), false);
    beginEdit(null);
  });

  editor.addEventListener("input", function () {
    formulaInput.value = editor.value;
  });

  editor.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      endEdit(true);
      setFocus(state.focus.c, state.focus.r + 1, false);
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      endEdit(true);
      setFocus(state.focus.c, state.focus.r - 1, false);
    } else if (event.key === "Tab") {
      event.preventDefault();
      endEdit(true);
      setFocus(state.focus.c + (event.shiftKey ? -1 : 1), state.focus.r, false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      endEdit(false);
    }
  });

  editor.addEventListener("blur", function () {
    if (!state.editing) return;
    endEdit(true);
  });

  formulaInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitInput(formulaInput.value);
      formulaInput.blur();
      setFocus(state.focus.c, state.focus.r + 1, false);
    } else if (event.key === "Escape") {
      formulaInput.value = getInput(state.focus.c, state.focus.r);
      formulaInput.blur();
    }
  });

  formulaInput.addEventListener("input", function () {
    if (state.editing) {
      editor.value = formulaInput.value;
    }
  });

  formulaInput.addEventListener("blur", function () {
    if (state.editing) return;
    commitInput(formulaInput.value);
    render();
  });

  document.addEventListener("keydown", function (event) {
    const inField = event.target === editor || event.target === formulaInput || event.target === docTitle;
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (state.editing) return;
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      if (!state.editing) redo();
      return;
    }
    if (meta && event.key.toLowerCase() === "b") {
      event.preventDefault();
      applyStyle(function (style) { style.bold = !style.bold; });
      return;
    }
    if (meta && event.key.toLowerCase() === "i") {
      event.preventDefault();
      applyStyle(function (style) { style.italic = !style.italic; });
      return;
    }
    if (meta && event.key.toLowerCase() === "u") {
      event.preventDefault();
      applyStyle(function (style) { style.underline = !style.underline; });
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      statusText.textContent = "Saved in this browser";
      return;
    }

    if (inField) return;

    if (event.key === "Enter") {
      event.preventDefault();
      setFocus(state.focus.c, state.focus.r + (event.shiftKey ? -1 : 1), false);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      setFocus(state.focus.c + (event.shiftKey ? -1 : 1), state.focus.r, false);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocus(state.focus.c, state.focus.r - 1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocus(state.focus.c, state.focus.r + 1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setFocus(state.focus.c - 1, state.focus.r, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setFocus(state.focus.c + 1, state.focus.r, event.shiftKey);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      beginEdit(null);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearSelection();
      formulaInput.value = getInput(state.focus.c, state.focus.r);
      return;
    }
    if (event.key === "Escape") return;
    if (event.key.length === 1 && !meta && !event.altKey) {
      event.preventDefault();
      beginEdit(event.key);
    }
  });

  document.addEventListener("copy", function (event) {
    if (event.target === editor || event.target === formulaInput || event.target === docTitle) return;
    const b = bounds();
    const lines = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const row = [];
      for (let c = b.c1; c <= b.c2; c++) row.push(getInput(c, r));
      lines.push(row.join("\t"));
    }
    event.clipboardData.setData("text/plain", lines.join("\n"));
    event.preventDefault();
  });

  document.addEventListener("paste", function (event) {
    if (event.target === editor || event.target === formulaInput || event.target === docTitle) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (rows.length && rows[rows.length - 1] === "") rows.pop();
    pushUndo();
    rows.forEach(function (line, dr) {
      const cols = line.split("\t");
      cols.forEach(function (value, dc) {
        const c = state.focus.c + dc;
        const r = state.focus.r + dr;
        if (c >= COLS || r >= ROWS) return;
        const addr = keyOf(c, r);
        if (!value) {
          if (state.cells[addr] && !hasStyle(state.cells[addr].style)) delete state.cells[addr];
          else if (state.cells[addr]) state.cells[addr].input = "";
        } else {
          ensure(addr).input = value;
        }
      });
    });
    save();
    render();
  });

  document.querySelectorAll(".toolbar button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const cmd = btn.dataset.cmd;
      if (cmd === "bold") applyStyle(function (style) { style.bold = !style.bold; });
      if (cmd === "italic") applyStyle(function (style) { style.italic = !style.italic; });
      if (cmd === "underline") applyStyle(function (style) { style.underline = !style.underline; });
      if (cmd === "align-left") applyStyle(function (style) { style.align = style.align === "left" ? "" : "left"; });
      if (cmd === "align-center") applyStyle(function (style) { style.align = style.align === "center" ? "" : "center"; });
      if (cmd === "align-right") applyStyle(function (style) { style.align = style.align === "right" ? "" : "right"; });
    });
  });

  document.getElementById("download").addEventListener("click", downloadCsv);
  document.getElementById("clear-sheet").addEventListener("click", function () {
    if (!Object.keys(state.cells).length) return;
    if (!window.confirm("Clear every cell in this spreadsheet?")) return;
    pushUndo();
    state.cells = {};
    save();
    render();
  });

  docTitle.addEventListener("input", save);
  gridWrap.addEventListener("scroll", function () {
    if (state.editing) positionEditor();
  });

  window.addEventListener("resize", function () {
    if (state.editing) positionEditor();
  });

  buildGrid();
  load();
  render();
  updateToolbar();
  statusMeta.textContent = COLS + " × " + ROWS;
})();
