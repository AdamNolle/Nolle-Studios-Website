import { hashPassword } from './auth.ts';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    return value.trimEnd();
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('CMS password: ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(value);
        }
        if (char === '\u0003') return reject(new Error('Cancelled'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = await readPassword();
if (password.length < 12) throw new Error('Use a password of at least 12 characters');
console.log(hashPassword(password));
