import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
const CURRENT = "当前规范";
const INDEX = "docs/README.md";
const rootDocuments = new Set(["AGENTS.md", "README.md", INDEX]);
const pnpmBuiltins = new Set(["install", "i", "add", "remove", "update", "exec", "dlx", "run", "list", "why", "store", "config", "help"]);
const shellLanguages = new Set(["", "bash", "sh", "shell", "powershell", "ps1", "cmd", "bat", "text", "console"]);

function visit(node, callback) {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function plainText(node) {
  if (node.type === "html") return "";
  return node.value ?? node.alt ?? (node.children ?? []).map(plainText).join("");
}

function headingSlug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
}

function parseDocument(file, source) {
  const tree = parser.parse(source.replace(/^\uFEFF/, ""));
  const nodes = [];
  visit(tree, node => nodes.push(node));
  const definitions = new Map(nodes.filter(n => n.type === "definition").map(n => [n.identifier, n.url]));
  const links = nodes.flatMap(node => {
    if (node.type === "link" || node.type === "image") return [{ url: node.url, line: node.position.start.line }];
    if (node.type === "linkReference" || node.type === "imageReference") {
      return [{ url: definitions.get(node.identifier), line: node.position.start.line }];
    }
    return [];
  });
  const headings = nodes.filter(n => n.type === "heading");
  const anchors = new Set();
  const generated = new Set();
  for (const heading of headings) {
    const base = headingSlug(plainText(heading));
    let slug = base;
    for (let suffix = 1; generated.has(slug); suffix++) slug = `${base}-${suffix}`;
    generated.add(slug);
    anchors.add(slug);
  }
  // Code examples are separate AST nodes, so sample HTML anchors never become real anchors.
  for (const node of nodes.filter(n => n.type === "html")) {
    const html = node.value.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of html.matchAll(/<[\w-]+\b[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/g)) anchors.add(match[1]);
    for (const match of html.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/g)) links.push({ url: match[1], line: node.position.start.line });
  }
  const top = source.replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 8);
  const status = top.join("\n").match(/^> 文档状态：(当前规范|设计与计划|历史记录)。适用范围：\S.*$/m)?.[1];
  const ownerLine = top.findIndex(line => line.startsWith("> 当前规范：")) + 1;
  const commands = nodes.filter(n => n.type === "inlineCode" || (n.type === "code" && shellLanguages.has((n.lang ?? "").toLowerCase())));
  return { file, status, ownerLine, links, headings, anchors, commands };
}

function localTarget(from, url) {
  if (/^(?:file:|[a-z]:[\\/])/i.test(url)) throw new Error("本地链接须使用仓库相对路径");
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null;
  const hashAt = url.indexOf("#");
  const pathname = (hashAt < 0 ? url : url.slice(0, hashAt)).split("?")[0];
  const fragment = hashAt < 0 ? "" : decodeURIComponent(url.slice(hashAt + 1));
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\\") || decoded.startsWith("/")) throw new Error("本地链接须使用相对路径及正斜杠");
  const file = decoded ? posix.normalize(posix.join(posix.dirname(from), decoded)) : from;
  if (file === ".." || file.startsWith("../")) throw new Error("链接超出仓库范围");
  return { file: file.replace(/\/$/, ""), fragment };
}

function nodeEntries(command) {
  // Tokenize static paths only; never interpret shell expressions or run the command.
  const words = command.match(/\r?\n|[;&|]+|"[^"\r\n]*"|'[^'\r\n]*'|[^\s;&|]+/g)?.map(word => word.replace(/^["']|["']$/g, "")) ?? [];
  const entries = [];
  for (let i = 0; i < words.length; i++) {
    if (!/^node(?:\.exe)?$/.test(words[i])) continue;
    for (let j = i + 1; j < words.length; j++) {
      if (/^[\r\n;&|]+$/.test(words[j])) break;
      if (["-e", "--eval", "-p", "--print"].includes(words[j])) break;
      if (["--import", "--require", "-r", "--loader"].includes(words[j])) { j++; continue; }
      if (words[j].startsWith("-")) continue;
      if (!words[j].startsWith("node_modules/") && !/[$<>]/.test(words[j])) entries.push(words[j]);
      break;
    }
  }
  return entries;
}

