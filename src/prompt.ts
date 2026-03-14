import * as readline from 'node:readline';

type PromptInterface = readline.Interface & {
  stdoutMuted?: boolean;
  _writeToOutput?: (stringToWrite: string) => void;
};

export interface Prompt {
  ask: (question: string) => Promise<string>;
  askHidden: (question: string) => Promise<string>;
  close: () => void;
}

export function createPrompt(): Prompt {
  const output = process.stdout;
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  }) as PromptInterface;

  const originalWrite =
    rl._writeToOutput?.bind(rl) ??
    ((stringToWrite: string) => {
      output.write(stringToWrite);
    });

  rl.stdoutMuted = false;
  rl._writeToOutput = (stringToWrite: string) => {
    if (!rl.stdoutMuted) {
      originalWrite(stringToWrite);
      return;
    }

    if (stringToWrite.includes('\n')) {
      output.write('\n');
      return;
    }

    output.write('*');
  };

  function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(question, (answer: string) => {
        resolve(answer.trim());
      });
    });
  }

  function askHidden(question: string): Promise<string> {
    return new Promise((resolve) => {
      rl.stdoutMuted = true;
      rl.question(question, (answer: string) => {
        rl.stdoutMuted = false;
        output.write('\n');
        resolve(answer.trim());
      });
    });
  }

  function close(): void {
    rl.close();
  }

  return { ask, askHidden, close };
}
