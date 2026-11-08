import { readdirSync } from 'node:fs';
import { Command } from 'commander';

const registryDir = new URL('../../src/commands/registry/', import.meta.url);

// 以桩 wireAction 运行全部域注册器，收集 wireAction 的命令名（即 envelope command）
export async function discoverRegisteredCommands() {
  const names = [];
  const program = new Command();
  const wireAction = (_cmd, commandName) => { names.push(commandName); };
  const files = readdirSync(registryDir).filter((file) => file.endsWith('.js')).sort();
  for (const file of files) {
    const registrar = await import(new URL(file, registryDir).href);
    registrar.register(program, wireAction);
  }
  return names;
}
