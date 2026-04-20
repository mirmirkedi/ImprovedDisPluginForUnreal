const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dgram = require("dgram");

const HTTP_PORT = 7070;
const STATIC_ROOT = __dirname;
const REPLAYS_DIR = path.join(STATIC_ROOT, "replays");
const DEFAULTS_PATH = path.join(STATIC_ROOT, "defaults.json");
const MAX_LOG_ENTRIES = 500;
const IS_PUBLIC_MODE = process.argv.slice(2).includes("public");
const BIND_HOST = IS_PUBLIC_MODE ? "0.0.0.0" : "127.0.0.1";

function loadDefaults() {
  const fallbackDefaults = {
    mode: "broadcast",
    targetHost: detectBroadcastAddress() || "255.255.255.255",
    targetPort: 3000,
    multicastTtl: 1,
    listenPort: 3000,
    heartbeatDelayMs: 1000,
    exerciseId: 1,
    siteId: 1,
    applicationId: 1,
    entityId: 1,
    forceId: 1,
    marking: "Tester0",
    entityType: {
      entityKind: 1,
      domain: 1,
      country: 225,
      category: 1,
      subcategory: 1,
      specific: 3,
      extra: 0
    },
    originLat: 41.015137,
    originLon: 28.97953,
    originAlt: 30,
    startUp: 50,
    moveSpeed: 25,
    turnSpeed: 70,
    sendRate: 15,
    verticalSpeed: 15
  };

  try {
    const raw = fs.readFileSync(DEFAULTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const targetHost = parsed.targetHost === "auto" || !parsed.targetHost
      ? (detectBroadcastAddress() || fallbackDefaults.targetHost)
      : parsed.targetHost;

    return {
      ...fallbackDefaults,
      ...parsed,
      targetHost,
      entityType: {
        ...fallbackDefaults.entityType,
        ...(parsed.entityType || {})
      }
    };
  } catch (error) {
    return fallbackDefaults;
  }
}

const runtimeState = {
  logs: [],
  listener: null,
  listenerPort: null,
  recentSentPackets: new Map(),
  receivedEntities: new Map(),
  recording: null,
  replays: new Map(),
  defaults: loadDefaults()
};

function addLog(type, message, extra = {}) {
  runtimeState.logs.push({
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    type,
    message,
    extra
  });

  if (runtimeState.logs.length > MAX_LOG_ENTRIES) {
    runtimeState.logs.splice(0, runtimeState.logs.length - MAX_LOG_ENTRIES);
  }
}

function escapeSummaryNumber(value) {
  return typeof value === "number" ? Number(value.toFixed(3)) : value;
}

function buildPacketSummary(payload) {
  const clientState = payload.clientState || {};
  return {
    marking: payload.marking || "Tester0",
    entityId: Number(payload.entityId || 0),
    exerciseId: Number(payload.exerciseId || 0),
    siteId: Number(payload.siteId || 0),
    applicationId: Number(payload.applicationId || 0),
    forceId: Number(payload.forceId || 0),
    mode: payload.mode || runtimeState.defaults.mode,
    targetHost: payload.targetHost || runtimeState.defaults.targetHost,
    targetPort: Number(payload.targetPort || runtimeState.defaults.targetPort),
    entityType: payload.entityType || {},
    ecef: {
      x: escapeSummaryNumber(Number(payload.ecefX || 0)),
      y: escapeSummaryNumber(Number(payload.ecefY || 0)),
      z: escapeSummaryNumber(Number(payload.ecefZ || 0))
    },
    orientationDegrees: {
      yaw: escapeSummaryNumber(Number(clientState.yawDeg || 0)),
      pitch: escapeSummaryNumber(Number(clientState.pitchDeg || 0)),
      roll: escapeSummaryNumber(Number(clientState.rollDeg || 0))
    },
    velocityEnu: {
      east: escapeSummaryNumber(Number(clientState.velocityEast || 0)),
      north: escapeSummaryNumber(Number(clientState.velocityNorth || 0)),
      up: escapeSummaryNumber(Number(clientState.velocityUp || 0))
    },
    localState: {
      east: escapeSummaryNumber(Number(clientState.localEast || 0)),
      north: escapeSummaryNumber(Number(clientState.localNorth || 0)),
      up: escapeSummaryNumber(Number(clientState.localUp || 0))
    },
    appearance: Number(payload.appearance || 0),
    deadReckoningAlgorithm: Number(payload.deadReckoningAlgorithm || 0)
  };
}

function ensureReplaysDir() {
  fs.mkdirSync(REPLAYS_DIR, { recursive: true });
}

function sanitizeReplayName(name) {
  return String(name || "")
    .replace(/\.replay$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function listReplayFiles() {
  ensureReplaysDir();
  return fs.readdirSync(REPLAYS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".replay"))
    .map((entry) => {
      const fullPath = path.join(REPLAYS_DIR, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        fileName: entry.name,
        modifiedAt: stats.mtime.toISOString(),
        size: stats.size
      };
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));
}

function getNextReplayFileName() {
  const files = listReplayFiles().map((entry) => entry.fileName);
  let index = 1;
  while (files.includes(`replay_${index}.replay`)) {
    index += 1;
  }
  return `replay_${index}.replay`;
}

function startRecording() {
  if (runtimeState.recording) {
    throw new Error("A recording is already in progress");
  }

  runtimeState.recording = {
    startedAt: Date.now(),
    entries: []
  };
  addLog("info", "Replay recording started");
}

function stopRecording(fileName) {
  if (!runtimeState.recording) {
    throw new Error("No active recording to stop");
  }

  ensureReplaysDir();
  const safeBaseName = sanitizeReplayName(fileName) || getNextReplayFileName().replace(/\.replay$/i, "");
  const finalFileName = `${safeBaseName}.replay`;
  const finalPath = path.join(REPLAYS_DIR, finalFileName);
  const recordingToSave = runtimeState.recording;
  runtimeState.recording = null;

  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    packetCount: recordingToSave.entries.length,
    entries: recordingToSave.entries
  };

  fs.writeFileSync(finalPath, JSON.stringify(payload, null, 2));
  addLog("info", `Replay saved to ${finalFileName} (${recordingToSave.entries.length} packets)`);
  return finalFileName;
}

function stopReplay(entityKey = null) {
  if (entityKey == null) {
    for (const activeEntityKey of Array.from(runtimeState.replays.keys())) {
      stopReplay(activeEntityKey);
    }
    return;
  }

  const replayState = runtimeState.replays.get(String(entityKey));
  if (!replayState) {
    return;
  }

  for (const timerId of replayState.timers) {
    clearTimeout(timerId);
  }
  runtimeState.replays.delete(String(entityKey));
}

function recordSentPacket(packet, payload, result) {
  if (!runtimeState.recording || runtimeState.replays.size > 0 || payload.isReplay) {
    return;
  }

  runtimeState.recording.entries.push({
    delayMs: Date.now() - runtimeState.recording.startedAt,
    packetBase64: packet.toString("base64"),
    summary: buildPacketSummary(payload),
    transport: {
      mode: result.mode,
      targetHost: result.targetHost,
      targetPort: result.targetPort,
      multicastTtl: Number(payload.multicastTtl || runtimeState.defaults.multicastTtl)
    }
  });
}

function loadReplay(fileName) {
  ensureReplaysDir();
  const safeFileName = path.basename(fileName || "");
  if (!safeFileName.toLowerCase().endsWith(".replay")) {
    throw new Error("Replay file must end with .replay");
  }

  const replayPath = path.join(REPLAYS_DIR, safeFileName);
  if (!fs.existsSync(replayPath)) {
    throw new Error("Replay file not found");
  }

  const raw = fs.readFileSync(replayPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Replay file is invalid");
  }

  return {
    fileName: safeFileName,
    entries: parsed.entries
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getReplayStatusPayload() {
  return {
    replayFiles: listReplayFiles(),
    recordingActive: Boolean(runtimeState.recording),
    replayActive: runtimeState.replays.size > 0,
    activeReplayFile: runtimeState.replays.values().next().value?.fileName || null,
    activeReplayEntityKeys: Array.from(runtimeState.replays.keys())
  };
}

function getStatePayload() {
  return {
    ok: true,
    defaults: runtimeState.defaults,
    listenerPort: runtimeState.listenerPort,
    logs: runtimeState.logs,
    receivedEntities: Array.from(runtimeState.receivedEntities.values()),
    ...getReplayStatusPayload()
  };
}

function sendError(res, statusCode, error, logMessage = null, extra = {}) {
  if (logMessage) {
    addLog("error", `${logMessage}: ${error.message}`, extra);
  }
  sendJson(res, statusCode, { ok: false, error: error.message });
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, part) => ((acc << 8) >>> 0) + Number(part), 0) >>> 0;
}

function intToIp(intValue) {
  return [
    (intValue >>> 24) & 255,
    (intValue >>> 16) & 255,
    (intValue >>> 8) & 255,
    intValue & 255
  ].join(".");
}

function detectBroadcastAddress() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (
        entry.family !== "IPv4" ||
        entry.internal ||
        !entry.address ||
        !entry.netmask
      ) {
        continue;
      }

      const address = ipToInt(entry.address);
      const netmask = ipToInt(entry.netmask);
      const broadcast = (address | (~netmask >>> 0)) >>> 0;
      return intToIp(broadcast);
    }
  }

  return null;
}

