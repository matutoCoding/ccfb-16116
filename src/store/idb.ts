import { Project } from '../core/types';

const DB_NAME = 'brick-studio-db';
const STORE = 'projects';
const META_KEY = 'last-opened';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  async save(project: Project): Promise<void> {
    project.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(project));
    localStorage.setItem(META_KEY, project.id);
  },
  async load(id: string): Promise<Project | undefined> {
    return tx('readonly', (s) => s.get(id));
  },
  async list(): Promise<Project[]> {
    const all = await tx<Project[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
  lastOpenedId(): string | null {
    return localStorage.getItem(META_KEY);
  },
  async duplicate(p: Project): Promise<Project> {
    const clone: Project = structuredClone(p);
    clone.id = `proj-${Math.random().toString(36).slice(2, 9)}`;
    clone.name = `${p.name} (副本)`;
    clone.createdAt = Date.now();
    clone.updatedAt = Date.now();
    await this.save(clone);
    return clone;
  },
};
