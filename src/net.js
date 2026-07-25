import { Peer } from 'peerjs';

// A thin wrapper around PeerJS: one WebRTC data connection between exactly
// two browsers, no server of our own to host. PeerJS's free public broker
// is only used for the initial handshake (exchanging connection info) —
// once `open` fires below, game data flows directly peer-to-peer.
let peer = null;
let conn = null;

let messageHandler = () => {};
let openHandler = () => {};
let connectHandler = () => {};
let disconnectHandler = () => {};
let errorHandler = () => {};
let signalingLostHandler = () => {};

export function onMessage(cb) {
  messageHandler = cb;
}
export function onHostReady(cb) {
  openHandler = cb;
}
export function onPeerConnected(cb) {
  connectHandler = cb;
}
export function onPeerDisconnected(cb) {
  disconnectHandler = cb;
}
export function onPeerError(cb) {
  errorHandler = cb;
}
// Fired when the signaling link to PeerJS's broker drops *before* the
// actual peer-to-peer connection exists yet — the common case being a
// mobile browser tab getting suspended while its owner is off sharing the
// join code in another app. Once the real WebRTC data connection is up,
// this link isn't needed anymore and losing it doesn't matter.
export function onSignalingLost(cb) {
  signalingLostHandler = cb;
}

function wireConnection(connection) {
  conn = connection;
  connection.on('open', () => connectHandler());
  connection.on('data', (data) => messageHandler(data));
  connection.on('close', () => disconnectHandler());
  connection.on('error', (err) => errorHandler(err));
}

// Only meaningful pre-connection (see the `conn` guard) — once the real
// data connection exists there's nothing left for the signaling link to
// do, so a drop there doesn't need recovering.
function tryReconnectSignaling() {
  if (peer && !peer.destroyed && peer.disconnected && !conn) {
    peer.reconnect();
  }
}

// A dropped signaling connection doesn't always fire its own event
// promptly on a backgrounded tab — checking again the moment the tab
// becomes visible catches the case where it silently died while hidden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tryReconnectSignaling();
});

// Host side: generate a short-lived Peer ID (the "join code") and wait for
// someone to connect to it.
export function hostGame() {
  peer = new Peer();
  peer.on('open', (id) => openHandler(id));
  peer.on('connection', (connection) => wireConnection(connection));
  peer.on('disconnected', () => {
    signalingLostHandler();
    tryReconnectSignaling();
  });
  peer.on('error', (err) => errorHandler(err));
}

// Join side: connect directly to a host's Peer ID.
export function joinGame(hostId) {
  peer = new Peer();
  peer.on('open', () => {
    // A reconnect re-fires 'open' with the same id — only actually dial
    // out the first time, or a signaling hiccup mid-connect would fire off
    // a second, redundant peer.connect() on top of the first.
    if (conn) return;
    const connection = peer.connect(hostId.trim());
    wireConnection(connection);
  });
  peer.on('disconnected', () => {
    signalingLostHandler();
    tryReconnectSignaling();
  });
  peer.on('error', (err) => errorHandler(err));
}

export function send(data) {
  if (conn && conn.open) conn.send(data);
}

export function isConnected() {
  return !!(conn && conn.open);
}

export function disconnect() {
  if (conn) conn.close();
  if (peer) peer.destroy();
  conn = null;
  peer = null;
}
