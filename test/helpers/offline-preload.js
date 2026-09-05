import net from 'node:net';
import { chromium } from 'patchright';

function blocked() {
  throw new Error('External IO is disabled in offline CLI tests');
}

// Runs before the CLI, including when a regression accidentally selects live mode.
net.Socket.prototype.connect = blocked;
globalThis.fetch = blocked;
chromium.launch = blocked;
chromium.launchPersistentContext = blocked;
chromium.connectOverCDP = blocked;