function detectLanAddress() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        entry.address
      ) {
        return entry.address;
      }
    }
  }

  return null;
}

function writeFloat32BE(buffer, value, offset) {
  buffer.writeFloatBE(Number(value || 0), offset);
  return offset + 4;
}

function writeFloat64BE(buffer, value, offset) {
  buffer.writeDoubleBE(Number(value || 0), offset);
  return offset + 8;
}

function writeEntityId(buffer, site, application, entity, offset) {
  buffer.writeUInt16BE(site, offset);
  buffer.writeUInt16BE(application, offset + 2);
  buffer.writeUInt16BE(entity, offset + 4);
  return offset + 6;
}

function writeEntityType(buffer, entityType, offset) {
  buffer.writeUInt8(entityType.entityKind ?? 1, offset);
  buffer.writeUInt8(entityType.domain ?? 1, offset + 1);
  buffer.writeUInt16BE(entityType.country ?? 225, offset + 2);
  buffer.writeUInt8(entityType.category ?? 1, offset + 4);
  buffer.writeUInt8(entityType.subcategory ?? 1, offset + 5);
  buffer.writeUInt8(entityType.specific ?? 3, offset + 6);
  buffer.writeUInt8(entityType.extra ?? 0, offset + 7);
  return offset + 8;
}

