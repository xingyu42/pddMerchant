import { link } from '../console.js';

export function register(program, wireAction) {
  const group = program.command('console').description('人工控制台');
  wireAction(group.command('link').description('生成一次性访问链接'), 'console.link', link);
}
