"use strict";

// Shares the site's existing login and progress table; each practice module has its own row.
class SATQuestionSync {
  constructor(options) {
    this.namespace = options.namespace;
    this.model = options.model || window.SATProgress;
    this.onChange = options.onChange || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.client = options.client || null;
    this.ui = options.ui !== false;
    this.pollMs = options.pollMs ?? 15000;
    this.debounceMs = options.debounceMs ?? 600;
    this.memory = new Map();
    this.user = null;
    this.epoch = 0;
    this.ready = false;
    this.busy = null;
    this.dirty = false;
    this.storageAvailable = true;
    this.tabId = this.uuid();
    this.authSerial = 0;
    this.key = this.guestKey();
    this.envelope = this.readEnvelope(this.key);
    this.status = "local";
    this.attachUI();
  }

  uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  guestKey() { return `${this.namespace}:sync-v1:guest`; }
  userKey(id) { return `${this.namespace}:sync-v1:user:${id}`; }
  legacyKey() { return `${this.namespace}:sync-v1:legacy-imported`; }

  readRaw(key) {
    if (!this.storageAvailable && this.memory.has(key)) return this.memory.get(key);
    try { return localStorage.getItem(key) || this.memory.get(key) || null; }
    catch { this.storageAvailable = false; return this.memory.get(key) || null; }
  }

  writeRaw(key, value) {
    this.memory.set(key, value);
    try { localStorage.setItem(key, value); }
    catch { this.storageAvailable = false; }
  }

  readEnvelope(key) {
    const raw = this.readRaw(key);
    if (raw) {
      const saved = JSON.parse(raw);
      const expected = this.model.empty();
      if (saved.doc?.format === expected.format && saved.doc.version === expected.version && saved.actor) return saved;
      throw new Error("本机记录格式无法读取，原记录已保留。");
    }
    const envelope = { actor: this.uuid(), doc: this.model.empty() };
    this.writeRaw(key, JSON.stringify(envelope));
    return envelope;
  }