function writeRelativeDisTimestamp(buffer, date, offset) {
  const now = date instanceof Date ? date : new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();
  const timeSeconds = milliseconds / 1000 + seconds + minutes * 60;
  const timeConversion = 3600 / 2147483648;
  let timestamp = Math.floor(timeSeconds / timeConversion);
  timestamp = (timestamp << 1) | 1;
  buffer.writeUInt32BE(timestamp >>> 0, offset);
  return offset + 4;
}

function writeMarking(buffer, marking, offset) {
  const text = String(marking || "Tester0").slice(0, 11);
  buffer.writeUInt8(1, offset);
  buffer.fill(0, offset + 1, offset + 12);
  buffer.write(text, offset + 1, "ascii");
  return offset + 12;
}

function writeOtherParameters(buffer, state, offset) {
  const algorithm = Number(state.deadReckoningAlgorithm ?? 1);
  const psi = Number(state.psi || 0);
  const theta = Number(state.theta || 0);
  const phi = Number(state.phi || 0);

  if ([3, 4, 7, 8].includes(algorithm)) {
    buffer.writeUInt8(2, offset);

    const cosPsiHalf = Math.cos(psi / 2);
    const cosThetaHalf = Math.cos(theta / 2);
    const cosPhiHalf = Math.cos(phi / 2);
    const sinPsiHalf = Math.sin(psi / 2);
    const sinThetaHalf = Math.sin(theta / 2);
    const sinPhiHalf = Math.sin(phi / 2);

    let qu0 = cosPsiHalf * cosThetaHalf * cosPhiHalf + sinPsiHalf * sinThetaHalf * sinPhiHalf;
    let qux = cosPsiHalf * cosThetaHalf * sinPhiHalf - sinPsiHalf * sinThetaHalf * cosPhiHalf;
    let quy = cosPsiHalf * sinThetaHalf * cosPhiHalf + sinPsiHalf * cosThetaHalf * sinPhiHalf;
    let quz = sinPsiHalf * cosThetaHalf * cosPhiHalf - cosPsiHalf * sinThetaHalf * sinPhiHalf;

    if (qu0 < 0) {
      qu0 *= -1;
      qux *= -1;
      quy *= -1;
      quz *= -1;
    }

    const finalQu0 = qu0 >= 1 ? 65535 : Math.trunc(qu0 * 65536);
    buffer.writeUInt16BE(finalQu0, offset + 1);
    buffer.writeFloatBE(qux, offset + 3);
    buffer.writeFloatBE(quy, offset + 7);
    buffer.writeFloatBE(quz, offset + 11);
    return offset + 15;
  }

  if ([1, 2, 5, 6, 9].includes(algorithm)) {
    buffer.writeUInt8(1, offset);
    buffer.writeUInt8(0, offset + 1);
    buffer.writeUInt8(0, offset + 2);
    buffer.writeFloatBE(psi, offset + 3);
    buffer.writeFloatBE(theta, offset + 7);
    buffer.writeFloatBE(phi, offset + 11);
    return offset + 15;
  }

  buffer.fill(0, offset, offset + 15);
  return offset + 15;
}

