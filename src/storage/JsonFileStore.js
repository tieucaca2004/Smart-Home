'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The simplest persistence that is still real persistence: one JSON array in
 * one file, read on first use and rewritten (atomically, via a temp file +
 * rename) after every mutation.
 *
 * With no `filePath` it holds records in memory only and never touches disk
 * — this is what tests use, exactly like DeviceService takes an injected
 * AdapterRegistry instead of a real one. There is no database, no schema
 * migration, and no query language: callers get an array and filter it
 * themselves. That is enough for the number of scenes/automations a home
 * actually has.
 */
class JsonFileStore {
  /** @param {string} [filePath] Absolute path to the JSON file; omit for an in-memory-only store. */
  constructor(filePath) {
    this.filePath = filePath || null;
    this._records = [];
    this._loaded = false;
    this._loadPromise = null;
  }

  async _ensureLoaded() {
    if (this._loaded) return;
    if (!this._loadPromise) this._loadPromise = this._load();
    await this._loadPromise;
  }

  async _load() {
    if (!this.filePath) {
      this._records = [];
      this._loaded = true;
      return;
    }
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this._records = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this._records = [];
    }
    this._loaded = true;
  }

  async _save() {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(this._records, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this.filePath);
  }

  /** All records, in insertion order. A copy — mutating it does not affect the store. */
  async all() {
    await this._ensureLoaded();
    return this._records.slice();
  }

  /** The record with this `id`, or null. */
  async find(id) {
    await this._ensureLoaded();
    return this._records.find((r) => r.id === id) || null;
  }

  /** Appends `record` (must already have an `id`) and persists. Returns it unchanged. */
  async insert(record) {
    await this._ensureLoaded();
    this._records.push(record);
    await this._save();
    return record;
  }

  /**
   * Replaces the record with this `id` by the result of `updater(current)`,
   * and persists. Returns the new record, or null if `id` was not found (and
   * `updater` is not called).
   */
  async update(id, updater) {
    await this._ensureLoaded();
    const index = this._records.findIndex((r) => r.id === id);
    if (index === -1) return null;
    const next = updater(this._records[index]);
    this._records[index] = next;
    await this._save();
    return next;
  }

  /** Removes the record with this `id` and persists. Returns whether it existed. */
  async remove(id) {
    await this._ensureLoaded();
    const index = this._records.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this._records.splice(index, 1);
    await this._save();
    return true;
  }
}

module.exports = JsonFileStore;
