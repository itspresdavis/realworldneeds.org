// Native-browser QA transport. A stalled renderer must fail the suite and
// release pending commands instead of preventing test cleanup indefinitely.
export class CdpClient {
  constructor(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 30_000, connectTimeoutMs = 5_000 } = {}) {
    if (![timeoutMs, connectTimeoutMs].every(value => Number.isFinite(value) && value > 0)) throw new TypeError("CDP deadlines must be positive finite milliseconds");
    Object.assign(this, { url, WebSocketImpl, timeoutMs, connectTimeoutMs });
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.failure = null;
  }

  fail(error) {
    this.failure ||= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  async connect() {
    this.ws = new this.WebSocketImpl(this.url);
    this.ws.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(String(event.data)); }
      catch { this.fail(new Error("Chrome DevTools returned malformed JSON")); this.ws.close(); return; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      }
    });
    this.ws.addEventListener("close", () => this.fail(new Error("Chrome DevTools connection closed")));
    this.ws.addEventListener("error", () => this.fail(new Error("Chrome DevTools WebSocket failed")));
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.ws.removeEventListener("open", opened);
        this.ws.removeEventListener("error", failed);
        this.ws.removeEventListener("close", failed);
      };
      const opened = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(this.failure || new Error("Chrome DevTools connection failed")); };
      const timer = setTimeout(() => {
        cleanup();
        this.fail(new Error(`Chrome DevTools connection exceeded ${this.connectTimeoutMs} ms`));
        reject(this.failure);
        this.ws.close();
      }, this.connectTimeoutMs);
      this.ws.addEventListener("open", opened);
      this.ws.addEventListener("error", failed);
      this.ws.addEventListener("close", failed);
    });
  }

  call(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.ws?.readyState !== 1) return Promise.reject(new Error("Chrome DevTools is not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`${method}: Chrome DevTools response exceeded ${this.timeoutMs} ms; renderer may be stalled`));
        this.ws.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { this.fail(new Error(`${method}: Chrome DevTools send failed`, { cause: error })); this.ws.close(); }
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.fail(new Error("Chrome DevTools client closed"));
    this.ws?.close();
  }
}