function buildEntityStatePdu(state) {
  const articulationCount = 0;
  const length = 144 + articulationCount * 16;
  const buffer = Buffer.alloc(length);

  let offset = 0;

  buffer.writeUInt8(6, offset++);
  buffer.writeUInt8(state.exerciseId ?? 1, offset++);
  buffer.writeUInt8(1, offset++);
  buffer.writeUInt8(1, offset++);
  offset = writeRelativeDisTimestamp(buffer, new Date(), offset);
  buffer.writeUInt16BE(length, offset);
  offset += 2;
  buffer.writeUInt16BE(0, offset);
  offset += 2;

  offset = writeEntityId(
    buffer,
    state.siteId ?? 1,
    state.applicationId ?? 1,
    state.entityId ?? 1,
    offset
  );

  buffer.writeUInt8(state.forceId ?? 1, offset++);
  buffer.writeUInt8(articulationCount, offset++);

  offset = writeEntityType(buffer, state.entityType || {}, offset);
  offset = writeEntityType(buffer, state.alternativeEntityType || state.entityType || {}, offset);

  offset = writeFloat32BE(buffer, state.velocityX, offset);
  offset = writeFloat32BE(buffer, state.velocityY, offset);
  offset = writeFloat32BE(buffer, state.velocityZ, offset);

  offset = writeFloat64BE(buffer, state.ecefX, offset);
  offset = writeFloat64BE(buffer, state.ecefY, offset);
  offset = writeFloat64BE(buffer, state.ecefZ, offset);

  offset = writeFloat32BE(buffer, state.psi, offset);
  offset = writeFloat32BE(buffer, state.theta, offset);
  offset = writeFloat32BE(buffer, state.phi, offset);

  buffer.writeUInt32BE((state.appearance ?? 0) >>> 0, offset);
  offset += 4;

  buffer.writeUInt8(state.deadReckoningAlgorithm ?? 1, offset++);
  offset = writeOtherParameters(buffer, state, offset);

  offset = writeFloat32BE(buffer, state.accelerationX, offset);
  offset = writeFloat32BE(buffer, state.accelerationY, offset);
  offset = writeFloat32BE(buffer, state.accelerationZ, offset);
  offset = writeFloat32BE(buffer, state.angularVelocityX, offset);
  offset = writeFloat32BE(buffer, state.angularVelocityY, offset);
  offset = writeFloat32BE(buffer, state.angularVelocityZ, offset);

  offset = writeMarking(buffer, state.marking, offset);
  buffer.writeUInt32BE((state.capabilities ?? 0) >>> 0, offset);

  return buffer;
}

function packetSignature(buffer) {
  return buffer.toString("hex");
}

