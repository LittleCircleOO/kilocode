/**
 * TUI i18n string wrapper.
 *
 * Rewrites user-visible string literals in packages/tui/src into t("...")
 * calls from @tui/kilocode/i18n. English source text doubles as the dictionary
 * key: when no translation exists, t() returns the key unchanged, so wrapping
 * is semantically safe everywhere it is applied.
 *
 * The transform is deterministic and idempotent. It emits the same output for
 * the same input, which lets it run both on the Kilo branch (initial
 * application) and on pristine upstream snapshots pre-merge: both sides of a
 * merge produce identical wrapped lines, so upstream merges do not conflict on
 * string wrapping. Each wrap carries an inline kilocode_change marker comment
 * so the annotation check and the upstream merge tooling can attribute the
 * change to Kilo.
 *
 * Usage:
 *   bun script/upstream/i18n/wrap.ts [--dir packages/tui/src] [--dry] [--json report.json]
 */
import { Project, SyntaxKind, Node, type SourceFile, type Node as NodeRef } from "ts-morph"
import path from "node:path"
import fs from "node:fs"

const DISPLAY_PROPS = new Set([
  "title",
  "description",
  "desc",
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

const IMPORT_MARKER = "// kilocode_change"
const WRAP_MARKER = "/* kilocode_change */"
const IMPORT_PATH = "@tui/kilocode/i18n"

type Skipped = { file: string; reason: string; snippet: string }

function parseArgs() {
  const args = process.argv.slice(2)
  const dry = args.includes("--dry")
  const dirs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1] !== undefined) dirs.push(path.resolve(args[i + 1]))
  }
  if (dirs.length === 0) dirs.push(path.resolve("packages/tui/src"))
  const jsonIdx = args.indexOf("--json")
  const json = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined
  return { dry, dirs, json }
}

function isKilocodePath(file: string) {
  return file.includes("kilocode")
}

