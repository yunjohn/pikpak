import { describe, expect, it, beforeEach } from 'vitest';
import { ref, watch, nextTick } from 'vue';

const NAV_STATE_KEY = 'pikpak-desktop-navigation-v1';

describe('navigation state management', () => {
  let mockStorage = {};

  beforeEach(() => {
    mockStorage = {};
    global.localStorage = {
      getItem: (key) => (Object.hasOwn(mockStorage, key) ? mockStorage[key] : null),
      setItem: (key, val) => { mockStorage[key] = String(val); },
      removeItem: (key) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    };
  });

  function createNavigationHarness(initialConnected = false) {
    const mode = ref('drive');
    const account = ref({ connected: initialConnected });
    const pathStack = ref([{ id: '', name: '全部文件' }]);
    const treeChildren = ref({});
    const treeExpanded = ref([]);
    const selectedIds = ref([]);
    const selected = ref(null);

    function clearSelection() {
      selected.value = null;
      selectedIds.value = [];
    }

    function resetNavigationState() {
      pathStack.value = [{ id: '', name: '全部文件' }];
      treeChildren.value = {};
      treeExpanded.value = [];
      clearSelection();
    }

    function restoreNavigationState() {
      if (!account.value.connected) return;
      try {
        const value = JSON.parse(localStorage.getItem(NAV_STATE_KEY) || 'null');
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value.path) && value.path.length && value.path.length < 100) {
          pathStack.value = value.path.map(item => ({
            id: String(item.id || ''),
            name: String(item.name || '目录').slice(0, 200)
          }));
        }
        if (Array.isArray(value.expanded)) {
          treeExpanded.value = value.expanded.map(String).filter(Boolean).slice(0, 1000);
        }
        if (value.children && typeof value.children === 'object' && !Array.isArray(value.children)) {
          const safe = {};
          for (const [id, nodes] of Object.entries(value.children).slice(0, 1000)) {
            if (Array.isArray(nodes)) {
              safe[id] = nodes.slice(0, 1000).map(node => ({
                id: String(node.id || ''),
                name: String(node.name || '目录').slice(0, 200),
                kind: 'drive#folder'
              })).filter(node => node.id);
            }
          }
          treeChildren.value = safe;
        }
      } catch {
        localStorage.removeItem(NAV_STATE_KEY);
      }
    }

    function persistNavigationState() {
      if (mode.value !== 'drive' || !account.value.connected) return;
      try {
        localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
          path: pathStack.value,
          expanded: treeExpanded.value,
          children: treeChildren.value
        }));
      } catch {}
    }

    watch([mode, pathStack, treeExpanded, treeChildren], persistNavigationState, { deep: true });

    return {
      mode,
      account,
      pathStack,
      treeChildren,
      treeExpanded,
      selected,
      selectedIds,
      resetNavigationState,
      restoreNavigationState,
      persistNavigationState
    };
  }

  it('does NOT restore previous navigation state when user is not logged in', () => {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
      path: [{ id: '', name: '全部文件' }, { id: 'secret-folder', name: '机密文件夹' }],
      expanded: ['secret-folder'],
      children: { '': [{ id: 'secret-folder', name: '机密文件夹', kind: 'drive#folder' }] }
    }));

    const harness = createNavigationHarness(false);
    harness.restoreNavigationState();

    expect(harness.pathStack.value).toEqual([{ id: '', name: '全部文件' }]);
    expect(harness.treeExpanded.value).toEqual([]);
    expect(harness.treeChildren.value).toEqual({});
  });

  it('restores navigation state only after user is connected', () => {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
      path: [{ id: '', name: '全部文件' }, { id: 'work', name: '工作文档' }],
      expanded: ['work'],
      children: { '': [{ id: 'work', name: '工作文档', kind: 'drive#folder' }] }
    }));

    const harness = createNavigationHarness(false);
    harness.restoreNavigationState();
    expect(harness.pathStack.value).toEqual([{ id: '', name: '全部文件' }]);

    harness.account.value = { connected: true };
    harness.restoreNavigationState();

    expect(harness.pathStack.value).toEqual([
      { id: '', name: '全部文件' },
      { id: 'work', name: '工作文档' }
    ]);
    expect(harness.treeExpanded.value).toEqual(['work']);
    expect(harness.treeChildren.value['']).toHaveLength(1);
    expect(harness.treeChildren.value[''][0].name).toBe('工作文档');
  });

  it('clears navigation state and removes localStorage on account expiration or logout', () => {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
      path: [{ id: '', name: '全部文件' }, { id: 'private', name: '私人目录' }],
      expanded: ['private'],
      children: { '': [{ id: 'private', name: '私人目录', kind: 'drive#folder' }] }
    }));

    const harness = createNavigationHarness(true);
    harness.restoreNavigationState();
    expect(harness.pathStack.value).toHaveLength(2);

    harness.account.value = { connected: false };
    harness.resetNavigationState();
    localStorage.removeItem(NAV_STATE_KEY);

    expect(harness.pathStack.value).toEqual([{ id: '', name: '全部文件' }]);
    expect(harness.treeChildren.value).toEqual({});
    expect(harness.treeExpanded.value).toEqual([]);
    expect(localStorage.getItem(NAV_STATE_KEY)).toBeNull();
  });

  it('does NOT persist navigation state when not connected', async () => {
    const harness = createNavigationHarness(false);
    harness.pathStack.value.push({ id: 'test-folder', name: '测试' });
    await nextTick();

    expect(localStorage.getItem(NAV_STATE_KEY)).toBeNull();

    harness.account.value = { connected: true };
    harness.pathStack.value.push({ id: 'another-folder', name: '另一测试' });
    await nextTick();

    expect(localStorage.getItem(NAV_STATE_KEY)).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem(NAV_STATE_KEY));
    expect(stored.path.some(p => p.id === 'another-folder')).toBe(true);
  });
});