function parseEntityStatePdu(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 144) {
    return null;
  }

  const protocolVersion = buffer.readUInt8(0);
  const pduType = buffer.readUInt8(2);
  const protocolFamily = buffer.readUInt8(3);
  if (protocolVersion !== 6 || pduType !== 1) {
    return null;
  }

  const siteId = buffer.readUInt16BE(12);
  const applicationId = buffer.readUInt16BE(14);
  const entityId = buffer.readUInt16BE(16);
  const forceId = buffer.readUInt8(18);

  const entityType = {
    entityKind: buffer.readUInt8(20),
    domain: buffer.readUInt8(21),
    country: buffer.readUInt16BE(22),
    category: buffer.readUInt8(24),
    subcategory: buffer.readUInt8(25),
    specific: buffer.readUInt8(26),
    extra: buffer.readUInt8(27)
  };

  const velocity = {
    x: buffer.readFloatBE(36),
    y: buffer.readFloatBE(40),
    z: buffer.readFloatBE(44)
  };

  const ecef = {
    x: buffer.readDoubleBE(48),
    y: buffer.readDoubleBE(56),
    z: buffer.readDoubleBE(64)
  };

  const orientation = {
    psi: buffer.readFloatBE(72),
    theta: buffer.readFloatBE(76),
    phi: buffer.readFloatBE(80)
  };

  const appearance = buffer.readUInt32BE(84);
  const deadReckoningAlgorithm = buffer.readUInt8(88);

  const markingCharset = buffer.readUInt8(128);
  const markingRaw = buffer.subarray(129, 140);
  const nullIndex = markingRaw.indexOf(0);
  const markingBytes = nullIndex >= 0 ? markingRaw.subarray(0, nullIndex) : markingRaw;
  const marking = markingBytes.toString("ascii").trim();
  const capabilities = buffer.readUInt32BE(140);

  return {
    protocolVersion,
    pduType,
    protocolFamily,
    siteId,
    applicationId,
    entityId,
    forceId,
    entityType,
    velocity,
    ecef,
    orientation,
    appearance,
    deadReckoningAlgorithm,
    markingCharset,
    marking,
    capabilities,
    lastSeenAt: new Date().toISOString(),
    entityKey: `${siteId}:${applicationId}:${entityId}`
  };
}

function pruneReceivedEntities() {
  const cutoff = Date.now() - 60_000;
  for (const [entityKey, entityState] of runtimeState.receivedEntities.entries()) {
    const seenAt = Date.parse(entityState.lastSeenAt || 0);
    if (!Number.isFinite(seenAt) || seenAt < cutoff) {
      runtimeState.receivedEntities.delete(entityKey);
    }
  }
}

function pruneRecentSent() {
  const cutoff = Date.now() - 3000;
  for (const [key, value] of runtimeState.recentSentPackets.entries()) {
    if (value < cutoff) {
      runtimeState.recentSentPackets.delete(key);
    }
  }
}

async function sendUdpPacket(packet, payload) {
  const socket = dgram.createSocket("udp4");
  const mode = payload.mode || "broadcast";
  const targetHost = payload.targetHost || runtimeState.defaults.targetHost;
  const targetPort = Number(payload.targetPort || runtimeState.defaults.targetPort);

  return new Promise((resolve, reject) => {
    socket.on("error", reject);

    const finishSend = (resolvedMode) => {
      socket.send(packet, targetPort, targetHost, (error) => {
        socket.close();
        if (error) {
          reject(error);
          return;
        }
        resolve({ targetHost, targetPort, mode: resolvedMode });
      });
    };

    if (mode === "broadcast" || mode === "multicast") {
      socket.bind(() => {
        if (mode === "broadcast") {
          socket.setBroadcast(true);
        } else {
          socket.setMulticastTTL(Number(payload.multicastTtl || 1));
        }
        finishSend(mode);
      });
      return;
    }

    socket.send(packet, targetPort, targetHost, (error) => {
      socket.close();
      if (error) {
        reject(error);
        return;
      }
      resolve({ targetHost, targetPort, mode: "unicast" });
    });
  });
}

