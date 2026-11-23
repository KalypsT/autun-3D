/**
 * domothib-games.ts — library of the bridge of DomoThib Games.
 *
 * Version: 1.1.0
 * Protocol: 1
 *
 * Source: KalypsT/DomoThibv3, web/src/features/jeux/sdk/domothib-games.ts; contract: docs/modules/jeux-contrat.md
 * (copied in the game as docs/domothib.md). Copy this file WITHOUT CHANGE into the game (src/domothib/domothib-games.ts)
 * and update it with the contract. No dependency: browser APIs only.
 *
 * - `connectDomoThib()` connects the game to DomoThib (`null` outside a frame, or after 5 s without answer).
 * - Activity: `pointerdown`, `keydown` and `wheel` in the game are reported at most once every 10 s, so that the
 *   standby screen of the tablet does not stop a game being played.
 * - Pause, resume, quit: `onPause`, `onResume`, `quit()`.
 * - Saves on the server, per player (`"sauvegarde": "domothib"`): `saves.read`, `write`… and `openSync()` for a game
 *   that reads its storage synchronously. `saves` is `null` with `"sauvegarde": "integree"`, or with a DomoThib that
 *   does not keep the saves yet: the game then keeps its own storage.
 */

export const VERSION = '1.1.0';
export const PROTOCOL = 1;

/** Key of `sessionStorage` where the launcher of DomoThib keeps the origin of DomoThib (the parent window). */
const PARENT_ORIGIN_KEY = 'domothib.parent';

/** The request of connection is sent again every 500 ms until the answer. */
const READY_INTERVAL_MS = 500;

/** No answer after this delay: `null`. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** `activity` is sent at most once every 10 s. */
export const ACTIVITY_INTERVAL_MS = 10_000;

/** Events of the game that count as an activity of the player. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** Key of a save: `^[A-Za-z0-9._:-]{1,100}$`, neither `.` nor `..`. */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

/** A value is 2 MiB at most, in UTF-8 bytes. */
export const MAX_VALUE_BYTES = 2 * 1024 * 1024;

export type SaveState = 'saved' | 'pending';

export type DomoThibErrorCode = 'invalid_key' | 'too_large' | 'quota' | 'unavailable' | 'closed' | 'invalid_request';

/** Error of a request of saves (contract §4.2). */
export class DomoThibError extends Error {
  readonly code: DomoThibErrorCode;

  constructor(code: DomoThibErrorCode) {
    super(`DomoThib: ${code}`);
    this.name = 'DomoThibError';
    this.code = code;
  }
}

/** Saves on the server, per player (contract §4.2). */
export interface DomoThibSaves {
  list(): Promise<{ key: string; revision: number; size: number; modifiedAt: string }[]>;
  read(key: string): Promise<string | null>;
  readAll(): Promise<Record<string, string>>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  openSync(): Promise<DomoThibSyncStorage>;
}

/** Synchronous storage loaded at the start (contract §4.3). */
export interface DomoThibSyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export interface DomoThib {
  /** Identifier of the game. */
  readonly game: string;
  /** First name of the player and its initial, nothing else. */
  readonly player: { name: string; initial: string };
  /** `null` with `"sauvegarde": "integree"` (or a DomoThib without saves): the game keeps its own storage. */
  readonly saves: DomoThibSaves | null;
  /** Each returns the function that removes the listener. */
  onPause(listener: () => void): () => void;
  onResume(listener: () => void): () => void;
  onSaveState(listener: (state: SaveState) => void): () => void;
  /** Back to the page of the games of DomoThib (« Quitter » button of the game). */
  quit(): void;
}

export interface ConnectOptions {
  /** Delay without answer of DomoThib before `null` (5 s by default). */
  timeoutMs?: number;
}

/** What the library uses of the browser (`window` by default; fakes in the tests of DomoThib). */
export interface DomoThibEnvironment {
  /** The parent window, `null` outside a frame. */
  parent: { postMessage(message: unknown, targetOrigin: string): void } | null;
  /** Origin of DomoThib kept by the launcher, `null` when unknown. */
  parentOrigin: string | null;
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: EventListenerOptions): void;
}

