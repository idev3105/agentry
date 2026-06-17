//! Remote access server — serves the webapp + bridges WebSocket clients to the
//! existing daemon dispatch logic.
//!
//! Architecture:
//!   Tailnet client  ──WS──►  handle_ws_connection()  ──►  Server::dispatch()
//!                                                     ◄──  event broadcast
//!
//! The wire protocol (JSON-newline) is reused verbatim over WS text frames —
//! clients send the same `{"kind":"cmd",...}` they would over the Unix socket.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::process::Command;
use std::sync::Arc;

use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::services::ServeDir;
use tokio::sync::RwLock;

use agentry_wire::*;
use crate::server::Server;

// ── Tailscale CGNAT detection ────────────────────────────────────────────────

/// Detect the machine's Tailscale IPv4 (100.64.0.0/10, i.e. 100.64–127.x.x).
pub fn tailscale_ipv4() -> Option<Ipv4Addr> {
    #[cfg(unix)]
    {
        use nix::ifaddrs::getifaddrs;
        if let Ok(addrs) = getifaddrs() {
            for iface in addrs {
                if let Some(addr) = iface.address {
                    if let Some(sin) = addr.as_sockaddr_in() {
                        let ip = sin.ip();
                        if is_cgnat(ip) {
                            return Some(ip);
                        }
                    }
                }
            }
        }
    }
    None
}

fn is_cgnat(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..=127).contains(&o[1])
}

/// Try to get the Magic DNS hostname from `tailscale status --json`.
/// Returns something like `"my-machine.tail1234.ts.net"` (no trailing dot).
/// Falls back to `None` on any error so callers can use the raw IPv4 instead.
pub fn tailscale_magic_dns() -> Option<String> {
    let out = Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .ok()?;
    if !out.status.success() { return None; }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let dns = v.get("Self")?.get("DNSName")?.as_str()?;
    // Tailscale appends a trailing dot — strip it
    Some(dns.trim_end_matches('.').to_string())
}

/// Returns the SocketAddr to bind + the display address string (Magic DNS preferred).
/// Returns `None` if Tailscale interface is not present.
pub fn remote_info() -> Option<(SocketAddr, String)> {
    let ip = tailscale_ipv4()?;
    let bind = SocketAddr::new(IpAddr::V4(ip), 20200);
    let display = match tailscale_magic_dns() {
        Some(host) => format!("{host}:20200"),
        None => bind.to_string(),
    };
    Some((bind, display))
}

// ── Axum router ──────────────────────────────────────────────────────────────

pub async fn serve(
    server: Arc<Server>,
    static_dir: String,
    mut enabled_rx: tokio::sync::watch::Receiver<bool>,
) -> anyhow::Result<()> {
    loop {
        // Wait until enabled
        if !*enabled_rx.borrow() {
            // Block until the value changes to true
            loop {
                if enabled_rx.changed().await.is_err() { return Ok(()); }
                if *enabled_rx.borrow() { break; }
            }
        }

        let (bind, display_addr) = match crate::remote::remote_info() {
            Some(info) => info,
            None => {
                tracing::warn!("remote: no Tailscale interface found — remote server not started");
                // Wait for enabled toggle again (user might re-enable after installing Tailscale)
                loop {
                    if enabled_rx.changed().await.is_err() { return Ok(()); }
                    if *enabled_rx.borrow() { break; }
                }
                continue;
            }
        };

        let app = Router::new()
            .route("/ws", get(ws_handler))
            .nest_service("/", ServeDir::new(&static_dir))
            .with_state(server.clone());

        tracing::info!("remote: listening on http://{display_addr}");
        let listener = tokio::net::TcpListener::bind(bind).await?;

        // Run the server until disabled or it errors
        let mut enabled_rx2 = enabled_rx.clone();
        tokio::select! {
            res = axum::serve(listener, app) => {
                if let Err(e) = res {
                    tracing::warn!("remote server error: {e}");
                }
                return Ok(());
            }
            _ = async {
                loop {
                    if enabled_rx2.changed().await.is_err() { return; }
                    if !*enabled_rx2.borrow() { return; }
                }
            } => {
                tracing::info!("remote: disabled by user — stopping listener");
                // loop back to wait-for-enable
            }
        }
    }
}

// ── WebSocket handler ────────────────────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(server): State<Arc<Server>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, server))
}

async fn handle_ws_connection(mut socket: WebSocket, server: Arc<Server>) {
    let focused: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));

    // Subscribe to broadcast events BEFORE reading commands so we don't miss
    // any events that fire during command processing.
    let mut event_rx = server.subscribe_events();

    loop {
        tokio::select! {
            // ── Incoming WS frame (client → daemon) ──────────────────────
            msg = socket.recv() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break, // client disconnected
                };

                let text = match msg {
                    WsMessage::Text(t) => t,
                    WsMessage::Close(_) => break,
                    _ => continue, // ignore binary/ping/pong
                };

                let parse_result = serde_json::from_str::<Message>(text.trim());
                match parse_result {
                    Err(e) => {
                        let err = serde_json::json!({"v":1,"kind":"resp","id":"?","ok":false,"error":format!("parse_error: {e}")});
                        let _ = socket.send(WsMessage::Text(err.to_string())).await;
                    }
                    Ok(Message::Cmd(envelope)) => {
                        if envelope.v > WIRE_VERSION {
                            let err = serde_json::json!({"v":1,"kind":"resp","id":envelope.id,"ok":false,"error":"unsupported_version"});
                            let _ = socket.send(WsMessage::Text(err.to_string())).await;
                            continue;
                        }
                        let id = envelope.id.clone();
                        let result = server.dispatch(envelope, &focused).await;
                        let resp = build_resp_json(&id, result);
                        let _ = socket.send(WsMessage::Text(resp)).await;
                    }
                    Ok(_) => {} // ignore non-cmd (event/resp echoes)
                }
            }

            // ── Outgoing broadcast event (daemon → client) ───────────────
            event = event_rx.recv() => {
                match event {
                    Ok(ev) => {
                        // Mirror the same AgentOutput filter used by Unix connections.
                        if let Event::AgentOutput(ref ao) = ev {
                            let f = focused.read().await;
                            match f.as_ref() {
                                Some(sid) if sid == &ao.session_id => {}
                                _ => continue,
                            }
                        }
                        let line = match serde_json::to_string(&Message::Event(ev)) {
                            Ok(s) => s,
                            Err(_) => continue,
                        };
                        if socket.send(WsMessage::Text(line)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn build_resp_json(id: &str, result: Result<serde_json::Value, String>) -> String {
    let obj = match result {
        Ok(mut v) => {
            v["v"] = serde_json::json!(WIRE_VERSION);
            v["kind"] = serde_json::json!("resp");
            v["id"] = serde_json::json!(id);
            v
        }
        Err(e) => serde_json::json!({
            "v": WIRE_VERSION, "kind": "resp", "id": id, "ok": false, "error": e
        }),
    };
    obj.to_string()
}