async function playReplay(fileName, entityKey) {
  const normalizedEntityKey = String(entityKey || "").trim();
  if (!normalizedEntityKey) {
    throw new Error("Replay entity key is required");
  }

  if (runtimeState.replays.has(normalizedEntityKey)) {
    throw new Error("A replay is already running for this entity");
  }

  const replay = loadReplay(fileName);
  const replayState = {
    active: true,
    entityKey: normalizedEntityKey,
    fileName: replay.fileName,
    timers: []
  };
  runtimeState.replays.set(normalizedEntityKey, replayState);

  addLog("info", `Replay started: ${replay.fileName}`, {
    pduType: "Replay",
    entityKey: normalizedEntityKey
  });

  if (replay.entries.length === 0) {
    addLog("info", `Replay finished: ${replay.fileName} (0 packets)`, {
      pduType: "Replay",
      entityKey: normalizedEntityKey
    });
    stopReplay(normalizedEntityKey);
    return;
  }

  return new Promise((resolve) => {
    let completed = 0;
    let lastProgressLogAt = 0;
    replay.entries.forEach((entry, index) => {
      const timerId = setTimeout(async () => {
        try {
          if (!runtimeState.replays.has(normalizedEntityKey)) {
            resolve();
            return;
          }
          const packet = Buffer.from(entry.packetBase64, "base64");
          const transport = entry.transport || {};
          const result = await sendUdpPacket(packet, transport);
          runtimeState.recentSentPackets.set(packetSignature(packet), Date.now());
          const now = Date.now();
          const isMilestone = index === 0 || index === replay.entries.length - 1 || ((index + 1) % 10 === 0);
          if (isMilestone || now - lastProgressLogAt >= 350) {
            lastProgressLogAt = now;
            addLog("send", `Replay progress ${index + 1}/${replay.entries.length} to ${result.targetHost}:${result.targetPort} via ${result.mode}`, {
              bytes: packet.length,
              replay: replay.fileName,
              pduType: "Replay",
              entityKey: normalizedEntityKey,
              summary: entry.summary || {}
            });
          }
        } catch (error) {
          addLog("error", `Replay packet ${index + 1} failed: ${error.message}`, {
            pduType: "Replay",
            entityKey: normalizedEntityKey
          });
        } finally {
          completed += 1;
          if (completed >= replay.entries.length) {
            addLog("info", `Replay finished: ${replay.fileName}`, {
              pduType: "Replay",
              entityKey: normalizedEntityKey
            });
            stopReplay(normalizedEntityKey);
            resolve();
          }
        }
      }, Number(entry.delayMs || 0));

      replayState.timers.push(timerId);
    });
  });
}

function stopListener() {
  if (!runtimeState.listener) {
    runtimeState.receivedEntities.clear();
    return;
  }

  runtimeState.listener.close();
  addLog("info", `Stopped UDP listener on port ${runtimeState.listenerPort}`);
  runtimeState.listener = null;
  runtimeState.listenerPort = null;
  runtimeState.receivedEntities.clear();
}

