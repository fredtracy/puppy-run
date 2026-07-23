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

function wireConnection(connection) {
  conn = connection;
  connection.on('open', () => connectHandler());
  connection.on('data', (data) => messageHandler(data));
  connection.on('close', () => disconnectHandler());
  connection.on('error', (err) => errorHandler(err));
}

// Host side: generate a short-lived Peer ID (the "join code") and wait for
// someone to connect to it.
export function hostGame() {
  peer = new Peer();
  peer.on('open', (id) => openHandler(id));
  peer.on('connection', (connection) => wireConnection(connection));
  peer.on('error', (err) => errorHandler(err));
}

// Join side: connect directly to a host's Peer ID.
export function joinGame(hostId) {
  peer = new Peer();
  peer.on('open', () => {
    const connection = peer.connect(hostId.trim());
    wireConnection(connection);
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
