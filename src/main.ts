import './styles.css';
import { h, mount } from './ui/dom';
import { PAGE_TITLES, PageId, store } from './store/appStore';
import { elevationPage } from './ui/pages/elevation';
import { bondPage } from './ui/pages/bond';
import { jointPage } from './ui/pages/joint';
import { previewPage } from './ui/pages/preview';
import { bomPage } from './ui/pages/bom';
import { settingsPage } from './ui/pages/settings';

const PAGES: PageId[] = ['elevation', 'bond', 'joint', 'preview', 'bom', 'settings'];

function shell(): HTMLElement {
  const tabs = h('nav', { class: 'tabs' },
    ...PAGES.map((id) =>
      h('button', {
        class: store.page === id ? 'active' : '',
        onclick: () => store.goto(id),
      }, PAGE_TITLES[id]),
    ),
  );

  const top = h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, '清水砖墙工作室'),
    h('span', { class: 'proj-name' }, store.project.name),
    h('span', { class: 'spacer' }),
    tabs,
    h('span', { class: `save-dot ${store.dirty ? 'dirty' : ''}` },
      store.dirty ? '● 待保存' : '○ 已存 IndexedDB'),
  );

  let page: HTMLElement;
  switch (store.page) {
    case 'elevation': page = elevationPage(); break;
    case 'bond': page = bondPage(); break;
    case 'joint': page = jointPage(); break;
    case 'preview': page = previewPage(); break;
    case 'bom': page = bomPage(); break;
    case 'settings': page = settingsPage(); break;
  }

  return h('div', { style: { display: 'contents' } }, top, h('main', { style: { flex: 1, minHeight: 0 } }, page));
}

const app = document.getElementById('app')!;
store.init().then(() => {
  mount(app, shell);
});