describe('global keyboard shortcuts and accessibility navigation', () => {
  function createKeyboardHarness() {
    const mode = ref('drive');
    const visibleFiles = ref([
      { id: 'f1', name: 'File 1.mp4', kind: 'drive#file' },
      { id: 'f2', name: 'Folder A', kind: 'drive#folder' },
      { id: 'f3', name: 'Document.pdf', kind: 'drive#file' }
    ]);
    const selected = ref(null);
    const selectedIds = ref([]);
    const clipboard = ref(null);
    const actionsCalled = [];

    const modals = {
      archive: ref({ open: false }),
      shareSaveDialog: ref({ open: false }),
      conflictDialog: ref({ open: false }),
      batchResultModal: ref({ open: false })
    };

    function hasActiveModal() {
      return Boolean(modals.archive.value?.open || modals.shareSaveDialog.value?.open || modals.conflictDialog.value?.open || modals.batchResultModal.value?.open);
    }

    function closeActiveModal() {
      if (modals.batchResultModal.value?.open) { modals.batchResultModal.value.open = false; return true; }
      if (modals.conflictDialog.value?.open) { modals.conflictDialog.value.open = false; return true; }
      if (modals.shareSaveDialog.value?.open) { modals.shareSaveDialog.value.open = false; return true; }
      if (modals.archive.value?.open) { modals.archive.value.open = false; return true; }
      return false;
    }

    function clearSelection() {
      selected.value = null;
      selectedIds.value = [];
      actionsCalled.push('clearSelection');
    }

    function refreshCurrent() {
      actionsCalled.push('refreshCurrent');
    }

    function renameSelected() {
      actionsCalled.push(`rename:${selected.value?.id}`);
    }

    function trashSelected() {
      actionsCalled.push(`trash:${selectedIds.value.join(',')}`);
    }

    function deleteForever() {
      actionsCalled.push(`deleteForever:${selectedIds.value.join(',')}`);
    }

    function stageTransfer(operation) {
      clipboard.value = { operation, items: selectedIds.value };
      actionsCalled.push(`stageTransfer:${operation}`);
    }

    function pasteTransfer() {
      actionsCalled.push(`pasteTransfer:${clipboard.value?.operation}`);
    }

    function openItem(item) {
      actionsCalled.push(`openItem:${item?.id}`);
    }

    function handleGlobalKeyDown(e) {
      const tag = e.target?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(e.target?.isContentEditable);
      if (e.key === 'Escape') {
        if (closeActiveModal()) { e.preventDefault(); return; }
        if (!isInput && selectedIds.value.length) { e.preventDefault(); clearSelection(); return; }
      }
      if (isInput || hasActiveModal()) return;
      const key = e.key, isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd && (key === 'a' || key === 'A') && !e.shiftKey && !e.altKey) {
        if (['drive','starred','recent','trash','search','share'].includes(mode.value) && visibleFiles.value.length) {
          e.preventDefault();
          selectedIds.value = visibleFiles.value.map(f => f.id);
          if (!selected.value || !selectedIds.value.includes(selected.value.id)) selected.value = visibleFiles.value[0];
        }
        return;
      }
      if (key === 'F5' || (isCtrlOrCmd && (key === 'r' || key === 'R') && !e.shiftKey && !e.altKey)) {
        e.preventDefault();
        refreshCurrent();
        return;
      }
      if (key === 'F2') {
        if (mode.value === 'drive' && selected.value) { e.preventDefault(); renameSelected(); }
        return;
      }
      if (key === 'Delete') {
        if (selectedIds.value.length) {
          e.preventDefault();
          if (['drive','starred','recent','search'].includes(mode.value)) trashSelected();
          else if (mode.value === 'trash') deleteForever();
        }
        return;
      }
      if (isCtrlOrCmd && (key === 'c' || key === 'C') && !e.shiftKey && !e.altKey) {
        if (mode.value === 'drive' && selectedIds.value.length) { e.preventDefault(); stageTransfer('copy'); }
        return;
      }
      if (isCtrlOrCmd && (key === 'x' || key === 'X') && !e.shiftKey && !e.altKey) {
        if (mode.value === 'drive' && selectedIds.value.length) { e.preventDefault(); stageTransfer('move'); }
        return;
      }
      if (isCtrlOrCmd && (key === 'v' || key === 'V') && !e.shiftKey && !e.altKey) {
        if (mode.value === 'drive' && clipboard.value) { e.preventDefault(); pasteTransfer(); }
        return;
      }
      if (key === ' ' || key === 'Spacebar') {
        if (selected.value) { e.preventDefault(); openItem(selected.value); }
        return;
      }
      if (key === 'Enter') {
        if (selected.value && !e.target?.classList?.contains('file-row')) { e.preventDefault(); openItem(selected.value); }
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (['drive','starred','recent','trash','search','share'].includes(mode.value) && visibleFiles.value.length) {
          e.preventDefault();
          const list = visibleFiles.value;
          if (!selected.value || !selectedIds.value.length) {
            selected.value = list[0];
            selectedIds.value = [list[0].id];
            return;
          }
          const currentIndex = list.findIndex(f => f.id === selected.value.id);
          let nextIndex = 0;
          if (currentIndex === -1) nextIndex = 0;
          else if (key === 'ArrowDown') nextIndex = Math.min(list.length - 1, currentIndex + 1);
          else nextIndex = Math.max(0, currentIndex - 1);
          selected.value = list[nextIndex];
          selectedIds.value = [list[nextIndex].id];
        }
      }
    }

    return {
      mode,
      visibleFiles,
      selected,
      selectedIds,
      clipboard,
      modals,
      actionsCalled,
      handleGlobalKeyDown
    };
  }

  it('selects all visible files on Ctrl+A', () => {
    const harness = createKeyboardHarness();
    let defaultPrevented = false;
    harness.handleGlobalKeyDown({
      key: 'a',
      ctrlKey: true,
      preventDefault: () => { defaultPrevented = true; }
    });

    expect(defaultPrevented).toBe(true);
    expect(harness.selectedIds.value).toEqual(['f1', 'f2', 'f3']);
    expect(harness.selected.value.id).toBe('f1');
  });

  it('ignores shortcuts when typing inside an input element', () => {
    const harness = createKeyboardHarness();
    let defaultPrevented = false;
    harness.handleGlobalKeyDown({
      key: 'a',
      ctrlKey: true,
      target: { tagName: 'INPUT' },
      preventDefault: () => { defaultPrevented = true; }
    });

    expect(defaultPrevented).toBe(false);
    expect(harness.selectedIds.value).toEqual([]);
  });

  it('closes active modal on Escape before clearing selection', () => {
    const harness = createKeyboardHarness();
    harness.selectedIds.value = ['f1'];
    harness.modals.conflictDialog.value.open = true;

    harness.handleGlobalKeyDown({
      key: 'Escape',
      preventDefault: () => {}
    });

    expect(harness.modals.conflictDialog.value.open).toBe(false);
    expect(harness.selectedIds.value).toEqual(['f1']); // Selection preserved

    // Second Escape clears selection
    harness.handleGlobalKeyDown({
      key: 'Escape',
      preventDefault: () => {}
    });
    expect(harness.selectedIds.value).toEqual([]);
  });

  it('navigates list with ArrowDown and ArrowUp', () => {
    const harness = createKeyboardHarness();
    
    // First ArrowDown selects first item
    harness.handleGlobalKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
    expect(harness.selected.value.id).toBe('f1');

    // Second ArrowDown moves to next item
    harness.handleGlobalKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
    expect(harness.selected.value.id).toBe('f2');

    // Third ArrowDown moves to third item
    harness.handleGlobalKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
    expect(harness.selected.value.id).toBe('f3');

    // Fourth ArrowDown stays at last item (capped)
    harness.handleGlobalKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
    expect(harness.selected.value.id).toBe('f3');

    // ArrowUp moves back to second item
    harness.handleGlobalKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
    expect(harness.selected.value.id).toBe('f2');
  });

  it('triggers preview on Space and open on Enter', () => {
    const harness = createKeyboardHarness();
    harness.selected.value = harness.visibleFiles.value[0];
    harness.selectedIds.value = ['f1'];

    harness.handleGlobalKeyDown({ key: ' ', preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('openItem:f1');

    harness.handleGlobalKeyDown({ key: 'Enter', preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('openItem:f1');
  });

  it('supports clipboard shortcuts Ctrl+C, Ctrl+X, Ctrl+V', () => {
    const harness = createKeyboardHarness();
    harness.selectedIds.value = ['f1', 'f2'];

    harness.handleGlobalKeyDown({ key: 'c', ctrlKey: true, preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('stageTransfer:copy');
    expect(harness.clipboard.value).toEqual({ operation: 'copy', items: ['f1', 'f2'] });

    harness.handleGlobalKeyDown({ key: 'v', ctrlKey: true, preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('pasteTransfer:copy');

    harness.handleGlobalKeyDown({ key: 'x', ctrlKey: true, preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('stageTransfer:move');
  });

  it('triggers rename on F2 and trash on Delete', () => {
    const harness = createKeyboardHarness();
    harness.selected.value = harness.visibleFiles.value[0];
    harness.selectedIds.value = ['f1'];

    harness.handleGlobalKeyDown({ key: 'F2', preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('rename:f1');

    harness.handleGlobalKeyDown({ key: 'Delete', preventDefault: () => {} });
    expect(harness.actionsCalled).toContain('trash:f1');
  });
});
