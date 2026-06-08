// Async Unix-socket client to the daemon.
//
// Provides a Connection handle the rest of the app uses to send commands and
// register pending RPC waiters. Outgoing writes are serialized through a
// tokio mpsc; the read loop lives in `relay.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, Mutex};

pub type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>;

#[derive(Clone)]
pub struct Connection {
    pub send_tx: mpsc::Sender<String>,
    pub pending: Pending,
}

pub struct ReadSide {
    pub reader: BufReader<OwnedReadHalf>,
    pub pending: Pending,
}

pub async fn connect(sock_path: &str) -> anyhow::Result<(Connection, ReadSide)> {
    let stream = UnixStream::connect(sock_path).await?;
    let (read_half, write_half) = stream.into_split();

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let (send_tx, send_rx) = mpsc::channel::<String>(256);
    spawn_writer(write_half, send_rx);

    Ok((
        Connection { send_tx, pending: pending.clone() },
        ReadSide { reader: BufReader::new(read_half), pending },
    ))
}

fn spawn_writer(mut write_half: OwnedWriteHalf, mut rx: mpsc::Receiver<String>) {
    tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if write_half.write_all(line.as_bytes()).await.is_err() {
                tracing::warn!("socket write failed — daemon gone?");
                break;
            }
        }
    });
}

impl Connection {
    /// Send a raw JSON line (must already include its own newline-or-not).
    pub async fn send_line(&self, mut line: String) -> anyhow::Result<()> {
        if !line.ends_with('\n') {
            line.push('\n');
        }
        self.send_tx
            .send(line)
            .await
            .map_err(|_| anyhow::anyhow!("daemon writer channel closed"))
    }

    /// Send a command and await its matching response (matched by id).
    pub async fn rpc(&self, id: String, line: String) -> anyhow::Result<serde_json::Value> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);

        if let Err(e) = self.send_line(line).await {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }

        // 30s ceiling — daemon should answer fast; longer hang is a bug.
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(_)) => anyhow::bail!("response channel cancelled"),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                anyhow::bail!("rpc timeout: id={id}")
            }
        }
    }
}
