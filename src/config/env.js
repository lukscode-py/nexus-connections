import path from "node:path";

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value, fallback = "") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export const env = Object.freeze({
  nodeEnv: str(process.env.NODE_ENV, "development"),
  isProduction: str(process.env.NODE_ENV, "development") === "production",

  app: {
    name: str(process.env.APP_NAME, "Nexus Connections"),
    shortName: str(process.env.APP_SHORT_NAME, "NC"),
    creator: str(process.env.APP_CREATOR, "lukscode"),
    github: str(process.env.APP_GITHUB, "https://github.com/lukscode-py"),
    channel: str(process.env.APP_CHANNEL, "@vixzap"),
    port: int(process.env.PORT, int(process.env.APP_PORT, 3333)),
    baseUrl: str(process.env.APP_BASE_URL, "http://localhost:3333")
  },

  paths: {
    dataDir: path.resolve(
      process.env.VERCEL
        ? str(process.env.NC_DATA_DIR, "/tmp/nexus-connections/data")
        : str(process.env.NC_DATA_DIR, "./var/data")
    ),
    tmpDir: path.resolve(
      process.env.VERCEL
        ? str(process.env.NC_TMP_DIR, "/tmp/nexus-connections/tmp")
        : str(process.env.NC_TMP_DIR, "./var/tmp")
    )
  },

  session: {
    prefix: str(process.env.NC_SESSION_PREFIX, "session-nexusnx"),
    qrExpiresSeconds: int(process.env.NC_QR_EXPIRES_SECONDS, 60),
    pairExpiresSeconds: int(process.env.NC_PAIR_EXPIRES_SECONDS, 60),
    downloadExpiresSeconds: int(process.env.NC_DOWNLOAD_EXPIRES_SECONDS, 300),
    cleanupIntervalSeconds: int(process.env.NC_CLEANUP_INTERVAL_SECONDS, 60),
    maxActivePerIp: int(process.env.NC_MAX_ACTIVE_PER_IP, 1),
    maxGlobalActive: int(process.env.NC_MAX_GLOBAL_ACTIVE, 3)
  },

  rate: {
    errorLimit: int(process.env.NC_RATE_ERROR_LIMIT, 5),
    errorWindowSeconds: int(process.env.NC_RATE_ERROR_WINDOW_SECONDS, 360),
    errorBlockSeconds: int(process.env.NC_RATE_ERROR_BLOCK_SECONDS, 900),

    fastLimit: int(process.env.NC_RATE_FAST_LIMIT, 5),
    fastWindowSeconds: int(process.env.NC_RATE_FAST_WINDOW_SECONDS, 30),
    fastBlockSeconds: int(process.env.NC_RATE_FAST_BLOCK_SECONDS, 1800),

    phoneLimit: int(process.env.NC_RATE_PHONE_LIMIT, 3),
    phoneWindowSeconds: int(process.env.NC_RATE_PHONE_WINDOW_SECONDS, 600),
    phoneBlockSeconds: int(process.env.NC_RATE_PHONE_BLOCK_SECONDS, 1800)
  },

  http: {
    jsonLimit: str(process.env.NC_JSON_LIMIT, "32kb"),
    trustProxy: bool(process.env.NC_TRUST_PROXY, false)
  }
});
