import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  CONFIG_FIELD_DEFINITIONS,
  configInspectionError,
  inspectConfig,
  parseWritableConfigField,
  validateLocalConfigCandidate,
} from './config.js';
import {
  CONFIG_DIR,
  CONFIG_EXAMPLE_PATH,
  CONFIG_PATH,
  PROJECT_ROOT,
} from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';

const DEFAULT_IO = Object.freeze({ lstat, mkdir, open, readFile, realpath, rename, rm });

function managedPaths(options = {}) {
  return {
    projectRoot: options.projectRoot ?? PROJECT_ROOT,
    configDir: options.configDir ?? CONFIG_DIR,
    baselinePath: options.baselinePath ?? CONFIG_EXAMPLE_PATH,
    configPath: options.configPath ?? CONFIG_PATH,
  };
}

function pathLabel(path, projectRoot) {
  const rel = relative(projectRoot, path);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.replaceAll('\\', '/');
  return basename(path);
}

function configManagementError({ source = 'local', reason, path, projectRoot, field, message, issues }) {
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: message ?? 'Local configuration cannot be safely modified',
    hint: 'Keep config files inside the project config directory and fix the reported issue',
    detail: {
      source,
      reason,
      ...(path ? { path: pathLabel(path, projectRoot) } : {}),
      ...(field ? { field } : {}),
      ...(issues?.length ? { issues } : {}),
    },
    exitCode: ExitCodes.GENERAL,
  });
}

function isWithin(parent, target, { allowSame = false } = {}) {
  const rel = relative(resolve(parent), resolve(target));
  if (rel === '') return allowSame;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

async function statIfExists(io, path) {
  try {
    return await io.lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw configManagementError({ source: 'path', reason: 'path_unreadable' });
  }
}

async function safeRealpath(io, path, projectRoot) {
  try {
    return await io.realpath(path);
  } catch {
    throw configManagementError({
      source: 'path',
      reason: 'path_unreadable',
      path,
      projectRoot,
    });
  }
}

async function assertManagedConfigPaths(options = {}, { createDir = false } = {}) {
  const paths = managedPaths(options);
  const io = { ...DEFAULT_IO, ...(options.io ?? {}) };
  const root = resolve(paths.projectRoot);
  const configDir = resolve(paths.configDir);
  const baselinePath = resolve(paths.baselinePath);
  const configPath = resolve(paths.configPath);

  if (!isWithin(root, configDir)
    || dirname(baselinePath) !== configDir
    || dirname(configPath) !== configDir) {
    throw configManagementError({
      source: 'path',
      reason: 'project_escape',
      path: configPath,
      projectRoot: root,
    });
  }

  const rootReal = await safeRealpath(io, root, root);

  let dirStat = await statIfExists(io, configDir);
  if (!dirStat && createDir) {
    try {
      await io.mkdir(configDir, { recursive: true });
    } catch {
      throw configManagementError({
        source: 'path',
        reason: 'config_directory_unwritable',
        path: configDir,
        projectRoot: root,
      });
    }
    dirStat = await statIfExists(io, configDir);
  }
  if (dirStat) {
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw configManagementError({
        source: 'path',
        reason: 'config_directory_unsafe',
        path: configDir,
        projectRoot: root,
      });
    }
    const dirReal = await safeRealpath(io, configDir, root);
    if (!isWithin(rootReal, dirReal)) {
      throw configManagementError({
        source: 'path',
        reason: 'project_escape',
        path: configDir,
        projectRoot: root,
      });
    }

    for (const candidate of [baselinePath, configPath]) {
      const fileStat = await statIfExists(io, candidate);
      if (!fileStat) continue;
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw configManagementError({
          source: 'path',
          reason: 'config_file_unsafe',
          path: candidate,
          projectRoot: root,
        });
      }
      const fileReal = await safeRealpath(io, candidate, root);
      if (!isWithin(dirReal, fileReal)) {
        throw configManagementError({
          source: 'path',
          reason: 'project_escape',
          path: candidate,
          projectRoot: root,
        });
      }
    }
  }

  return { ...paths, projectRoot: root, configDir, baselinePath, configPath, io };
}

