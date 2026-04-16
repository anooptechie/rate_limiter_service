const store = new Map();

module.exports = {
  get: async (key) => store.get(key),

  set: async (key, value) => {
    store.set(key, value);
  },

  incr: async (key) => {
    const val = Number(store.get(key) || 0) + 1;
    store.set(key, val);
    return val;
  },

  expire: async () => {},

  ping: async () => "PONG",

  // Token bucket support
  hgetall: async (key) => store.get(key) || {},

  hmset: async (key, obj) => {
    store.set(key, obj);
  },

  // Lua not implemented
  eval: async () => {
    throw new Error("Lua not mocked yet");
  },

  // 🔥 ADD THIS LINE HERE
  quit: async () => {},

  // internal store (for clearing in tests)
  __store: store,
};
