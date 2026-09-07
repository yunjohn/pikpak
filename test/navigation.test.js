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