function qualifies(text: string) {
  if (text.length < 2 || text.length > 160) return false
  if (/[{}`\\\n]/.test(text)) return false
  if (!/[a-zA-Z]/.test(text)) return false
  if (/^[a-z+]+:\/\//i.test(text)) return false
  if (/^(\.\/|\.\.\/|\/|~\/)/.test(text)) return false
  return true
}

function insideImport(node: NodeRef) {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined
}

function alreadyWrapped(node: NodeRef) {
  const parent = node.getParent()
  if (parent === undefined) return false
  if (parent.getKind() !== SyntaxKind.CallExpression) return false
  const expression = parent.asKind(SyntaxKind.CallExpression)!.getExpression()
  return expression.getText() === "t"
}

function quote(text: string) {
  return '"' + text.replace(/"/g, '\\"') + '"'
}

function wrapExpression(text: string, marker: boolean) {
  return `t(${quote(text)})${marker ? ` ${WRAP_MARKER}` : ""}`
}

// Collects the StringLiteral leaves of a conditional expression, recursing
// into nested conditionals: cond ? (x ? "A" : "B") : "C".
function conditionalStringLeaves(node: NodeRef): (NodeRef & { getLiteralText(): string })[] {
  const out: (NodeRef & { getLiteralText(): string })[] = []
  const visit = (current: NodeRef) => {
    if (Node.isConditionalExpression(current)) {
      visit(current.getWhenTrue())
      visit(current.getWhenFalse())
      return
    }
    if (Node.isStringLiteral(current)) out.push(current)
  }
  visit(node)
  return out
}

// Collects StringLiteral leaves of a concatenation chain "a" + x + "b".
function concatStringLeaves(node: NodeRef): (NodeRef & { getLiteralText(): string })[] {
  const out: (NodeRef & { getLiteralText(): string })[] = []
  const visit = (current: NodeRef) => {
    if (Node.isBinaryExpression(current) && current.getOperatorToken().getText() === "+") {
      visit(current.getLeft())
      visit(current.getRight())
      return
    }
    if (Node.isStringLiteral(current)) out.push(current)
  }
  visit(node)
  return out
}

// Converts a template expression like `Slot ${i + 1}` into
// t("Slot {{p0}}", { p0: i + 1 }). Simple identifiers and property accesses
// keep their name as the placeholder; anything else gets a positional pN name.
// Placeholders use double braces to match the t() interpolation syntax.
function tryWrapTemplate(node: NodeRef, marker: boolean, skip: (node: NodeRef, reason: string) => void): boolean {
  const template = node as unknown as {
    getHead(): { getLiteralText(): string }
    getTemplateSpans(): Array<{ getExpression(): NodeRef; getLiteral(): { getLiteralText(): string } }>
  }
  const parts: string[] = [template.getHead().getLiteralText()]
  const params: string[] = []
  const used = new Set<string>()
  for (const span of template.getTemplateSpans()) {
    const expr = span.getExpression()
    let name = ""
    if (Node.isIdentifier(expr)) name = expr.getText()
    else if (Node.isPropertyAccessExpression(expr)) name = expr.getName()
    if (!/^\w+$/.test(name) || used.has(name)) name = `p${used.size}`
    used.add(name)
    params.push(`${name}: ${expr.getText()}`)
    parts.push(`{{${name}}}`)
    parts.push(span.getLiteral().getLiteralText())
  }
  const text = parts.join("")
  if (text.length < 2 || text.length > 160 || !/[a-zA-Z]/.test(text) || /[{}\\]/.test(text.replace(/\{\{\w+\}\}/g, ""))) {
    skip(node, "template-quality-filter")
    return false
  }
  const paramText = params.length > 0 ? `, { ${params.join(", ")} }` : ""
  node.replaceWithText(`t(${quote(text)}${paramText})${marker ? ` ${WRAP_MARKER}` : ""}`)
  return true
}

function collectFile(file: SourceFile, skipped: Skipped[]) {
  const relPath = path.relative(process.cwd(), String(file.getFilePath())).replace(/\\/g, "/")
  const marker = !isKilocodePath(relPath)
  let wrapped = 0

  const skip = (node: NodeRef, reason: string) => {
    skipped.push({ file: relPath, reason, snippet: node.getText().slice(0, 90) })
  }

  const tryWrapString = (node: NodeRef & { getLiteralText(): string }, braces = false) => {
    if (alreadyWrapped(node)) return false
    if (insideImport(node)) return false
    const text = node.getLiteralText()
    if (!qualifies(text)) {
      skip(node, "quality-filter")
      return false
    }
    const replacement = wrapExpression(text, marker)
    node.replaceWithText(braces ? `{${replacement}}` : replacement)
    wrapped++
    return true
  }

  // <text>Press Enter</text> becomes <text>{t("Press Enter")}</text>
  for (const node of file.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = node.getText()
    if (raw !== raw.trim() || raw.includes("\n")) continue
    if (!qualifies(raw)) continue
    node.replaceWithText(`{${wrapExpression(raw, marker)}}`)
    wrapped++
  }

  // title="Themes" becomes title={t("Themes")}; title={"Themes"} likewise
  for (const attr of file.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (!DISPLAY_PROPS.has(attr.getNameNode().getText())) continue
    const init = attr.getInitializer()
    if (init === undefined) continue
    if (Node.isStringLiteral(init)) {
      tryWrapString(init, true)
    } else if (Node.isJsxExpression(init)) {
      const expr = init.getExpression()
      if (expr !== undefined && Node.isStringLiteral(expr)) tryWrapString(expr)
      else if (expr !== undefined && Node.isConditionalExpression(expr)) {
        for (const leaf of conditionalStringLeaves(expr)) tryWrapString(leaf)
      }
    }
  }

  // { title: "Themes" } object properties and class property defaults. Also
  // handles ternary initializers (title: cond ? "A" : "B") by wrapping every
  // string branch, and simple template literals (title: `Slot ${i}`) by
  // converting them to t("Slot {i}", { i }) parameter form.
  for (const prop of [
    ...file.getDescendantsOfKind(SyntaxKind.PropertyAssignment),
    ...file.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
  ]) {
    const nameNode = prop.getNameNode()
    if (!Node.isIdentifier(nameNode) && !Node.isStringLiteral(nameNode)) continue
    const name = nameNode.getText().replace(/^["']|["']$/g, "")
    if (!DISPLAY_PROPS.has(name)) continue
    const init = prop.getInitializer()
    if (init === undefined) continue
    if (Node.isStringLiteral(init)) {
      tryWrapString(init)
      continue
    }
    if (Node.isConditionalExpression(init)) {
      for (const branch of conditionalStringLeaves(init)) tryWrapString(branch)
      continue
    }
    if (Node.isNoSubstitutionTemplateLiteral(init)) {
      const text = init.getLiteralText()
      if (qualifies(text)) {
        init.replaceWithText(wrapExpression(text, marker))
        wrapped++
      } else {
        skip(init, "quality-filter")
      }
      continue
    }
    if (Node.isTemplateExpression(init)) {
      if (tryWrapTemplate(init, marker, skip)) wrapped++
      continue
    }
    if (Node.isBinaryExpression(init)) {
      for (const leaf of concatStringLeaves(init)) tryWrapString(leaf)
    }
  }

  // get title() { return cond ? "A" : "B" } display-named accessors
  for (const getter of [
    ...file.getDescendantsOfKind(SyntaxKind.GetAccessor),
    ...file.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ]) {
    const name = getter.getName()
    if (!DISPLAY_PROPS.has(name)) continue
    for (const conditional of [...getter.getDescendantsOfKind(SyntaxKind.ConditionalExpression)]) {
      for (const leaf of conditionalStringLeaves(conditional)) tryWrapString(leaf)
    }
    for (const returned of getter.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const expr = returned.getExpression()
      if (expr !== undefined && Node.isStringLiteral(expr)) tryWrapString(expr)
    }
  }

  if (wrapped > 0) {
    const imports = file.getImportDeclarations()
    const hasT = imports.some((i) => i.getModuleSpecifierValue() === IMPORT_PATH)
    if (!hasT) {
      const statement = `import { t } from ${quote(IMPORT_PATH)}${marker ? ` ${IMPORT_MARKER}` : ""}`
      if (imports.length > 0) {
        // Insert after the last import's full line so a trailing comment on
        // that line is not displaced onto the new import statement.
        const last = imports.at(-1)!
        const eol = file.getFullText().indexOf("\n", last.getEnd())
        file.insertText(eol >= 0 ? eol : last.getEnd(), "\n" + statement)
      } else {
        file.insertText(0, statement + "\n\n")
      }
    }
  }
  return wrapped
}

const { dry, dirs, json } = parseArgs()
const project = new Project({ skipAddingFilesFromTsConfig: true })

const files = dirs.flatMap((dir) =>
  fs.statSync(dir).isFile()
    ? [dir]
    : fs
        .readdirSync(dir, { recursive: true })
        .map((name) => path.join(dir, String(name)))
        .filter((abs) => /\.(ts|tsx)$/.test(abs))
        .filter((abs) => !/(\.test\.|\.stories\.|\.d\.ts$|__tests__|node_modules|kilocode[\\/]i18n[\\/]dict)/.test(abs)),
)

const skipped: Skipped[] = []
const perFile: Record<string, number> = {}
for (const abs of files) {
  const sf = project.addSourceFileAtPath(abs)
  const count = collectFile(sf, skipped)
  if (count > 0) perFile[path.relative(process.cwd(), abs).replace(/\\/g, "/")] = count
  if (!dry) void sf.save()
}

const total = Object.values(perFile).reduce((a, b) => a + b, 0)
console.log(`${dry ? "[dry] " : ""}wrapped ${total} strings across ${Object.keys(perFile).length} files`)
if (json) {
  fs.writeFileSync(json, JSON.stringify({ total, perFile, skipped }, null, 2))
  console.log(`report written to ${json}`)
}
if (skipped.length > 0) console.log(`${skipped.length} candidates skipped (see report)`)
