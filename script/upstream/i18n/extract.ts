/**
 * TUI i18n key extractor.
 *
 * Collects every t("...") key used in packages/tui/src and reports which keys
 * are missing from each locale dictionary. Also flags display-position string
 * literals that are not yet wrapped in t() so coverage gaps are visible.
 *
 * Usage:
 *   bun script/upstream/i18n/extract.ts [--dir packages/tui/src] [--json out.json]
 */
import { Project, SyntaxKind, Node } from "ts-morph"
import path from "node:path"
import fs from "node:fs"

const DISPLAY_PROPS = new Set([
  "title",
  "description",
  "label",
  "message",
  "placeholder",
  "hint",
  "footer",
  "subtitle",
  "header",
  "busyText",
  "text",
  "question",
])

const LOCALES = ["zh", "zht"]

function parseArgs() {
  const args = process.argv.slice(2)
  const dirs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1] !== undefined) dirs.push(path.resolve(args[i + 1]))
  }
  if (dirs.length === 0) dirs.push(path.resolve("packages/tui/src"))
  const jsonIdx = args.indexOf("--json")
  const json = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined
  return { dirs, json }
}

function loadDict(locale: string): Set<string> {
  const file = path.resolve("packages/tui/src/kilocode/i18n/dict", `${locale}.ts`)
  if (!fs.existsSync(file)) return new Set()
  const text = fs.readFileSync(file, "utf8")
  const keys = new Set<string>()
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)":/g)) keys.add(match[1].replace(/\\"/g, '"'))
  return keys
}

const { dirs, json } = parseArgs()
const project = new Project({ skipAddingFilesFromTsConfig: true })

const files = dirs.flatMap((dir) =>
  fs
    .statSync(dir)
    .isFile()
    ? [dir]
    : fs
        .readdirSync(dir, { recursive: true })
        .map((name) => path.join(dir, String(name)))
        .filter((abs) => /\.(ts|tsx)$/.test(abs))
        .filter((abs) => !/(\.test\.|\.stories\.|\.d\.ts$|__tests__|node_modules|kilocode[\\/]i18n[\\/]dict)/.test(abs)),
)

const keys = new Set<string>()
const unwrapped: { file: string; snippet: string }[] = []

for (const abs of files) {
  const sf = project.addSourceFileAtPath(abs)
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/")

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "t") continue
    const arg = call.getArguments()[0]
    if (arg !== undefined && Node.isStringLiteral(arg)) keys.add(arg.getLiteralText())
  }

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (!DISPLAY_PROPS.has(attr.getNameNode().getText())) continue
    const init = attr.getInitializer()
    if (init !== undefined && Node.isStringLiteral(init)) {
      unwrapped.push({ file: rel, snippet: init.getText().slice(0, 90) })
    }
  }
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const nameNode = prop.getNameNode()
    if (!Node.isIdentifier(nameNode) && !Node.isStringLiteral(nameNode)) continue
    const name = nameNode.getText().replace(/^["']|["']$/g, "")
    if (!DISPLAY_PROPS.has(name)) continue
    const init = prop.getInitializer()
    if (init !== undefined && Node.isStringLiteral(init)) {
      unwrapped.push({ file: rel, snippet: init.getText().slice(0, 90) })
    }
  }
  for (const node of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = node.getText()
    if (raw === raw.trim() && /[a-zA-Z]/.test(raw) && raw.length >= 2) {
      unwrapped.push({ file: rel, snippet: raw.slice(0, 90) })
    }
  }
}

const report = {
  total: keys.size,
  keys: [...keys],
  missing: Object.fromEntries(LOCALES.map((locale) => [locale, [...keys].filter((key) => !loadDict(locale).has(key))])),
  unwrappedDisplayStrings: unwrapped,
}

console.log(`t() keys: ${keys.size}`)
for (const locale of LOCALES) {
  console.log(`missing in ${locale}: ${report.missing[locale].length}`)
}
console.log(`unwrapped display candidates: ${unwrapped.length}`)
if (json) fs.writeFileSync(json, JSON.stringify(report, null, 2))
