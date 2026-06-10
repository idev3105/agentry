#[cfg(unix)]
mod unix_impl {
    use agentry_wire::{encode, decode, Message, Cmd, CmdEnvelope, WIRE_VERSION};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;

    pub async fn run() -> anyhow::Result<()> {
        let args: Vec<String> = std::env::args().collect();
        let sock_path = std::env::var("AGENTRY_SOCK")
            .unwrap_or_else(|_| format!("{}/.agentry/daemon.sock", std::env::var("HOME").unwrap()));

        let stream = UnixStream::connect(&sock_path).await?;
        let (read_half, mut write_half) = stream.into_split();
        let mut reader = BufReader::new(read_half);

        let cmd_str = args.get(1).map(|s| s.as_str()).unwrap_or("list_projects");
        let cmd = match cmd_str {
            "list_projects" => Cmd::ListProjects,
            "list_profiles" => Cmd::ListProfiles,
            "get_settings"  => Cmd::GetSettings,
            other => {
                eprintln!("unknown command: {other}");
                std::process::exit(1);
            }
        };

        let envelope = Message::Cmd(CmdEnvelope {
            v: WIRE_VERSION,
            id: "c1".to_string(),
            cmd,
        });

        write_half.write_all(encode(&envelope)?.as_bytes()).await?;

        let mut line = String::new();
        reader.read_line(&mut line).await?;
        let msg = decode(&line)?;
        println!("{}", serde_json::to_string_pretty(&msg)?);

        Ok(())
    }
}

#[cfg(windows)]
mod windows_impl {
    pub async fn run() -> anyhow::Result<()> {
        eprintln!("agentry-cli: the daemon requires a Unix socket and is not supported on Windows yet");
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    #[cfg(unix)]
    { unix_impl::run().await }
    #[cfg(windows)]
    { windows_impl::run().await }
}
