export function createFakeFs() {
  const files = new Map();
  const permissions = new Map();
  let chmodShouldFail = false;

  return {
    setChmodFail(fail) { chmodShouldFail = fail; },
    async writeFile(path, data) { files.set(path, data); },
    async readFile(path) {
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(path);
    },
    existsSync(path) { return files.has(path); },
    async rename(src, dest) {
      if (!files.has(src)) throw new Error(`ENOENT: ${src}`);
      files.set(dest, files.get(src));
      files.delete(src);
    },
    async chmod(path, mode) {
      if (chmodShouldFail) throw new Error('chmod failed');
      permissions.set(path, mode);
    },
    async unlink(path) { files.delete(path); },
    async copyFile(src, dest) {
      if (!files.has(src)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      files.set(dest, files.get(src));
    },
    async mkdir() {},
    _files: files,
    _perms: permissions,
  };
}
