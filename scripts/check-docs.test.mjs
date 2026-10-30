import { describe, expect, it } from "vitest";
import { inspectDocumentation, checkRepository } from "./check-docs.mjs";
import { fileURLToPath } from "node:url";

const current = body => `# 文档\n\n> 文档状态：当前规范。适用范围：测试。\n\n${body}`;
const history = body => `# 旧记录\n\n> 文档状态：历史记录。适用范围：旧版本。\n> 当前规范：[规范](spec.md)。\n\n${body}`;
function fixture() {
  const documents = new Map([
    ["AGENTS.md", current("")], ["README.md", current("")],
    ["docs/spec.md", current("## 规则\n")], ["docs/history.md", history("")],
    ["docs/README.md", current("## 当前入口\n\n[规范](spec.md)\n\n## 方案与历史材料\n\n[历史](history.md)\n")],
  ]);
  const manifest = { scripts: { "docs:check": "node scripts/check-docs.mjs", dev: "next dev" }, devDependencies: { prisma: "6.19.3" } };
  const extraFiles = new Set(["scripts/check-docs.mjs", "public/a (b).png"]);
  return { documents, manifest, extraFiles, run: () => inspectDocumentation({ documents, manifest, pathExists: file => documents.has(file) || extraFiles.has(file) }) };
}
const codes = result => result.errors.map(error => error.code);

describe("documentation maintenance checks", () => {
  it("checks the real repository without running documented commands", () => {
    const result = checkRepository(fileURLToPath(new URL("..", import.meta.url)));
    expect(result.errors).toEqual([]);
    expect(result.stats.documents).toBeGreaterThan(0);
    expect(result.stats.commands).toBeGreaterThan(0);
  });

  it("parses reference links, nested destinations, images and encoded fragments", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("## 中文 **标题**\n\n[引用][rule]\n\n[rule]: #中文-标题\n\n[编码](#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98)\n\n![图片](<../public/a (b).png>)\n\n[空链接]()"));
    expect(f.run().errors).toEqual([]);
  });

  it("supports setext headings, inline code and colliding heading suffixes", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("规则 `A`\n---\n\n# Same\n\n# Same\n\n# Same-1\n\n[规则](#规则-a) [第二](#same-1) [第三](#same-1-1)"));
    expect(f.run().errors).toEqual([]);
  });

  it("rejects missing files, anchors and incorrectly cased paths with source locations", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("[丢失](missing.md)\n\n[锚点](#missing)\n\n[大小写](History.md)"));
    const result = f.run();
    expect(codes(result)).toEqual(["LINK_FILE", "LINK_ANCHOR", "LINK_FILE"]);
    expect(result.errors[0]).toMatchObject({ file: "docs/spec.md", line: 5 });
  });

  it("ignores links and headings inside fenced/inline examples and external URLs", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("```md\n# 假标题\n[示例](missing.md)\n<a id=\"fake\"></a>\n```\n\n`[示例](missing.md)`\n\n[外部](https://example.invalid/no-network) [邮件](mailto:a@example.invalid)"));
    expect(f.run().errors).toEqual([]);
  });

  it("checks actual HTML anchors and links but excludes commented anchors", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current('<a id="old-anchor"></a>\n\n[旧入口](#old-anchor)\n\n<a href="history.md">历史</a>\n\n<!-- <a id="fake"></a> -->\n\n[无效](#fake)'));
    expect(codes(f.run())).toEqual(["LINK_ANCHOR"]);
  });

  it("rejects escaped repository paths and malformed percent encoding", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("[越界](../../outside.md) [编码](bad%ZZ.md)"));
    expect(codes(f.run())).toEqual(["LINK_PATH", "LINK_PATH"]);
  });

  it("rejects machine-specific file links and non-local current owners", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("[机器路径](D:/old/location.md) [文件地址](file:///D:/old/location.md)"));
    f.documents.set("docs/history.md", history("").replace("(spec.md)", "(https://example.invalid/current)"));
    expect(codes(f.run())).toEqual(["LINK_PATH", "LINK_PATH", "OWNER"]);
  });

  it("requires metadata, indexed current documents and current owners for history", () => {
    const f = fixture();
    f.documents.set("docs/new.md", current(""));
    f.documents.set("docs/spec.md", "# 没有状态\n");
    f.documents.set("docs/history.md", history("").replace("(spec.md)", "(history.md)"));
    expect(codes(f.run())).toEqual(expect.arrayContaining(["STATUS", "OWNER", "INDEX_CURRENT", "INDEX_MISSING"]));
  });

  it("rejects history in the current index and missing index sections", () => {
    const f = fixture();
    const original = f.documents.get("docs/README.md");
    f.documents.set("docs/README.md", original.replace("[规范](spec.md)", "[规范](spec.md) [旧记录](history.md)"));
    expect(codes(f.run())).toContain("INDEX_CURRENT");
    f.documents.set("docs/README.md", original.replace("## 当前入口", "## 旧标题"));
    expect(codes(f.run())).toContain("INDEX_SECTION");
  });

  it("checks current pnpm scripts and dependencies while leaving old commands historical", () => {
    const f = fixture();
    f.documents.set("docs/spec.md", current("`corepack pnpm run gone`\n\n```powershell\ncorepack pnpm dev\ncorepack pnpm prisma generate\ncorepack pnpm install --frozen-lockfile\n```"));
    f.documents.set("docs/history.md", history("`pnpm run old-command`\n\n```sh\nnode old-entry.mjs\n```"));
    expect(codes(f.run())).toEqual(["PNPM_ENTRY"]);
  });

  it("checks static Node entry paths with flags and spaces, but not eval or dynamic paths", () => {
    const f = fixture();
    f.extraFiles.add("scripts/with space.mjs");
    f.documents.set("docs/spec.md", current("```sh\nnode --version\ncorepack pnpm dev\nnode --version && corepack pnpm dev\nnode --import tsx --max-old-space-size=1024 'scripts/with space.mjs'\nnode -e \"console.log('only-an-example')\"\nnode $SCRIPT\nnode scripts/missing\n```"));
    expect(codes(f.run())).toEqual(["NODE_ENTRY"]);
  });

  it("checks package script entry points even when no document mentions them", () => {
    const f = fixture();
    f.manifest.scripts.worker = "node --import tsx scripts/missing.ts";
    expect(codes(f.run())).toEqual(["NODE_ENTRY"]);
  });
});