/** Pure checks; pathExists must only inspect a repository-relative path. */
export function inspectDocumentation({ documents, manifest, pathExists }) {
  const parsed = new Map([...documents].map(([file, source]) => [file, parseDocument(file, source)]));
  const errors = [];
  const stats = { documents: parsed.size, localLinks: 0, anchors: 0, commands: 0 };
  const report = (file, line, code, message) => errors.push({ file, line, code, message });
  const resolveLink = (file, link) => {
    if (link.url === undefined) { report(file, link.line, "REFERENCE", "引用式链接未定义"); return null; }
    try { return localTarget(file, link.url); }
    catch (error) { report(file, link.line, "LINK_PATH", `${link.url}：${error.message}`); return null; }
  };

  for (const doc of parsed.values()) {
    if (!doc.status) report(doc.file, 3, "STATUS", "顶部缺少有效的文档状态或适用范围");
    for (const link of doc.links) {
      const target = resolveLink(doc.file, link);
      if (!target) continue;
      stats.localLinks++;
      if (!pathExists(target.file)) report(doc.file, link.line, "LINK_FILE", `目标不存在或大小写不符：${link.url}`);
      else if (target.fragment && target.file.endsWith(".md")) {
        stats.anchors++;
        const targetDocument = parsed.get(target.file) ?? (documents.has(target.file) ? parseDocument(target.file, documents.get(target.file)) : null);
        if (!targetDocument) report(doc.file, link.line, "ANCHOR_SCOPE", `Markdown 目标未纳入检查范围：${target.file}`);
        else if (!targetDocument.anchors.has(target.fragment)) report(doc.file, link.line, "LINK_ANCHOR", `章节或锚点不存在：${link.url}`);
      }
    }
    if (doc.status && doc.status !== CURRENT) {
      const owners = doc.links.filter(link => link.line === doc.ownerLine);
      if (!owners.length) report(doc.file, 4, "OWNER", "历史/计划材料须在顶部链接当前规范");
      for (const link of owners) {
        const target = resolveLink(doc.file, link);
        if (!target || parsed.get(target.file)?.status !== CURRENT) report(doc.file, link.line, "OWNER", `当前依据不是仓库内的当前规范：${link.url}`);
      }
    }
  }

  const index = parsed.get(INDEX);
  if (index) {
    const current = index.headings.find(h => h.depth === 2 && plainText(h) === "当前入口");
    const history = index.headings.find(h => h.depth === 2 && plainText(h) === "方案与历史材料");
    if (!current || !history) report(INDEX, 1, "INDEX_SECTION", "索引须保留当前入口、方案与历史材料两个分区");
    else {
      const end = index.headings.find(h => h.depth <= 2 && h.position.start.line > current.position.start.line)?.position.start.line ?? Infinity;
      const currentLinks = index.links.filter(link => link.line > current.position.start.line && link.line < end);
      const currentFiles = new Set(currentLinks.map(link => resolveLink(INDEX, link)?.file));
      const historyFiles = new Set(index.links.filter(link => link.line > history.position.start.line).map(link => resolveLink(INDEX, link)?.file));
      for (const file of currentFiles) if (parsed.has(file) && parsed.get(file).status !== CURRENT) report(INDEX, current.position.start.line, "INDEX_CURRENT", `当前入口混入非当前材料：${file}`);
      for (const doc of parsed.values()) {
        if (rootDocuments.has(doc.file)) continue;
        const expected = doc.status === CURRENT ? currentFiles : historyFiles;
        if (!expected.has(doc.file)) report(doc.file, 1, "INDEX_MISSING", "未列入文档索引的对应分区");
      }
    }
  } else report(INDEX, 1, "INDEX_MISSING", "缺少文档索引");

  function checkNodeEntries(file, line, command) {
    for (const entry of nodeEntries(command)) {
      stats.commands++;
      const target = posix.normalize(entry);
      if (target.startsWith("../") || target.startsWith("/") || target.includes("\\") || !pathExists(target)) report(file, line, "NODE_ENTRY", `Node 静态入口不存在或不是仓库相对路径：${entry}`);
    }
  }
  for (const doc of parsed.values()) {
    if (doc.status !== CURRENT) continue;
    for (const node of doc.commands) {
      checkNodeEntries(doc.file, node.position.start.line, node.value);
      for (const match of node.value.matchAll(/(?:^|[\s;&|])(?:corepack\s+)?pnpm\s+(?:(run)\s+)?([a-z][\w:-]*)/g)) {
        stats.commands++;
        const [, run, name] = match;
        const script = Object.hasOwn(manifest.scripts ?? {}, name);
        const dependency = Object.hasOwn(manifest.dependencies ?? {}, name) || Object.hasOwn(manifest.devDependencies ?? {}, name);
        if (!script && (run || (!pnpmBuiltins.has(name) && !dependency))) report(doc.file, node.position.start.line, "PNPM_ENTRY", `package.json 中没有对应命令：pnpm ${run ? "run " : ""}${name}`);
      }
    }
  }
  for (const command of Object.values(manifest.scripts ?? {})) checkNodeEntries("package.json", 1, command);
  return { errors, stats };
}

export function checkRepository(root) {
  const files = ["AGENTS.md", "README.md"];
  function collect(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && file.endsWith(".md")) files.push(file);
    }
  }
  collect("docs");
  const documents = new Map(files.map(file => [file, readFileSync(join(root, file), "utf8")]));
  const directories = new Map();
  const pathExists = file => {
    if (file === ".") return true;
    let directory = root;
    for (const part of file.split("/")) {
      if (!directories.has(directory)) {
        try { directories.set(directory, readdirSync(directory)); }
        catch { return false; }
      }
      if (!directories.get(directory).includes(part)) return false;
      directory = join(directory, part);
    }
    return true;
  };
  return inspectDocumentation({ documents, manifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")), pathExists });
}

const filename = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === filename) {
  const root = resolve(dirname(filename), "../..");
  try {
    const { errors, stats } = checkRepository(root);
    for (const error of errors) console.error(`${error.file}:${error.line} [${error.code}] ${error.message}`);
    if (errors.length) { console.error(`文档检查失败：${errors.length} 项。`); process.exitCode = 1; }
    else console.log(`文档检查通过：${stats.documents} 份文档，${stats.localLinks} 处本地链接，${stats.anchors} 处锚点引用，${stats.commands} 处命令入口。`);
  } catch (error) {
    console.error(`文档检查无法完成：${error.message}`);
    process.exitCode = 1;
  }
}
