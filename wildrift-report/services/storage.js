window.WR = window.WR || {};
const memStore = new Map();
let storageBroken = false;
WR.shotKey = (id) => `wr-shot:${id}`; WR.verifyKey = (id) => `wr-verify:${id}`;
WR.store = {

  async probe() {
    try {
      const t = "__wr_probe__";
      window.localStorage.setItem(t, "1");
      window.localStorage.removeItem(t);
      return true;
    } catch { return false; }
  },
  async get(key) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? null : { key, value: v };
    } catch {
      return memStore.has(key) ? { key, value: memStore.get(key) } : null;
    }
  },
  async set(key, value) {
    memStore.set(key, value);
    try { window.localStorage.setItem(key, value); } catch { /* 저장 공간이 가득 찼을 수 있음 */ }
  },
  async del(key) {
    memStore.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* 이미 없을 수 있음 */ }
  },

};
