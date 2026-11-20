const describe = value => JSON.stringify(value);
const catalog = (db, pragma, name) => db.prepare(`SELECT * FROM pragma_${pragma}(?, 'main')`).all(name);

function schemaMismatch(object, detail) {
  throw new Error(`初始化路径结构不兼容：${object}，${detail}`);
}

function extraColumnIsWritable(column) {
  if (column.hidden || column.pk) return false;
  const value = column.dflt_value?.trim() ?? "NULL";
  if (/^NULL$/i.test(value)) return !column.notnull;
  // A literal default works even when application inserts omit this column.
  return /^(?:'(?:''|[^'])*'|X'(?:[\da-f]{2})*'|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|TRUE|FALSE)$/i.test(value);
}

function checkColumns(db, reference, table) {
  const actual = new Map(catalog(db, "table_xinfo", table).map(column => [column.name, column]));
  for (const { name, type, notnull, dflt_value, pk, hidden } of catalog(reference, "table_xinfo", table)) {
    const column = actual.get(name);
    const field = `${table}.${name}`;
    if (!column) schemaMismatch(field, "缺少基线字段");
    const legacyNameDefault = table === "MarketDataset" && name === "name" &&
      dflt_value === null && column.dflt_value === "'回放会话'";
    if (column.type.toUpperCase() !== type.toUpperCase() || column.notnull !== notnull ||
        (!legacyNameDefault && column.dflt_value !== dflt_value) || column.pk !== pk || column.hidden !== hidden) {
      schemaMismatch(field, "类型、空值约束、默认值或主键定义与基线不符");
    }
    actual.delete(name);
  }
  for (const [name, column] of actual) {
    if (!extraColumnIsWritable(column)) schemaMismatch(`${table}.${name}`, "额外字段可能阻止应用写入");
  }
}

function indexKeys(db, name) {
  return catalog(db, "index_xinfo", name)
    .filter(column => column.key)
    .map(({ name: column, desc, coll }) => ({ column, desc, coll }));
}

function checkIndexes(db, reference, table) {
  const actual = catalog(db, "index_list", table);
  for (const index of catalog(reference, "index_list", table)) {
    const match = actual.find(candidate => index.origin === "pk" ? candidate.origin === "pk" : index.name === candidate.name);
    if (!match) schemaMismatch(`${table}.${index.name}`, "缺少基线索引");
    if (match.unique !== index.unique || match.origin !== index.origin || match.partial !== index.partial ||
        describe(indexKeys(db, match.name)) !== describe(indexKeys(reference, index.name))) {
      schemaMismatch(`${table}.${index.name}`, "索引列顺序、排序规则或唯一约束与基线不符");
    }
    actual.splice(actual.indexOf(match), 1);
  }
  for (const index of actual) {
    if (index.unique || index.partial || indexKeys(db, index.name).some(key =>
      key.column === null || !["BINARY", "NOCASE", "RTRIM"].includes(key.coll.toUpperCase()))) {
      schemaMismatch(`${table}.${index.name}`, "额外索引可能阻止应用写入");
    }
  }
}

function foreignKeys(db, table) {
  const keys = new Map();
  for (const { id, ...column } of catalog(db, "foreign_key_list", table)) {
    if (!keys.has(id)) keys.set(id, []);
    keys.get(id).push(column);
  }
  return [...keys.values()].map(columns => columns.sort((a, b) => a.seq - b.seq));
}

function checkForeignKeys(db, reference, table) {
  const actual = foreignKeys(db, table).map(describe);
  for (const columns of foreignKeys(reference, table)) {
    const field = columns.map(column => column.from).join(", ");
    const index = actual.indexOf(describe(columns));
    if (index >= 0) {
      actual.splice(index, 1);
      continue;
    }
    // The v1.0 initializer added these fields without their Prisma foreign keys.
    if (table === "Trade" && columns.length === 1 && columns[0].table === "TradeOption" &&
        ["instrumentOptionId", "strategyOptionId"].includes(field)) continue;
    schemaMismatch(`${table}.${field}`, "缺少基线外键或外键定义不同");
  }
  if (actual.length) {
    const fields = JSON.parse(actual[0]).map(column => column.from).join(", ");
    schemaMismatch(`${table}.${fields}`, "发现额外外键或外键定义不同");
  }
}

function tableChecks(sql) {
  // SQLite provides PRAGMAs for the other required details, but not for CHECK expressions.
  const tokens = sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-z_][\w$]*|[^\s]/gi)
    .filter(token => !token.startsWith("--") && !token.startsWith("/*"))
    .map(token => /^[a-z_]/i.test(token) ? token.toUpperCase() : token);
  const checks = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "CHECK" || tokens[i + 1] !== "(") continue;
    const start = i + 1;
    let depth = 1;
    for (i = start + 1; depth > 0 && i < tokens.length; i++) {
      if (tokens[i] === "(") depth++;
      if (tokens[i] === ")") depth--;
    }
    checks.push(describe(tokens.slice(start, i)));
    i--;
  }
  // These clauses can change writes or lookups without changing the column PRAGMAs.
  const other = tokens.filter((token, i) => ["COLLATE", "AUTOINCREMENT", "DEFERRABLE"].includes(token) ||
    (token === "CONFLICT" && tokens[i - 1] === "ON"));
  return { checks: checks.sort(), other };
}

export function checkBaselineStructure(db, reference) {
  const objects = "SELECT type, name, tbl_name, sql FROM main.sqlite_master WHERE type IN ('table', 'trigger', 'view')";
  const actual = db.prepare(objects).all();
  const tables = new Map(actual.filter(object => object.type === "table").map(object => [object.name, object]));
  const required = reference.prepare(objects).all().filter(object => !object.name.startsWith("sqlite_"));
  for (const { name, sql, type } of required) {
    if (type !== "table") schemaMismatch(name, "基线含有需要定义核验规则的对象");
    const table = tables.get(name);
    if (!table) schemaMismatch(name, "缺少基线表");
    const definition = connection => connection.prepare("SELECT type, wr, strict FROM pragma_table_list WHERE schema='main' AND name=?").get(name);
    if (describe(definition(db)) !== describe(definition(reference))) schemaMismatch(name, "表类型与基线不同");
    checkColumns(db, reference, name);
    checkIndexes(db, reference, name);
    checkForeignKeys(db, reference, name);
    if (describe(tableChecks(sql)) !== describe(tableChecks(table.sql))) schemaMismatch(name, "CHECK 或其他表约束与基线不同");
    const trigger = actual.find(object => object.type === "trigger" && object.tbl_name === name);
    if (trigger) schemaMismatch(`${name}.${trigger.name}`, "额外触发器可能改变应用写入");
    tables.delete(name);
  }
  const requiredTables = new Set(required.map(object => object.name.toLowerCase()));
  for (const name of tables.keys()) {
    if (foreignKeys(db, name).some(columns => requiredTables.has(columns[0].table.toLowerCase()))) {
      schemaMismatch(name, "额外表的外键可能影响基线表写入");
    }
  }
}
