import { describe, expect, it } from "vitest";

import { createPtyAttachToken } from "./pty-attach-token";

function storage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function locks() {
  const owners = new Map<string, string>();
  return {
    claim: (owner: string) => async (token: string) => {
      if (owners.has(token)) return null;
      owners.set(token, owner);
      return () => { owners.delete(token); };
    },
    closeDocument: (owner: string) => {
      for (const [token, current] of owners) {
        if (current === owner) owners.delete(token);
      }
    },
  };
}

describe("PTY attachment ownership", () => {
  it("isolates a duplicated tab while preserving reconnect and reload identity", async () => {
    const manager = locks();
    const originalStorage = storage();
    const original = createPtyAttachToken(() => originalStorage, manager.claim("original"));
    const first = await original();
    const duplicateStorage = storage(new Map(originalStorage.values));
    const duplicate = createPtyAttachToken(() => duplicateStorage, manager.claim("duplicate"));
    const second = await duplicate();
    expect(second).not.toBe(first);
    expect(await Promise.all([original(), duplicate()])).toEqual([first, second]);

    manager.closeDocument("original");
    const reloaded = createPtyAttachToken(() => originalStorage, manager.claim("reload"));
    expect(await reloaded()).toBe(first);
    expect(await duplicate()).toBe(second);
  });

  it("rotates only the requesting tab and reconnects when storage is blocked", async () => {
    const manager = locks();
    const blocked = () => { throw new Error("Storage disabled"); };
    const first = createPtyAttachToken(blocked, manager.claim("first"));
    const second = createPtyAttachToken(blocked, manager.claim("second"));
    const [before, sibling] = await Promise.all([first(), second()]);
    expect(before).not.toBe(sibling);
    const [rotated, reconnect] = await Promise.all([first(true), first()]);
    expect(rotated).not.toBe(before);
    expect(reconnect).toBe(rotated);
    expect(await second()).toBe(sibling);
  });
});
