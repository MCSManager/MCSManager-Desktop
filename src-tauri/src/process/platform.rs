use std::process::{Command, Stdio};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn configure_command(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub fn kill_tree(pid: u32) {
    let pid_arg = pid.to_string();
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", pid_arg.as_str(), "/T", "/F"]);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new("kill");
        cmd.args(["-9", pid_arg.as_str()]);
        cmd
    };
    configure_command(&mut cmd);
    let _ = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Asks a process and its children to terminate gracefully before a forced
/// tree-kill is attempted: `taskkill /T` on Windows (no `/F`), `SIGTERM` on
/// Unix. This gives a well-behaved process the chance to release resources.
pub fn kill_tree_graceful(pid: u32) {
    let pid_arg = pid.to_string();
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", pid_arg.as_str(), "/T"]);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new("kill");
        cmd.args(["-TERM", pid_arg.as_str()]);
        cmd
    };
    configure_command(&mut cmd);
    let _ = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_millis_is_recent() {
        let expected = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_millis() as u64;
        let actual = now_millis();
        let drift = actual.abs_diff(expected);
        assert!(drift <= 5_000, "now_millis drift {}ms exceeds 5s", drift);
    }

    #[test]
    fn kill_tree_ignores_unknown_pid() {
        kill_tree(4_000_000_000);
    }

    #[test]
    fn kill_tree_graceful_ignores_unknown_pid() {
        kill_tree_graceful(4_000_000_000);
    }

    #[test]
    fn configure_command_does_not_panic() {
        let mut cmd = std::process::Command::new("unused-helper");
        configure_command(&mut cmd);
    }
}
