import { store } from '../store/appStore';

type Node = HTMLElement | SVGElement;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | number | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(el.dataset, v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(root: HTMLElement, render: () => HTMLElement): () => void {
  const draw = () => {
    const node = render();
    root.replaceChildren(node);
  };
  const unsub = store.subscribe(draw);
  draw();
  return unsub;
}

export function numberField(label: string, value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; unit?: string } = {}): HTMLElement {
  const input = h('input', {
    type: 'number',
    value: String(value),
    min: opts.min, max: opts.max, step: opts.step ?? 1,
    onchange: () => onChange(Number(input.value)),
  });
  return h('label', { class: 'field' },
    h('span', {}, label),
    input,
    opts.unit ? h('em', {}, opts.unit) : (null as unknown as HTMLElement),
  );
}

export function selectField<T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void): HTMLElement {
  const sel = h('select', {
    onchange: () => onChange(sel.value as T),
  }, ...options.map(([v, label2]) => h('option', { value: v, selected: v === value }, label2)));
  return h('label', { class: 'field' }, h('span', {}, label), sel);
}

export function sliderField(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit = ''): HTMLElement {
  const out = h('output', {}, `${value}${unit}`);
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      const v = Number(input.value);
      out.textContent = `${v}${unit}`;
      onChange(v);
    },
  });
  return h('label', { class: 'field slider' }, h('span', {}, label), input, out);
}

export function toggleField(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(input.checked) });
  return h('label', { class: 'field toggle' }, h('span', {}, label), input);
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLElement {
  return h('button', { class: `btn ${kind}`, onclick: onClick }, label);
}

export function panel(title: string, ...children: (Node | false | null)[]): HTMLElement {
  return h('section', { class: 'panel' },
    h('h3', {}, title),
    h('div', { class: 'panel-body' }, ...children.filter(Boolean) as Node[]),
  );
}
