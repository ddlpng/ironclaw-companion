'use strict';

/**
 * Minimal persistent JSON store with atomic writes.
 * Uses a temp-file + rename pattern to prevent config corruption on crash.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { app } = require('electron');

const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB guard

class Store {
  constructor(options = {}) {
    const userDataPath = app.getPath('userData');
    const name = options.name || 'config';
    this.filePath = path.join(userDataPath, `${name}.json`);
    this.data = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const stat = fs.statSync(this.filePath);
      if (stat.size > MAX_FILE_BYTES) {
        console.error('[Store] Config file too large — resetting');
        return {};
      }
      const content = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error('[Store] Failed to load config, using defaults:', e.message);
      return {};
    }
  }

  /** Atomic write: write to tmp, then rename — prevents corruption on crash */
  _save() {
    const dir = path.dirname(this.filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });

      const json = JSON.stringify(this.data, null, 2);
      // Write to a temp file in the same directory for atomic rename
      const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(tmp, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.error('[Store] Failed to save config:', e.message);
    }
  }

  get(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? this.data[key]
      : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  delete(key) {
    delete this.data[key];
    this._save();
  }

  clear() {
    this.data = {};
    this._save();
  }
}

module.exports = Store;
