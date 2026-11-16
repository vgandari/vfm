/**
 * plugins/no-html.ts
 *
 * The vfm flavor of Markdown has no raw HTML. Anything the author writes that the parser reads as HTML
 * (`<sup>a</sup>`, `<div>…</div>`, `<br>`) is shown as the text it is, in document and slide mode alike,
 * instead of being passed to the browser. HTML comments (`<!-- … -->`) are the exception: they are
 * invisible, vfm's own slide directives are carried as comments, and authors use them for notes.
 *
 * Run this right after the parse-level plugins and before anything that adds HTML on purpose (the
 * citation and cross-reference plugins), so only the author's HTML is touched.
 */

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const COMMENT = /^\s*<!--[\s\S]*-->\s*$/;

/** Parents whose children are inline text, where an html node can simply become a text node. */
const PHRASING = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "linkReference", "tableCell", "highlight", "underline", "subSup"]);

const remarkNoHtml: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visit(tree, "html", (node: any, index, parent: any) => {
      if (COMMENT.test(node.value) || !parent || index === undefined) return;
      const text = { type: "text", value: node.value, position: node.position };
      parent.children[index] = PHRASING.has(parent.type) ? text : { type: "paragraph", children: [text], position: node.position };
    });
  };
};

export default remarkNoHtml;
