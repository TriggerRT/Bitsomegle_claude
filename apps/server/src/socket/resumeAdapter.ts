import type { Socket } from 'socket.io';
import { SessionAwareAdapter } from 'socket.io-adapter';

/**
 * Makes "coming back after a dropped connection" work when the SERVER has not noticed the
 * drop yet. That is the normal case on real networks.
 *
 * The problem: when someone's Wi-Fi goes off, nothing tells the server. From here the old
 * connection still looks alive until the next health check fails, up to 20 seconds later.
 * The browser, however, knows at once and reconnects as soon as it is back online, often
 * within a few seconds. Socket.IO only restores a connection it has already seen close,
 * so it treated that browser as a brand-new visitor, and the call was lost. (Found in
 * manual test M6-1; the automated tests had always closed both ends, which a real network
 * drop does not do.)
 *
 * The fix: a browser asking to be restored proves it knows the connection's private id
 * (`pid`, which only that browser was ever told). If a connection with that id still
 * looks alive here, the browser is telling us it is dead. So we close it first, exactly
 * as if the network had reported the drop, and then let Socket.IO restore it as usual.
 *
 * This reaches into Socket.IO's internals (`pid`, `_onclose`), which is why the exact
 * versions are pinned in package.json and reconnect.integration.test.ts covers it.
 */
export class ResumeAdapter extends SessionAwareAdapter {
  override restoreSession(pid: string, offset: string) {
    const sockets: Map<string, Socket> = this.nsp.sockets;
    for (const socket of sockets.values()) {
      if ((socket as unknown as { pid?: string }).pid !== pid) continue;
      // Runs our own 'disconnect' handler and makes Socket.IO remember the session...
      socket._onclose('transport close');
      // ...and the dead connection underneath is thrown away without waiting for it.
      socket.conn.close(true);
      break;
    }
    return super.restoreSession(pid, offset);
  }
}
