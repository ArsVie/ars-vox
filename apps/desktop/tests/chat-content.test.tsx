/**
 * Leaf D — chat content: MarkdownText rendering (bold, headings, lists,
 * code, links) and OptionCards / FollowUpChips tap behavior.
 *
 * SSR-only (vitest environment is node — no jsdom): markup assertions
 * use renderToStaticMarkup; tap behavior is exercised DOM-free by
 * calling the rendered button element's onClick prop directly.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FollowUpChips } from "../src/components/FollowUpChips";
import { MarkdownText } from "../src/components/MarkdownText";
import { OptionCards } from "../src/components/OptionCards";

/** Depth-first walk of a React element tree, collecting buttons. */
function collectButtons(node: ReactNode): ReactElement[] {
  const buttons: ReactElement[] = [];
  const walk = (current: ReactNode): void => {
    if (current === null || current === undefined) return;
    if (
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    )
      return;
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const element = current as ReactElement;
    if (element.type === "button") buttons.push(element);
    walk(element.props.children);
  };
  walk(node);
  return buttons;
}

/** Invoke a rendered button's onClick — a DOM-free tap simulation. */
function tap(button: ReactElement): void {
  (button.props.onClick as (() => void) | undefined)?.();
}

describe("MarkdownText", () => {
  it("renders **bold** as a styled strong element", () => {
    const html = renderToStaticMarkup(<MarkdownText text="Hola **amigo**" />);
    expect(html).toContain('<strong class="md-strong">amigo</strong>');
  });

  it("renders __bold__ the same way", () => {
    const html = renderToStaticMarkup(<MarkdownText text="Hola __amigo__" />);
    expect(html).toContain('<strong class="md-strong">amigo</strong>');
  });

  it("renders *italic* as a styled em element", () => {
    const html = renderToStaticMarkup(<MarkdownText text="Hola *amigo*" />);
    expect(html).toContain('<em class="md-em">amigo</em>');
  });

  it("renders ## and ### headings as styled h2/h3", () => {
    const h2 = renderToStaticMarkup(<MarkdownText text="## Título grande" />);
    expect(h2).toContain('<h2 class="md-heading">Título grande</h2>');
    const h3 = renderToStaticMarkup(<MarkdownText text="### Subtítulo" />);
    expect(h3).toContain('<h3 class="md-heading">Subtítulo</h3>');
  });

  it("renders unordered and ordered lists", () => {
    const ul = renderToStaticMarkup(<MarkdownText text={"- Uno\n- Dos"} />);
    expect(ul).toContain('<ul class="md-list">');
    expect(ul).toContain('<li class="md-list-item">Uno</li>');
    expect(ul).toContain('<li class="md-list-item">Dos</li>');
    const ol = renderToStaticMarkup(<MarkdownText text={"1. Primero\n2. Segundo"} />);
    expect(ol).toContain('<ol class="md-list">');
    expect(ol).toContain('<li class="md-list-item">Primero</li>');
    expect(ol).toContain('<li class="md-list-item">Segundo</li>');
  });

  it("renders inline code and fenced code blocks", () => {
    const inline = renderToStaticMarkup(<MarkdownText text="Usa `npm test`" />);
    expect(inline).toContain('<code class="md-code">npm test</code>');
    const fenced = renderToStaticMarkup(
      <MarkdownText text={"```\nconst a = 1;\n```"} />,
    );
    expect(fenced).toContain('<pre class="md-codeblock">');
    expect(fenced).toContain('<code class="md-code">const a = 1;</code>');
  });

  it("renders links with target=_blank and rel=noreferrer", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="[sitio](https://ejemplo.com)" />,
    );
    expect(html).toContain('<a class="md-link"');
    expect(html).toContain('href="https://ejemplo.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("never uses dangerouslySetInnerHTML and escapes raw HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="**x** <img src=x onerror=alert(1)>" />,
    );
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(html).not.toContain("<img");
  });
});

describe("OptionCards", () => {
  it("renders one large card button per option", () => {
    const html = renderToStaticMarkup(
      <OptionCards options={["Sí", "No"]} onPick={vi.fn()} />,
    );
    expect(html.match(/class="option-card"/g)).toHaveLength(2);
    expect(html).toContain("Sí");
    expect(html).toContain("No");
  });

  it("renders nothing when there are no options", () => {
    const html = renderToStaticMarkup(
      <OptionCards options={[]} onPick={vi.fn()} />,
    );
    expect(html).toBe("");
  });

  it("calls onPick with the tapped option", () => {
    const onPick = vi.fn();
    const tree = OptionCards({ options: ["Abrir", "Cerrar"], onPick });
    const buttons = collectButtons(tree);
    expect(buttons).toHaveLength(2);
    tap(buttons[1]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("Cerrar");
    tap(buttons[0]);
    expect(onPick).toHaveBeenCalledWith("Abrir");
  });
});

describe("FollowUpChips", () => {
  it("renders one chip per follow-up", () => {
    const html = renderToStaticMarkup(
      <FollowUpChips
        followUps={["¿Qué hora es?", "Lee mis notas"]}
        onPick={vi.fn()}
      />,
    );
    expect(html.match(/class="followup-chip"/g)).toHaveLength(2);
    expect(html).toContain("¿Qué hora es?");
    expect(html).toContain("Lee mis notas");
  });

  it("renders nothing when there are no follow-ups", () => {
    const html = renderToStaticMarkup(<FollowUpChips followUps={[]} onPick={vi.fn()} />);
    expect(html).toBe("");
  });

  it("calls onPick with the tapped follow-up", () => {
    const onPick = vi.fn();
    const tree = FollowUpChips({ followUps: ["Sí", "No"], onPick });
    const buttons = collectButtons(tree);
    expect(buttons).toHaveLength(2);
    tap(buttons[0]);
    expect(onPick).toHaveBeenCalledWith("Sí");
    tap(buttons[1]);
    expect(onPick).toHaveBeenCalledWith("No");
  });
});