type Port = Pick<MessagePort, 'postMessage' | 'close'> & { onmessage: ((event: MessageEvent) => void) | null };

function browserEnvironment(): DomoThibEnvironment {
  let parentOrigin: string | null;
  try {
    parentOrigin = window.sessionStorage.getItem(PARENT_ORIGIN_KEY);
  } catch {
    parentOrigin = null;
  }
  return {
    parent: window.parent === window ? null : window.parent,
    parentOrigin,
    addEventListener: (type, listener, options) => {
      window.addEventListener(type, listener, options);
    },
    removeEventListener: (type, listener, options) => {
      window.removeEventListener(type, listener, options);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function randomInstance(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function listeners<T extends unknown[]>() {
  const set = new Set<(...args: T) => void>();
  return {
    add(listener: (...args: T) => void): () => void {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit(...args: T) {
      for (const listener of [...set]) {
        try {
          listener(...args);
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
}

/** Size of `value` in UTF-8 bytes; `null` when it cannot be saved (character NUL or lone surrogate). */
function utf8Size(value: string): number | null {
  let size = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      return null;
    }
    if (code < 0x80) {
      size += 1;
    } else if (code < 0x800) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return null;
      }
      size += 4;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return null;
    } else {
      size += 3;
    }
  }
  return size;
}

/** The error of a key or a value refused before it is sent; `null` when valid. */
function checkSave(key: string, value: string | null): DomoThibError | null {
  if (!KEY_PATTERN.test(key) || key === '.' || key === '..') {
    return new DomoThibError('invalid_key');
  }
  if (value === null) {
    return null;
  }
  const size = utf8Size(value);
  if (size === null) {
    return new DomoThibError('invalid_request');
  }
  return size > MAX_VALUE_BYTES ? new DomoThibError('too_large') : null;
}

const ERROR_CODES: readonly string[] = ['invalid_key', 'too_large', 'quota', 'unavailable', 'closed', 'invalid_request'];

type Answer = { resolve: (result: unknown) => void; reject: (error: DomoThibError) => void };

/** The saves of the player, through the port (contract §4.2, §5). */
function savesOver(port: Port, answers: Map<number, Answer>): DomoThibSaves {
  let nextId = 1;
  const request = (message: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      answers.set(id, { resolve, reject });
      port.postMessage({ ...message, id });
    });

  const saves: DomoThibSaves = {
    async list() {
      const result = await request({ type: 'saves.list' });
      return Array.isArray(result) ? (result as { key: string; revision: number; size: number; modifiedAt: string }[]) : [];
    },
    async read(key) {
      const refused = checkSave(key, null);
      if (refused) {
        throw refused;
      }
      const result = await request({ type: 'saves.read', key });
      return typeof result === 'string' ? result : null;
    },
    async readAll() {
      const result = await request({ type: 'saves.readAll' });
      const values: Record<string, string> = {};
      if (isRecord(result)) {
        for (const [key, value] of Object.entries(result)) {
          if (typeof value === 'string') {
            values[key] = value;
          }
        }
      }
      return values;
    },
    async write(key, value) {
      const refused = checkSave(key, value);
      if (refused) {
        throw refused;
      }
      await request({ type: 'saves.write', key, value });
    },
    async remove(key) {
      const refused = checkSave(key, null);
      if (refused) {
        throw refused;
      }
      await request({ type: 'saves.remove', key });
    },
    async openSync() {
      const values = new Map(Object.entries(await saves.readAll()));
      const report = (error: unknown) => {
        console.error('DomoThib: sauvegarde refusée', error);
      };
      return {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, value) {
          // Refused at once, like `localStorage` refuses a value too large.
          const refused = checkSave(key, value);
          if (refused) {
            throw refused;
          }
          values.set(key, value);
          saves.write(key, value).catch(report);
        },
        removeItem(key) {
          if (checkSave(key, null) !== null || !values.has(key)) {
            return;
          }
          values.delete(key);
          saves.remove(key).catch(report);
        },
        keys: () => [...values.keys()].sort(),
      };
    },
  };
  return saves;
}

/** Builds the object given to the game once connected, and reports its activity. */
function connected(env: DomoThibEnvironment, data: Record<string, unknown>, port: Port): DomoThib {
  const player = data.player as { name: string; initial: string };
  const pause = listeners<[]>();
  const resume = listeners<[]>();
  const saveState = listeners<[SaveState]>();
  const answers = new Map<number, Answer>();

  port.onmessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isRecord(message)) {
      return;
    }
    if (typeof message.id === 'number' && typeof message.ok === 'boolean') {
      const answer = answers.get(message.id);
      if (answer) {
        answers.delete(message.id);
        if (message.ok) {
          answer.resolve(message.result);
        } else {
          const code = typeof message.error === 'string' && ERROR_CODES.includes(message.error) ? message.error : 'unavailable';
          answer.reject(new DomoThibError(code as DomoThibErrorCode));
        }
      }
      return;
    }
    if (message.type === 'pause') {
      pause.emit();
    } else if (message.type === 'resume') {
      resume.emit();
    } else if (message.type === 'saveState' && (message.state === 'saved' || message.state === 'pending')) {
      saveState.emit(message.state);
    }
  };

  let lastActivity = Number.NEGATIVE_INFINITY;
  const onActivity = () => {
    const now = Date.now();
    if (now - lastActivity >= ACTIVITY_INTERVAL_MS) {
      lastActivity = now;
      port.postMessage({ type: 'activity' });
    }
  };
  for (const type of ACTIVITY_EVENTS) {
    env.addEventListener(type, onActivity, { capture: true, passive: true });
  }

  return {
    game: data.game as string,
    player: { name: player.name, initial: player.initial },
    saves: data.saves === true ? savesOver(port, answers) : null,
    onPause: (listener) => pause.add(listener),
    onResume: (listener) => resume.add(listener),
    onSaveState: (listener) => saveState.add(listener),
    quit() {
      port.postMessage({ type: 'quit' });
    },
  };
}

function isConnectMessage(data: unknown, ports: readonly MessagePort[]): data is Record<string, unknown> {
  if (!isRecord(data) || data.type !== 'domothib:connect' || data.protocol !== PROTOCOL || ports.length === 0) {
    return false;
  }
  const player = data.player;
  return (
    typeof data.game === 'string' &&
    isRecord(player) &&
    typeof player.name === 'string' &&
    typeof player.initial === 'string'
  );
}

/**
 * Connects the game to DomoThib with a given environment (the tests of DomoThib use it; a game calls
 * `connectDomoThib`).
 */
export function connectDomoThibIn(env: DomoThibEnvironment, options: ConnectOptions = {}): Promise<DomoThib | null> {
  const parent = env.parent;
  const parentOrigin = env.parentOrigin;
  // Outside a frame (local development), or not opened by the launcher of DomoThib: the game runs alone.
  if (parent === null || parentOrigin === null) {
    return Promise.resolve(null);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const instance = randomInstance();

  return new Promise((resolve) => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: DomoThib | null) => {
      if (interval !== null) {
        clearInterval(interval);
      }
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      env.removeEventListener('message', onMessage);
      resolve(result);
    };

    function onMessage(event: Event) {
      const message = event as MessageEvent;
      // Only DomoThib: the parent window, on the origin kept by the launcher.
      if (message.source !== parent || message.origin !== parentOrigin) {
        return;
      }
      const data: unknown = message.data;
      if (isRecord(data) && data.type === 'domothib:incompatible') {
        finish(null);
        return;
      }
      if (isConnectMessage(data, message.ports)) {
        const port = message.ports[0] as Port;
        finish(connected(env, data, port));
      }
    }

    const sendReady = () => {
      parent.postMessage({ type: 'domothib:ready', protocol: PROTOCOL, instance }, parentOrigin);
    };

    env.addEventListener('message', onMessage);
    interval = setInterval(sendReady, READY_INTERVAL_MS);
    timeout = setTimeout(() => {
      finish(null);
    }, timeoutMs);
    sendReady();
  });
}

/**
 * Connects the game to DomoThib: `null` outside a frame of DomoThib, when DomoThib is too old for this library, or
 * after `timeoutMs` (5 s) without answer. The game then runs alone, with its own storage.
 */
export function connectDomoThib(options: ConnectOptions = {}): Promise<DomoThib | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  return connectDomoThibIn(browserEnvironment(), options);
}
