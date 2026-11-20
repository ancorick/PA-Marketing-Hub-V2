import type { AppConfig } from '../config/env.js';
import type { EmailAdapter } from './adapter.js';
import { LogEmailAdapter } from './log-adapter.js';

export type { EmailAdapter, EmailMessage, EmailSendResult, EmailStream } from './adapter.js';

type Logger = { info: (obj: object, msg: string) => void };

export function createEmailAdapter(kind: AppConfig['emailAdapter'], logger: Logger): EmailAdapter {
  switch (kind) {
    case 'log':
      return new LogEmailAdapter(logger);
  }
}
