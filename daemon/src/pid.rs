use std::fs;

const PID_FILE: &str = "daemon.pid";

pub fn write(dir: &str, pid: u32) -> anyhow::Result<()> {
    let path = format!("{dir}/{PID_FILE}");
    fs::write(&path, pid.to_string())?;
    Ok(())
}

pub fn read(dir: &str) -> Option<u32> {
    let path = format!("{dir}/{PID_FILE}");
    fs::read_to_string(&path).ok()?.trim().parse().ok()
}

pub fn cleanup(dir: &str) {
    let _ = fs::remove_file(format!("{dir}/{PID_FILE}"));
    let _ = fs::remove_file(format!("{dir}/daemon.sock"));
}

pub fn is_running(dir: &str) -> bool {
    if let Some(pid) = read(dir) {
        // kill -0: check process exists
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            None,
        ).is_ok()
    } else {
        false
    }
}