  async deviceId(legacy) {
    try {
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open("thinkcloze-sync-device", 1);
        let expired = false;
        const timeout = setTimeout(() => { expired = true; reject(new Error("本机标识暂不可用")); }, 2500);
        request.onupgradeneeded = () => request.result.createObjectStore("settings");
        request.onerror = () => { clearTimeout(timeout); reject(request.error); };
        request.onsuccess = () => {
          const db = request.result;
          if (expired) { db.close(); return; }
          const tx = db.transaction("settings", "readwrite");
          const store = tx.objectStore("settings");
          const read = store.get("device-id");
          let id;
          read.onsuccess = () => { id = read.result || this.uuid(); if (!read.result) store.put(id, "device-id"); };
          tx.oncomplete = () => { clearTimeout(timeout); db.close(); resolve(id); };
          tx.onerror = () => { clearTimeout(timeout); db.close(); reject(tx.error); };
        };
      });
    } catch {
      // Private/restricted storage: identical old snapshots still must not be counted twice.
      const bytes = new TextEncoder().encode(legacy);
      if (globalThis.crypto?.subtle) {
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return "snapshot-" + [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
      }
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      return `snapshot-${bytes.length}-${hash >>> 0}`;
    }
  }

  prepare() {
    if (!this.preparing) this.preparing = (async () => {
      const legacy = this.readRaw(this.namespace);
      if (!legacy || this.readRaw(this.legacyKey())) return;
      if (this.readEnvelope(this.guestKey()).legacySeedId) return;
      const id = await this.deviceId(legacy);
      if (this.readRaw(this.legacyKey())) return;
      const guest = this.readEnvelope(this.guestKey());
      if (guest.legacySeedId) return;
      guest.legacySeedId = `legacy:${id}:${this.namespace}`;
      guest.doc = this.model.seed(guest.doc, JSON.parse(legacy), guest.legacySeedId);
      this.writeRaw(this.guestKey(), JSON.stringify(guest));
      if (this.key === this.guestKey()) this.envelope = guest;
    })();
    return this.preparing;
  }

  persist() { this.writeRaw(this.key, JSON.stringify(this.envelope)); }

  load() {
    const saved = this.readEnvelope(this.key);
    if (this.key === this.guestKey() && saved.actor !== this.envelope.actor) this.envelope = saved;
    else this.envelope.doc = this.model.merge(this.envelope.doc, saved.doc);
    return this.model.view(this.envelope.doc);
  }

  change(callback, options = {}) {
    const before = this.load();
    const after = JSON.parse(JSON.stringify(before));
    callback(after);
    const next = this.model.capture(this.envelope.doc, before, after, { ...options, actor: `${this.envelope.actor}:${this.tabId}` });
    if (!this.model.equal(next, this.envelope.doc)) {
      this.envelope.doc = next;
      this.persist();
      this.queue();
    }
    return this.model.view(this.envelope.doc);
  }

  setStatus(status, message = "") {
    this.status = status;
    this.error = message;
    this.renderStatus();
    this.onStatus({ status, message, user: this.user, storageAvailable: this.storageAvailable });
  }

  async init() {
    await this.prepare();
    if (!this.client) {
      try {
        if (!window.supabase) await this.waitForSDK();
        const config = window.THINKCLOZE_CONFIG || {};
        if (window.supabase && config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY) {
          this.client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY,
            { auth: { persistSession: true, autoRefreshToken: true } });
        }
      } catch { /* Offline practice remains available. */ }
    }
    this.ready = true;
    if (this.client) {
      this.subscription = this.client.auth.onAuthStateChange((_event, session) => {
        // Supabase holds an auth lock during this callback; do network work after it returns.
        const serial = ++this.authSerial;
        setTimeout(() => {
          if (serial === this.authSerial) this.handleSession(session).catch(error => this.fail(error));
        }, 0);
      })?.data?.subscription;
      try {
        const serial = this.authSerial;
        const result = await this.client.auth.getSession();
        if (result.error) throw result.error;
        if (serial === this.authSerial) await this.handleSession(result.data?.session);
      } catch (error) { this.fail(error); }
    } else this.setStatus("local");
    this.poll = setInterval(() => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) this.syncNow();
    }, this.pollMs);
    this.onFocus = () => { if (document.visibilityState !== "hidden") this.syncNow(); };
    this.onOnline = () => this.syncNow();
    this.onOffline = () => { if (this.user) this.setStatus("offline"); };
    this.onStorage = event => {
      if (event.key !== this.key) return;
      const previous = this.envelope.doc;
      const reset = this.key === this.guestKey() && this.readEnvelope(this.key).actor !== this.envelope.actor;
      this.load();
      if (!this.model.equal(previous, this.envelope.doc)) {
        this.persist();
        this.onChange(this.model.view(this.envelope.doc), { accountChanged: reset });
        this.queue();
      }
    };
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("storage", this.onStorage);
    document.addEventListener("visibilitychange", this.onFocus);
    return this.load();
  }

  waitForSDK() {
    return new Promise((resolve, reject) => {
      const script = document.querySelector("script[data-sat-auth]");
      if (!script) return reject(new Error("登录组件暂不可用"));
      const timer = setTimeout(() => { cleanup(); reject(new Error("登录组件加载超时")); }, 10000);
      const done = () => { cleanup(); window.supabase ? resolve() : reject(new Error("登录组件暂不可用")); };
      const cleanup = () => { clearTimeout(timer); script.removeEventListener("load", done); script.removeEventListener("error", done); };
      script.addEventListener("load", done);
      script.addEventListener("error", done);
    });
  }

  async handleSession(session) {
    if (this.closed) return;
    const incoming = session?.user;
    const user = incoming?.id && incoming.email && !incoming.is_anonymous ? incoming : null;
    if (user?.id === this.user?.id) {
      this.user = user;
      if (user) return this.syncNow();
      this.setStatus("local");
      return;
    }
    this.epoch++;
    clearTimeout(this.timer);
    this.persist();
    this.user = user;
    this.key = user ? this.userKey(user.id) : this.guestKey();
    this.envelope = this.readEnvelope(this.key);
    if (user) {
      // Import the guest document once. Keep the original legacy key untouched as a backup.
      const guest = this.readEnvelope(this.guestKey());
      this.envelope.doc = this.model.merge(this.envelope.doc, guest.doc);
      this.persist();
      this.writeRaw(this.legacyKey(), user.id);
      this.writeRaw(this.guestKey(), JSON.stringify({ actor: this.uuid(), doc: this.model.empty() }));
    }
    this.onChange(this.load(), { accountChanged: true });
    this.setStatus(user ? "pending" : "local");
    if (user) return this.syncNow();
  }

  queue() {
    clearTimeout(this.timer);
    if (!this.user) { this.setStatus("local"); return; }
    this.dirty = true;
    this.setStatus(navigator.onLine === false ? "offline" : "pending");
    this.timer = setTimeout(() => this.syncNow(), this.debounceMs);
  }

  valid(epoch, id) { return this.epoch === epoch && this.user?.id === id; }

  async syncNow() {
    if (this.closed || !this.user || !this.client) return;
    if (navigator.onLine === false) { this.setStatus("offline"); return; }
    const epoch = this.epoch, id = this.user.id;
    if (this.busy?.epoch === epoch) { this.dirty = true; return this.busy.promise; }
    const task = this.performSync(epoch, id).catch(error => { if (this.valid(epoch, id)) this.fail(error); });
    this.busy = { epoch, promise: task };
    try { await task; }
    finally { if (this.busy?.promise === task) this.busy = null; }
  }

  async performSync(epoch, id) {
    this.setStatus("syncing");
    for (let attempt = 0; attempt < 6; attempt++) {
      this.dirty = false;
      const remote = await this.client.from("sat_vocab_progress").select("progress,updated_at")
        .eq("user_id", id).eq("progress_id", this.namespace).maybeSingle();
      if (!this.valid(epoch, id)) return;
      if (remote.error) throw remote.error;
      const row = remote.data;
      const expected = this.model.empty();
      if (row && (row.progress?.format !== expected.format || row.progress?.version !== expected.version)) {
        throw new Error("云端记录版本不兼容，已保留本机记录。");
      }
      const previous = this.envelope.doc;
      this.load();
      let merged = row ? this.model.merge(row.progress, this.envelope.doc) : this.envelope.doc;
      this.envelope.doc = merged;
      this.persist();
      if (!this.model.equal(previous, merged)) this.onChange(this.model.view(merged));
      this.load();
      merged = this.envelope.doc;
      if (row && this.model.equal(row.progress, merged)) {
        this.setStatus("saved");
        return;
      }
      if (!this.valid(epoch, id)) return;
      // Compare-and-swap prevents another device's successful write from being overwritten.
      const result = row
        ? await this.client.from("sat_vocab_progress").update({ progress: merged })
          .eq("user_id", id).eq("progress_id", this.namespace).eq("updated_at", row.updated_at)
          .select("progress,updated_at")
        : await this.client.from("sat_vocab_progress").insert({ user_id: id, progress_id: this.namespace, progress: merged })
          .select("progress,updated_at").maybeSingle();
      if (!this.valid(epoch, id)) return;
      if (result.error) {
        if (result.error.code === "23505") continue;
        throw result.error;
      }
      const savedRow = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!savedRow) continue;
      const beforeResult = this.envelope.doc;
      this.load();
      this.envelope.doc = this.model.merge(this.envelope.doc, savedRow.progress);
      this.persist();
      if (!this.model.equal(beforeResult, this.envelope.doc)) this.onChange(this.model.view(this.envelope.doc));
      if (this.model.equal(this.envelope.doc, savedRow.progress)) { this.setStatus("saved"); return; }
    }
    this.setStatus("pending");
    this.timer = setTimeout(() => this.syncNow(), 1200);
  }

  fail(error) {
    this.setStatus(navigator.onLine === false ? "offline" : "error",
      "同步暂未完成，本机记录已保留。可点击「立即同步」重试。");
    console.warn("SAT practice sync:", error?.message || "暂不可用");
  }

  renderStatus() {
    if (!this.ui) return;
    const byId = id => document.getElementById(id);
    const labels = { local: "本机已保存", pending: "待同步", syncing: "同步中…", saved: "已同步", offline: "离线，本机已保存", error: this.error };
    const status = !this.ready ? "正在检查登录状态…"
      : this.user ? `已登录：${this.user.email} · ${labels[this.status] || labels.local}`
      : this.client ? "未登录：记录保存在本机，登录后可跨设备同步。"
      : "登录暂不可用，练习记录保存在本机。";
    if (byId("sync-status")) byId("sync-status").textContent = status;
    for (const id of ["sync-now", "sync-logout"]) if (byId(id)) byId(id).hidden = !this.user;
    if (byId("sync-login")) { byId("sync-login").hidden = !!this.user; byId("sync-login").disabled = !this.ready || !this.client; }
    if (!this.storageAvailable) {
      const notice = byId("storage-notice");
      if (notice) { notice.hidden = false; notice.textContent = "当前浏览器无法保存到本机，请保持页面开启并确认账号显示「已同步」。"; }
    }
  }

  attachUI() {
    if (!this.ui) return;
    const byId = id => document.getElementById(id);
    const dialog = byId("sync-dialog"), form = byId("sync-form");
    if (!dialog || !form) return;
    byId("sync-login").onclick = () => { byId("sync-message").textContent = ""; dialog.showModal(); };
    byId("sync-cancel").onclick = () => dialog.close();
    byId("sync-now").onclick = () => this.syncNow();
    byId("sync-logout").onclick = () => this.logout().catch(error => this.fail(error));
    form.onsubmit = async event => {
      event.preventDefault();
      if (!this.client) return;
      const register = event.submitter?.dataset.mode === "register";
      const email = byId("sync-email").value.trim().toLowerCase();
      const password = byId("sync-password").value;
      byId("sync-submit").disabled = byId("sync-register").disabled = true;
      byId("sync-message").textContent = register ? "正在注册…" : "正在登录…";
      try {
        const result = register ? await this.client.auth.signUp({ email, password })
          : await this.client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        const active = result.data?.session;
        if (!active) { byId("sync-message").textContent = "请先完成邮箱验证，再用同一账号登录。"; return; }
        this.authSerial++;
        await this.handleSession(active);
        form.reset();
        dialog.close();
      } catch { byId("sync-message").textContent = "登录未完成，请检查邮箱、密码及网络后重试。"; }
      finally { byId("sync-submit").disabled = byId("sync-register").disabled = false; }
    };
    this.renderStatus();
  }

  async logout() {
    if (!this.client) return;
    const result = await this.client.auth.signOut();
    if (result.error) throw result.error;
    this.authSerial++;
    await this.handleSession(null);
  }

  destroy() {
    this.closed = true;
    clearInterval(this.poll); clearTimeout(this.timer); this.epoch++;
    this.subscription?.unsubscribe();
    for (const [event, callback] of [["focus", this.onFocus], ["online", this.onOnline], ["offline", this.onOffline], ["storage", this.onStorage]]) {
      if (callback) window.removeEventListener(event, callback);
    }
    if (this.onFocus) document.removeEventListener("visibilitychange", this.onFocus);
  }
}

window.SATQuestionSync = SATQuestionSync;
