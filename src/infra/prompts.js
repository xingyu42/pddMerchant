import Enquirer from 'enquirer';

const enquirer = new Enquirer({ stdin: process.stdin, stdout: process.stderr });

export async function promptText(message) {
  const { value } = await enquirer.prompt({
    type: 'input',
    name: 'value',
    message,
  });
  return value;
}

export async function promptPassword(message) {
  const { value } = await enquirer.prompt({
    type: 'password',
    name: 'value',
    message,
  });
  return value;
}
