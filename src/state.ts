import { useEffect, useRef, useState } from 'react';
import type { Project } from './core/types.ts';
import { createCard, createProject, parseProject } from './core/project.ts';
import { createEffect } from './core/effects.ts';
import { starterCatalog } from './core/catalog.ts';
import { native } from './native.ts';
export function initialProject(reserved: number[] = []) {
  const p = createProject();
  p.reservedGuids = [...reserved];
  const c = createCard(p, '精密制造总监');
  const target = starterCatalog.assets.find(
    (a) => a.english === 'Spectacle Factory' || a.english === 'Spectacles Factory',
  );
  c.targets = target ? [target.guid] : [];
  c.effects = [createEffect('productivity'), createEffect('workforce')];
  p.cards = [c];
  return p;
}
export function useProject(onError: (message: string) => void) {
  const [project, setProject] = useState<Project>(() => initialProject()),
    [ready, setReady] = useState(false),
    [saveStatus, setSaveStatus] = useState('正在恢复工程'),
    [historyRevision, setHistoryRevision] = useState(0),
    [filePath, setFilePath] = useState('');
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    current = useRef(project),
    lastSaved = useRef<Project | null>(null),
    reserved = useRef(new Set(project.reservedGuids));
  current.current = project;
  function remember(p: Project) {
    for (const guid of p.reservedGuids) reserved.current.add(guid);
    p.reservedGuids = [...reserved.current];
    return p;
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [draft, registry, catalog] = await Promise.all([
          native.loadDraft(),
          native.registry().catch((e) => {
            if (live) onError(`GUID 登记恢复失败：${String(e)}`);
            return [];
          }),
          native.loadCatalog().catch((e) => {
            if (live) onError(`资源缓存恢复失败，请重新索引：${String(e)}`);
            return null;
          }),
        ]);
        if (!live) return;
        for (const guid of registry) reserved.current.add(guid);
        const p = draft ? parseProject(draft) : initialProject([...reserved.current]);
        if (!p.catalog && catalog) p.catalog = catalog;
        remember(p);
        current.current = p;
        setProject(p);
      } catch (e) {
        if (live) onError(`草稿恢复失败，原文件仍保留：${String(e)}`);
      } finally {
        if (live) {
          setReady(true);
          setSaveStatus('草稿已恢复');
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []); // restore once, before enabling editing
  useEffect(() => {
    if (!ready) return;
    setSaveStatus('正在保存草稿…');
    const timer = setTimeout(() => {
      native
        .draft(project)
        .then(() => {
          if (current.current === project) setSaveStatus('草稿已自动保存');
        })
        .catch((e) => {
          setSaveStatus('草稿保存失败');
          onError(String(e));
        });
    }, 650);
    return () => clearTimeout(timer);
  }, [project, ready]);
  function change(edit: (draft: Project) => void) {
    const previous = current.current;
    const p: Project = structuredClone({ ...previous, catalog: undefined });
    p.catalog = previous.catalog;
    edit(p);
    remember(p);
    history.current.push(previous);
    if (history.current.length > 35) history.current.shift();
    future.current = [];
    current.current = p;
    setProject(p);
    setHistoryRevision((v) => v + 1);
  }
  function replace(p: Project) {
    history.current = [];
    future.current = [];
    current.current = remember(p);
    setProject(p);
    setHistoryRevision((v) => v + 1);
    setFilePath('');
    lastSaved.current = null;
  }
  function restore(p: Project) {
    const next = remember({ ...p });
    current.current = next;
    setProject(next);
    setHistoryRevision((v) => v + 1);
  }
  function undo() {
    const p = history.current.pop();
    if (p) {
      future.current.push(current.current);
      restore(p);
    }
  }
  function redo() {
    const p = future.current.pop();
    if (p) {
      history.current.push(current.current);
      restore(p);
    }
  }
  async function save(saveAs = false) {
    const saving = current.current;
    const path = await native.saveProject(saving, saveAs);
    if (path) {
      setFilePath(path);
      lastSaved.current = saving;
      setSaveStatus('工程已保存');
    }
    return path;
  }
  return {
    project,
    change,
    replace,
    undo,
    redo,
    save,
    ready,
    saveStatus,
    filePath,
    setFilePath,
    canUndo: history.current.length > 0 && historyRevision >= 0,
    canRedo: future.current.length > 0,
    dirty: project !== lastSaved.current,
  };
}