function startListener(port) {
  const targetPort = Number(port);
  if (!targetPort) {
    throw new Error("Invalid listen port");
  }

  if (runtimeState.listener && runtimeState.listenerPort === targetPort) {
    return;
  }

  stopListener();

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    pruneRecentSent();
    pruneReceivedEntities();
    const signature = packetSignature(msg);
    if (runtimeState.recentSentPackets.has(signature)) {
      return;
    }

    const parsedPdu = parseEntityStatePdu(msg);
    if (parsedPdu) {
      runtimeState.receivedEntities.set(parsedPdu.entityKey, {
        ...parsedPdu,
        from: `${rinfo.address}:${rinfo.port}`
      });
    }

    addLog("receive", `Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`, {
      bytes: msg.length,
      from: `${rinfo.address}:${rinfo.port}`,
      pduType: parsedPdu ? "EntityState" : "UDP",
      summary: parsedPdu ? {
        marking: parsedPdu.marking,
        entityId: parsedPdu.entityId,
        siteId: parsedPdu.siteId,
        applicationId: parsedPdu.applicationId,
        forceId: parsedPdu.forceId,
        entityType: parsedPdu.entityType,
        ecef: parsedPdu.ecef,
        orientationDegrees: {
          yaw: parsedPdu.orientation.psi * 180 / Math.PI,
          pitch: parsedPdu.orientation.theta * 180 / Math.PI,
          roll: parsedPdu.orientation.phi * 180 / Math.PI
        }
      } : undefined
    });
  });

  socket.on("error", (error) => {
    addLog("error", `UDP listener error: ${error.message}`);
  });

  socket.bind(targetPort, "0.0.0.0", () => {
    runtimeState.listener = socket;
    runtimeState.listenerPort = targetPort;
    addLog("info", `Listening for UDP on port ${targetPort}`);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    serveFile(res, path.join(STATIC_ROOT, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/api/state") {
    sendJson(res, 200, getStatePayload());
    return;
  }

  if (req.method === "GET" && req.url === "/api/replays") {
    sendJson(res, 200, { ok: true, ...getReplayStatusPayload() });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/replays/file") {
    try {
      const replay = loadReplay(requestUrl.searchParams.get("fileName"));
      sendJson(res, 200, { ok: true, replay });
    } catch (error) {
      sendError(res, 400, error);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/listener") {
    try {
      const payload = await readJson(req);
      if (payload.enabled === false) {
        stopListener();
        sendJson(res, 200, { ok: true, listenerPort: null });
        return;
      }

      startListener(payload.listenPort || runtimeState.defaults.listenPort);
      sendJson(res, 200, { ok: true, listenerPort: payload.listenPort || runtimeState.defaults.listenPort });
    } catch (error) {
      sendError(res, 500, error, "Listener setup failed");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/logs/clear") {
    runtimeState.logs = [];
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/replays/record/start") {
    try {
      startRecording();
      sendJson(res, 200, { ok: true, recordingActive: true });
    } catch (error) {
      sendError(res, 400, error, "Record start failed");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/replays/record/stop") {
    try {
      const payload = await readJson(req);
      const fileName = stopRecording(payload.fileName);
      sendJson(res, 200, { ok: true, fileName, recordingActive: false, replayFiles: listReplayFiles() });
    } catch (error) {
      sendError(res, 400, error, "Record stop failed");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/replays/play") {
    try {
      const payload = await readJson(req);
      playReplay(payload.fileName, payload.entityKey).catch((error) => {
        addLog("error", `Replay failed: ${error.message}`, {
          pduType: "Replay",
          entityKey: String(payload.entityKey || "")
        });
        stopReplay(payload.entityKey);
      });
      sendJson(res, 200, {
        ok: true,
        replayActive: true,
        entityKey: String(payload.entityKey || ""),
        activeReplayEntityKeys: Array.from(runtimeState.replays.keys())
      });
    } catch (error) {
      sendError(res, 400, error, "Replay failed", { pduType: "Replay" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/replays/stop") {
    const payload = await readJson(req);
    stopReplay(payload.entityKey);
    addLog("info", "Replay stopped", {
      pduType: "Replay",
      entityKey: String(payload.entityKey || "")
    });
    sendJson(res, 200, {
      ok: true,
      replayActive: runtimeState.replays.size > 0,
      activeReplayEntityKeys: Array.from(runtimeState.replays.keys())
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/entity-state") {
    try {
      const payload = await readJson(req);
      const packet = buildEntityStatePdu(payload);
      const result = await sendUdpPacket(packet, payload);
      runtimeState.recentSentPackets.set(packetSignature(packet), Date.now());
      recordSentPacket(packet, payload, result);
      addLog("send", `${payload.isReplay ? "Replay sent" : "Sent"} EntityState PDU to ${result.targetHost}:${result.targetPort} via ${result.mode}`, {
        bytes: packet.length,
        pduType: payload.isReplay ? "Replay" : "EntityState",
        replay: payload.replaySourceFile || undefined,
        entityKey: payload.replayEntityKey || undefined,
        summary: buildPacketSummary(payload)
      });
      sendJson(res, 200, { ok: true, bytes: packet.length });
    } catch (error) {
      sendError(res, 500, error, "Send failed");
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`DIS test web server is already running on port ${HTTP_PORT}`);
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

ensureReplaysDir();

server.listen(HTTP_PORT, BIND_HOST, () => {
  addLog("info", `Detected broadcast target ${runtimeState.defaults.targetHost}`);
  console.log(`DIS test web server running at http://127.0.0.1:${HTTP_PORT}`);

  if (IS_PUBLIC_MODE) {
    const lanAddress = detectLanAddress();
    if (lanAddress) {
      console.log(`LAN access enabled at http://${lanAddress}:${HTTP_PORT}`);
    } else {
      console.log(`LAN access enabled on port ${HTTP_PORT}, but no LAN IPv4 address was detected`);
    }
  }
});
