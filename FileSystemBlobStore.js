'use strict';

const fs = require('fs');
const path = require('path');
const mkdirpSync = require('./mkdirpSync');

const hasOwnProperty = Object.prototype.hasOwnProperty;

module.exports = class FileSystemBlobStore {
  constructor(directory) {
    this._blobFilename = path.join(directory, 'BLOB');
    this._mapFilename = path.join(directory, 'MAP');
    this._lockFilename = path.join(directory, 'LOCK');
    this._directory = directory;
    this._load();
  }

  has(key, invalidationKey) {
    if (hasOwnProperty.call(this._memoryBlobs, key)) {
      return this._invalidationKeys[key] === invalidationKey;
    } else if (hasOwnProperty.call(this._storedMap, key)) {
      return this._storedMap[key][0] === invalidationKey;
    }
    return false;
  }

  get(key, invalidationKey) {
    if (hasOwnProperty.call(this._memoryBlobs, key)) {
      if (this._invalidationKeys[key] === invalidationKey) {
        return this._memoryBlobs[key];
      }
    } else if (hasOwnProperty.call(this._storedMap, key)) {
      const mapping = this._storedMap[key];
      if (mapping[0] === invalidationKey) {
        return this._storedBlob.slice(mapping[1], mapping[2]);
      }
    }
  }

  set(key, invalidationKey, buffer) {
    this._invalidationKeys[key] = invalidationKey;
    this._memoryBlobs[key] = buffer;
  }

  delete(key) {
    if (hasOwnProperty.call(this._memoryBlobs, key)) {
      delete this._memoryBlobs[key];
    }
    if (hasOwnProperty.call(this._invalidationKeys, key)) {
      delete this._invalidationKeys[key];
    }
    if (hasOwnProperty.call(this._storedMap, key)) {
      delete this._storedMap[key];
    }
  }

  save() {
    const dump = this._getDump();
    const blobToStore = Buffer.concat(dump[0]);
    const mapToStore = JSON.stringify(dump[1]);

    let acquiredLock = false;
    try {
      mkdirpSync(this._directory);
      fs.writeFileSync(this._lockFilename, 'LOCK', {flag: 'wx'});
      acquiredLock = true;

      fs.writeFileSync(this._blobFilename, blobToStore);
      fs.writeFileSync(this._mapFilename, mapToStore);
    } catch (error) {
      // Swallow the exception silently only if we fail to acquire the lock.
      if (error.code !== 'EEXIST') {
        throw error;
      }
    } finally {
      if (acquiredLock) {
        fs.unlinkSync(this._lockFilename);
      }
    }
  }

  _load() {
    if (
      fs.existsSync(this._mapFilename) &&
      fs.existsSync(this._blobFilename)
    ) {
      try {
        this._storedBlob = fs.readFileSync(this._blobFilename);
        this._storedMap = JSON.parse(fs.readFileSync(this._mapFilename));
      } catch (e) {
        // ...
      }
    }
    this._memoryBlobs = {};
    this._invalidationKeys = {};
    if (this._storedBlob == null || this._storedMap == null) {
      this._storedBlob = new Buffer(0);
      this._storedMap = {};
    }
  }

  _getDump() {
    const buffers = [];
    const newMap = {};
    let offset = 0;

    function push(key, invalidationKey, buffer) {
      buffers.push(buffer);
      newMap[key] = [invalidationKey, offset, offset + buffer.length];
      offset += buffer.length;
    }

    for (const key of Object.keys(this._memoryBlobs)) {
      const buffer = this._memoryBlobs[key];
      const invalidationKey = this._invalidationKeys[key];
      push(key, invalidationKey, buffer);
    }

    for (const key of Object.keys(this._storedMap)) {
      if (hasOwnProperty.call(newMap, key)) { continue; }
      const mapping = this._storedMap[key];
      const buffer = this._storedBlob.slice(mapping[1], mapping[2]);
      push(key, mapping[0], buffer);
    }

    return [buffers, newMap];
  }
};
