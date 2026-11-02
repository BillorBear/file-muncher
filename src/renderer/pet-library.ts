import './pet-library.css';
import { THEMES, sceneMarkup } from './themes';
import type { ThemeId } from '../shared/types';

export interface PetLibraryOptions {
  selectTheme: (id: ThemeId) => Promise<void>;
  currentTheme: () => ThemeId;
  goHome: () => void;
}

export interface PetLibraryControls {
  sync: () => void;
  focusSearch: () => void;
}

const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m7 7 10 10M7 17 17 7"/></svg>';
const selectedIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

export function petLibraryMarkup(): string {
  return `<section id="library-view" class="library-page" hidden aria-labelledby="library-title">
    <header class="library-heading"><div><h1 id="library-title">宠物馆</h1><p>共 ${THEMES.length} 位伙伴，选一位陪你整理文件。</p></div></header>
    <div class="library-tools"><div class="library-search">${searchIcon}<input id="pet-search" type="search" placeholder="搜索名字或性格" aria-label="搜索宠物名字或性格" autocomplete="off" spellcheck="false"><button id="clear-pet-search" type="button" class="library-clear" aria-label="清除搜索" hidden>${closeIcon}</button></div><p id="library-result-count" class="library-result-count" role="status" aria-live="polite" aria-atomic="true"></p></div>
    <p id="library-error" class="library-error" role="alert"></p>
    <ul class="library-grid" aria-label="可选择的伙伴">${THEMES.map(theme => `<li class="library-card" data-library-theme="${theme.id}">
      <div class="library-thumbnail mini-scene" data-phase="idle" aria-hidden="true">${sceneMarkup(theme.id)}<span class="library-selected" data-library-selected hidden>${selectedIcon}正在陪伴</span></div>
      <div class="library-card-body"><h2>${theme.name}</h2><p>${theme.description}</p><button type="button" class="library-select" data-select-theme="${theme.id}" aria-pressed="false">选它陪我</button></div>
    </li>`).join('')}</ul>
    <div id="library-empty" class="library-empty" hidden><span aria-hidden="true">${searchIcon}</span><h2>没有找到这样的伙伴</h2><p>换个名字或关键词试试。</p><button id="reset-pet-search" type="button" class="folder-button">清除搜索</button></div>
  </section>`;
}

export function bindPetLibrary(options: PetLibraryOptions): PetLibraryControls {
  const library = document.querySelector<HTMLElement>('#library-view');
  if (!library) throw new Error('Missing pet library view.');
  const required = <T extends HTMLElement>(selector: string): T => {
    const element = library.querySelector<T>(selector);
    if (!element) throw new Error(`Missing pet library element: ${selector}`);
    return element;
  };
  const search = required<HTMLInputElement>('#pet-search');
  const clear = required<HTMLButtonElement>('#clear-pet-search');
  const count = required<HTMLParagraphElement>('#library-result-count');
  const empty = required<HTMLDivElement>('#library-empty');
  const error = required<HTMLParagraphElement>('#library-error');
  const cards = THEMES.map(theme => ({
    theme,
    keywords: `${theme.name} ${theme.tagline} ${theme.description}`.toLowerCase(),
    card: required<HTMLLIElement>(`[data-library-theme="${theme.id}"]`),
    button: required<HTMLButtonElement>(`[data-select-theme="${theme.id}"]`),
    badge: required<HTMLSpanElement>(`[data-library-theme="${theme.id}"] [data-library-selected]`),
  }));
  let pendingTheme: ThemeId | undefined;

  const sync = (): void => {
    const query = search.value.trim().toLowerCase();
    const selectedTheme = options.currentTheme();
    let visibleCount = 0;
    for (const entry of cards) {
      const selected = entry.theme.id === selectedTheme;
      const visible = entry.keywords.includes(query);
      if (visible) visibleCount += 1;
      entry.card.hidden = !visible;
      entry.card.classList.toggle('is-selected', selected);
      entry.button.setAttribute('aria-pressed', String(selected));
      entry.button.setAttribute('aria-label', selected ? `回到首页，与${entry.theme.name}一起整理` : `选择${entry.theme.name}`);
      entry.button.disabled = pendingTheme !== undefined;
      entry.button.textContent = pendingTheme === entry.theme.id ? '正在邀请…' : selected ? '回到首页' : '选它陪我';
      entry.badge.hidden = !selected;
    }
    const resultText = query ? `找到 ${visibleCount} 位伙伴` : `${visibleCount} 位伙伴`;
    if (count.textContent !== resultText) count.textContent = resultText;
    clear.hidden = search.value.length === 0;
    empty.hidden = visibleCount !== 0;
    library.setAttribute('aria-busy', String(pendingTheme !== undefined));
  };

  const choose = async (id: ThemeId): Promise<void> => {
    if (pendingTheme !== undefined) return;
    error.textContent = '';
    if (id === options.currentTheme()) { options.goHome(); return; }
    pendingTheme = id;
    sync();
    try {
      await options.selectTheme(id);
      options.goHome();
    } catch (reason: unknown) {
      error.textContent = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '暂时无法切换伙伴，请再试一次。';
    } finally {
      pendingTheme = undefined;
      sync();
    }
  };

  const clearSearch = (): void => {
    search.value = '';
    sync();
    search.focus();
  };
  search.addEventListener('input', sync);
  clear.addEventListener('click', clearSearch);
  required<HTMLButtonElement>('#reset-pet-search').addEventListener('click', clearSearch);
  for (const entry of cards) entry.button.addEventListener('click', () => { void choose(entry.theme.id); });
  sync();
  return { sync, focusSearch: () => { search.focus(); search.select(); } };
}
