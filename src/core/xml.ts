import { SaxesParser } from 'saxes';
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XNode[];
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
}
export const escapeXml = (v: unknown) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
export const element = (name: string, body: unknown) => `<${name}>${body}</${name}>`;
export const textElement = (name: string, value: unknown) => element(name, escapeXml(value));
export function parseXml(xml: string): XNode {
  if (xml.length > 180_000_000) throw new Error('XML 超过 180 MB，请选择较小的资源文件');
  const root: XNode = {
    name: '#document',
    attrs: {},
    text: '',
    children: [],
    start: 0,
    openEnd: 0,
    closeStart: xml.length,
    end: xml.length,
    selfClosing: false,
  };
  const stack = [root];
  let start = 0;
  const parser = new SaxesParser({ position: true, xmlns: false });
  parser.on('doctype', () => {
    throw new Error('不支持含 DTD／外部实体的 XML');
  });
  parser.on('opentagstart', () => {
    start = xml.lastIndexOf('<', parser.position - 1);
  });
  parser.on('opentag', (tag) => {
    const n: XNode = {
      name: tag.name,
      attrs: tag.attributes as Record<string, string>,
      text: '',
      children: [],
      start,
      openEnd: parser.position,
      closeStart: parser.position,
      end: parser.position,
      selfClosing: tag.isSelfClosing,
    };
    stack[stack.length - 1].children.push(n);
    stack.push(n);
  });
  parser.on('text', (t) => {
    stack[stack.length - 1].text += t;
  });
  parser.on('cdata', (t) => {
    stack[stack.length - 1].text += t;
  });
  parser.on('closetag', () => {
    const n = stack.pop()!;
    n.end = parser.position;
    n.closeStart = n.selfClosing ? n.openEnd - 2 : xml.lastIndexOf('</', parser.position - 1);
  });
  parser.on('error', (e) => {
    throw new Error(`XML 格式错误：${e.message}`);
  });
  parser.write(xml).close();
  return root;
}
export function children(n: XNode | undefined, name: string): XNode[] {
  return n?.children.filter((c) => c.name === name) ?? [];
}
export function at(n: XNode | undefined, path: string): XNode | undefined {
  return path
    .split('/')
    .filter(Boolean)
    .reduce<XNode | undefined>((p, k) => p?.children.find((c) => c.name === k), n);
}
export const value = (n: XNode | undefined, path = '') =>
  (path ? at(n, path) : n)?.text.trim() ?? '';
export const numberAt = (n: XNode | undefined, path: string, fallback = 0) => {
  const t = value(n, path);
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : fallback;
};
export function descendants(n: XNode, name: string): XNode[] {
  const out: XNode[] = [];
  const walk = (p: XNode) => {
    for (const c of p.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}
export const rawNode = (xml: string, n: XNode) => xml.slice(n.start, n.end);
interface Trie {
  replacement?: string | null;
  children: Map<string, Trie>;
}
/** Source-span edits keep every untouched sibling, attribute and comment byte-for-byte. */
export function patchXml(xml: string, updates: Record<string, string | null>): string {
  const doc = parseXml(xml);
  const top: Trie = { children: new Map() };
  for (const [path, replacement] of Object.entries(updates)) {
    let t = top;
    for (const part of path.split('/').filter(Boolean)) {
      if (!t.children.has(part)) t.children.set(part, { children: new Map() });
      t = t.children.get(part)!;
    }
    t.replacement = replacement;
  }
  const create = (name: string, t: Trie): string =>
    t.replacement === null
      ? ''
      : element(name, t.replacement ?? [...t.children].map(([k, v]) => create(k, v)).join(''));
  const edit = (n: XNode, t: Trie): string => {
    if (t.replacement === null) return '';
    if (t.replacement !== undefined) return element(n.name, t.replacement);
    const edits: { start: number; end: number; text: string }[] = [];
    for (const [name, branch] of t.children) {
      const matches = children(n, name);
      if (matches.length > 1) throw new Error(`无法安全编辑重复节点 ${name}`);
      const child = matches[0];
      if (child) edits.push({ start: child.start, end: child.end, text: edit(child, branch) });
      else {
        const text = create(name, branch);
        if (text) edits.push({ start: n.closeStart, end: n.closeStart, text });
      }
    }
    if (n.selfClosing) {
      let content = '';
      for (const [name, branch] of t.children) content += create(name, branch);
      return element(n.name, content);
    }
    let result = rawNode(xml, n);
    for (const e of edits.sort((a, b) => b.start - a.start))
      result = result.slice(0, e.start - n.start) + e.text + result.slice(e.end - n.start);
    return result;
  };
  const edits: { start: number; end: number; text: string }[] = [];
  for (const [name, t] of top.children) {
    const n = children(doc, name)[0];
    if (!n) throw new Error(`缺少 XML 根节点 ${name}`);
    edits.push({ start: n.start, end: n.end, text: edit(n, t) });
  }
  for (const e of edits.sort((a, b) => b.start - a.start))
    xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  return xml;
}