export async function inspectManagedConfig(options = {}) {
  const paths = await assertManagedConfigPaths(options);
  return inspectConfig({
    env: options.env ?? process.env,
    cliFlags: options.cliFlags ?? {},
    baselinePath: paths.baselinePath,
    configPath: paths.configPath,
  });
}

export async function readLocalConfigForEdit(options = {}) {
  const paths = await assertManagedConfigPaths(options);
  let raw;
  try {
    raw = await paths.io.readFile(paths.configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: {}, paths };
    throw configManagementError({
      reason: 'file_unreadable',
      path: paths.configPath,
      projectRoot: paths.projectRoot,
    });
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw configManagementError({
      reason: 'json_invalid',
      path: paths.configPath,
      projectRoot: paths.projectRoot,
      message: 'Local configuration JSON is damaged and was not overwritten',
    });
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw configManagementError({
      reason: 'root_not_object',
      path: paths.configPath,
      projectRoot: paths.projectRoot,
      message: 'Local configuration root must be a JSON object and was not overwritten',
    });
  }
  return { exists: true, value, paths };
}

export async function writeLocalConfigAtomic(value, options = {}) {
  const paths = await assertManagedConfigPaths(options, { createDir: true });
  const tempPath = resolve(paths.configDir, `.config.json.${process.pid}.${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await paths.io.open(tempPath, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await paths.io.rename(tempPath, paths.configPath);
  } catch (error) {
    try { await handle?.close(); } catch { /* best effort */ }
    try { await paths.io.rm(tempPath, { force: true }); } catch { /* best effort */ }
    throw configManagementError({
      reason: 'atomic_write_failed',
      path: paths.configPath,
      projectRoot: paths.projectRoot,
    });
  }
  return pathLabel(paths.configPath, paths.projectRoot);
}

function editWarnings(runtimeValid) {
  return [
    ...(!runtimeValid ? ['runtime_invalid_after_edit'] : []),
  ];
}

async function finishEdit({ key, changed, localValue, options }) {
  const inspection = await inspectManagedConfig(options);
  const effectiveSource = inspection.valid ? inspection.sources[key] ?? null : null;
  return {
    path: pathLabel(managedPaths(options).configPath, managedPaths(options).projectRoot),
    key,
    changed,
    localValue,
    effectiveSource,
    overridden: inspection.valid && localValue !== undefined && effectiveSource !== 'local',
    runtimeValid: inspection.valid,
    issues: inspection.valid ? [] : inspection.issues,
    restartRequired: false,
    warnings: editWarnings(inspection.valid),
  };
}

export async function setLocalConfigValue(key, rawValue, options = {}) {
  const parsedValue = parseWritableConfigField(key, rawValue);
  const local = await readLocalConfigForEdit(options);
  const hadLocalOverride = Object.hasOwn(local.value, key);
  const changed = !hadLocalOverride || !Object.is(local.value[key], parsedValue);
  const candidate = validateLocalConfigCandidate({ ...local.value, [key]: parsedValue });
  if (changed) await writeLocalConfigAtomic(candidate, options);
  const result = await finishEdit({ key, changed, localValue: parsedValue, options });
  return { ...result, hadLocalOverride };
}

export async function unsetLocalConfigValue(key, options = {}) {
  const local = await readLocalConfigForEdit(options);
  const removed = Object.hasOwn(local.value, key);
  if (!removed && !Object.hasOwn(CONFIG_FIELD_DEFINITIONS, key)) {
    parseWritableConfigField(key, '');
  }
  if (!removed) {
    const result = await finishEdit({ key, changed: false, localValue: undefined, options });
    return { ...result, removed: false };
  }

  const candidate = { ...local.value };
  delete candidate[key];
  const validated = validateLocalConfigCandidate(candidate);
  await writeLocalConfigAtomic(validated, options);
  const result = await finishEdit({ key, changed: true, localValue: undefined, options });
  return { ...result, removed: true };
}

export function publicConfigKeys() {
  return Object.keys(CONFIG_FIELD_DEFINITIONS);
}

export function assertInspectionValid(inspection) {
  if (!inspection.valid) throw configInspectionError(inspection);
  return inspection;
}
