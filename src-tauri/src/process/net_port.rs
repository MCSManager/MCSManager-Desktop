//! Cross-platform helpers to detect and terminate the process that is listening
//! on a local TCP port. Used by the startup guard that frees a port before a
//! managed service is (re)started.

use std::process::Command;
use std::time::{Duration, Instant};

use super::platform;

/// How long to wait for a terminated process to release its port.
const PORT_RELEASE_TIMEOUT: Duration = Duration::from_secs(3);
/// Poll interval while waiting for a port to be released.
const PORT_POLL_INTERVAL: Duration = Duration::from_millis(150);

/// Runs a helper program with the platform's "no console window" flags so the
/// port probes and kills never flash a terminal window.
fn run_command(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    platform::configure_command(&mut cmd);
    cmd.output()
}

/// Result of probing a local TCP port for a listening process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortProbe {
    /// Nothing is listening on the port.
    Free,
    /// A process is listening on the port.
    Occupied(u32),
    /// No platform tool was available to determine the port state. Callers must
    /// fall back to the normal start path instead of blocking on a conflict.
    Unavailable,
}

/// Decides the probe outcome from a Windows `netstat` run. `None` means the
/// command could not be executed (for example, the binary is missing).
#[cfg(any(windows, test))]
fn probe_from_netstat(stdout: Option<&[u8]>, port: u16) -> PortProbe {
    match stdout {
        Some(stdout) => match parse_windows_netstat(&String::from_utf8_lossy(stdout), port) {
            Some(pid) => PortProbe::Occupied(pid),
            None => PortProbe::Free,
        },
        None => PortProbe::Unavailable,
    }
}

/// Decides the probe outcome from a Unix `lsof` run with a `fuser` fallback.
/// `None` means the command could not be executed. `lsof` is authoritative when
/// it runs; `fuser` is consulted only when `lsof` is unavailable.
#[cfg(any(unix, test))]
fn probe_from_lsof_fuser(
    lsof_stdout: Option<&[u8]>,
    fuser_stderr: Option<&[u8]>,
    port: u16,
) -> PortProbe {
    if let Some(stdout) = lsof_stdout {
        return match parse_lsof_t(&String::from_utf8_lossy(stdout)) {
            Some(pid) => PortProbe::Occupied(pid),
            None => PortProbe::Free,
        };
    }
    if let Some(stderr) = fuser_stderr {
        return match parse_fuser(&String::from_utf8_lossy(stderr), port) {
            Some(pid) => PortProbe::Occupied(pid),
            None => PortProbe::Free,
        };
    }
    PortProbe::Unavailable
}

/// Probes `port` for a listening process.
///
/// Windows parses `netstat -ano`; macOS/Linux use `lsof`, falling back to
/// `fuser` when `lsof` is unavailable. When the required tool cannot be run the
/// result is [`PortProbe::Unavailable`] so callers skip conflict handling.
pub fn probe_port(port: u16) -> PortProbe {
    #[cfg(windows)]
    {
        let stdout = run_command("netstat", &["-ano", "-p", "tcp"])
            .ok()
            .map(|output| output.stdout);
        probe_from_netstat(stdout.as_deref(), port)
    }
    #[cfg(unix)]
    {
        let lsof_arg = format!("-iTCP:{}", port);
        let lsof = run_command("lsof", &["-nP", &lsof_arg, "-sTCP:LISTEN", "-t"])
            .ok()
            .map(|output| output.stdout);
        let fuser = if lsof.is_none() {
            let fuser_arg = format!("{}/tcp", port);
            run_command("fuser", &[&fuser_arg])
                .ok()
                .map(|output| output.stderr)
        } else {
            None
        };
        probe_from_lsof_fuser(lsof.as_deref(), fuser.as_deref(), port)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = port;
        PortProbe::Unavailable
    }
}

/// The PID a conflict probe should act on: an occupied port held by a process
/// outside `protected`. Free and unavailable probes yield `None` so the caller
/// falls back to the normal start path.
pub fn conflict_occupant(probe: &PortProbe, protected: &[u32]) -> Option<u32> {
    match probe {
        PortProbe::Occupied(pid) if !protected.contains(pid) => Some(*pid),
        _ => None,
    }
}

/// The PID that termination should target. Free and unavailable probes yield
/// `None`, meaning "nothing to terminate; skip quietly".
pub fn occupant_to_terminate(probe: &PortProbe) -> Option<u32> {
    match probe {
        PortProbe::Occupied(pid) => Some(*pid),
        PortProbe::Free | PortProbe::Unavailable => None,
    }
}

/// Returns the PID of the process that is listening on `port`, if any. `None`
/// also covers the case where no platform tool is available.
pub fn find_port_listener(port: u16) -> Option<u32> {
    occupant_to_terminate(&probe_port(port))
}

/// Refuses to terminate `pid` when it is this process or belongs to `protected`.
pub fn ensure_killable(pid: u32, protected: &[u32]) -> Result<(), String> {
    if pid == 0 {
        return Err("no process id to terminate".to_string());
    }
    if pid == std::process::id() || protected.contains(&pid) {
        return Err(format!(
            "refusing to terminate protected process {}",
            pid
        ));
    }
    Ok(())
}

/// Terminates the process listening on `port`: graceful shutdown first, then a
/// forced tree-kill if the port is still held. `protected` PIDs are never
/// terminated. Free or undetectable ports are skipped quietly so the app falls
/// back to the normal start path; an error is returned only when a detected
/// occupant cannot be freed.
pub fn terminate_port_listener(port: u16, protected: &[u32]) -> Result<(), String> {
    let Some(pid) = occupant_to_terminate(&probe_port(port)) else {
        return Ok(());
    };
    ensure_killable(pid, protected)?;
    platform::kill_tree_graceful(pid);
    if wait_for_port_release(port) {
        return Ok(());
    }
    platform::kill_tree(pid);
    if wait_for_port_release(port) {
        return Ok(());
    }
    Err(format!(
        "port {} is still in use after terminating process {}",
        port, pid
    ))
}

fn wait_for_port_release(port: u16) -> bool {
    let deadline = Instant::now() + PORT_RELEASE_TIMEOUT;
    loop {
        match probe_port(port) {
            PortProbe::Free | PortProbe::Unavailable => return true,
            PortProbe::Occupied(_) => {}
        }
        if Instant::now() >= deadline {
            return !matches!(probe_port(port), PortProbe::Occupied(_));
        }
        std::thread::sleep(PORT_POLL_INTERVAL);
    }
}

fn local_port(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.parse().ok()
}

/// Parses Windows `netstat -ano` output for the PID listening on `port`.
pub fn parse_windows_netstat(output: &str, port: u16) -> Option<u32> {
    for line in output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 || !fields[0].eq_ignore_ascii_case("tcp") {
            continue;
        }
        if !fields[3].eq_ignore_ascii_case("listening") {
            continue;
        }
        if local_port(fields[1]) == Some(port) {
            if let Ok(pid) = fields[4].parse::<u32>() {
                return Some(pid);
            }
        }
    }
    None
}

/// Parses `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` output for the first PID.
pub fn parse_lsof_t(output: &str) -> Option<u32> {
    output.lines().find_map(|line| line.trim().parse::<u32>().ok())
}

/// Parses `fuser <port>/tcp` output (printed on stderr) for the first PID.
pub fn parse_fuser(output: &str, port: u16) -> Option<u32> {
    let needle = format!("{}/tcp", port);
    for line in output.lines() {
        let Some((prefix, rest)) = line.split_once(':') else {
            continue;
        };
        if !prefix.trim().ends_with(&needle) {
            continue;
        }
        if let Some(pid) = rest.split_whitespace().find_map(|token| token.parse::<u32>().ok()) {
            return Some(pid);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    const NETSTAT_FIXTURE: &str = "\
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180
  TCP    0.0.0.0:23333          0.0.0.0:0              LISTENING       4321
  TCP    127.0.0.1:23333        127.0.0.1:55000        ESTABLISHED     8888
  TCP    0.0.0.0:233330         0.0.0.0:0              LISTENING       5555
  TCP    [::]:24444             [::]:0                 LISTENING       6789
  TCP    127.0.0.1:55000        127.0.0.1:45678        ESTABLISHED     9999
";

    fn wait_until(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + limit;
        loop {
            if condition() {
                return true;
            }
            if Instant::now() >= deadline {
                return condition();
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn pick_free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        listener.local_addr().expect("local addr").port()
    }

    fn spawn_node_listener(port: u16) -> std::process::Child {
        let code = format!(
            "const net=require('net');net.createServer().listen({},'127.0.0.1');setInterval(()=>{{}},1000);",
            port
        );
        let mut cmd = Command::new("node");
        cmd.args(["-e", &code])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd.spawn().expect("spawn node listener");
        // Give the child a moment so the port is bound before we look for it.
        std::thread::sleep(Duration::from_millis(200));
        child
    }

    #[test]
    fn parse_windows_netstat_finds_listening_pid_by_local_port() {
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 23333), Some(4321));
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 24444), Some(6789));
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 135), Some(1180));
    }

    #[test]
    fn parse_windows_netstat_ignores_foreign_ports_and_prefixes() {
        // 45678 only appears in the Foreign Address column; 55000 is an
        // ESTABLISHED local port (not a listener). Neither is an occupant.
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 45678), None);
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 55000), None);
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 2333), None);
        assert_eq!(parse_windows_netstat(NETSTAT_FIXTURE, 12345), None);
    }

    #[test]
    fn parse_lsof_t_returns_first_pid() {
        assert_eq!(parse_lsof_t("1234\n1234\n"), Some(1234));
        assert_eq!(parse_lsof_t(""), None);
        assert_eq!(parse_lsof_t("   \n"), None);
    }

    #[test]
    fn parse_fuser_returns_first_pid() {
        assert_eq!(parse_fuser("23333/tcp:            5678 5678\n", 23333), Some(5678));
        assert_eq!(parse_fuser("24444/tcp:            5678\n", 23333), None);
        assert_eq!(parse_fuser("", 23333), None);
    }

    #[test]
    fn ensure_killable_rejects_self_and_protected() {
        assert!(ensure_killable(std::process::id(), &[]).is_err());
        assert!(ensure_killable(1234, &[1234]).is_err());
        assert!(ensure_killable(0, &[]).is_err());
        assert!(ensure_killable(1234, &[9999]).is_ok());
    }

    #[test]
    fn terminate_rejects_protected_listener() {
        let port = pick_free_port();
        let mut child = spawn_node_listener(port);
        assert!(
            wait_until(Duration::from_secs(5), || find_port_listener(port).is_some()),
            "node listener must be detectable on port {}",
            port
        );
        let pid = find_port_listener(port).expect("listener pid");
        let result = terminate_port_listener(port, &[pid]);
        assert!(result.is_err(), "protected listener must not be killed");
        assert!(
            find_port_listener(port).is_some(),
            "protected listener must still be running"
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn find_and_terminate_real_listener() {
        let port = pick_free_port();
        let mut child = spawn_node_listener(port);
        let found = wait_until(Duration::from_secs(5), || {
            find_port_listener(port).is_some()
        });
        assert!(
            found,
            "node listener must be detectable on port {}",
            port
        );
        let pid = find_port_listener(port).expect("listener pid");
        assert_ne!(
            pid,
            std::process::id(),
            "the listener must not be this test process"
        );

        terminate_port_listener(port, &[]).expect("terminate listener");

        assert!(
            wait_until(Duration::from_secs(5), || find_port_listener(port).is_none()),
            "port {} must be released after termination",
            port
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn run_command_reports_missing_program() {
        assert!(run_command("mcsmanager-missing-command-xyz", &[]).is_err());
    }

    #[test]
    fn probe_port_reports_free_and_occupied() {
        assert_eq!(probe_port(pick_free_port()), PortProbe::Free);

        let port = pick_free_port();
        let mut child = spawn_node_listener(port);
        assert!(
            wait_until(Duration::from_secs(5), || matches!(
                probe_port(port),
                PortProbe::Occupied(_)
            )),
            "node listener must be detected on port {}",
            port
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn terminate_on_free_port_is_noop() {
        assert!(terminate_port_listener(pick_free_port(), &[]).is_ok());
    }

    #[test]
    fn conflict_occupant_skips_free_unavailable_and_protected() {
        assert_eq!(conflict_occupant(&PortProbe::Free, &[]), None);
        assert_eq!(
            conflict_occupant(&PortProbe::Unavailable, &[]),
            None,
            "an unavailable probe must not be treated as a conflict"
        );
        assert_eq!(conflict_occupant(&PortProbe::Occupied(7), &[]), Some(7));
        assert_eq!(conflict_occupant(&PortProbe::Occupied(7), &[7]), None);
    }

    #[test]
    fn occupant_to_terminate_skips_free_and_unavailable() {
        assert_eq!(occupant_to_terminate(&PortProbe::Free), None);
        assert_eq!(
            occupant_to_terminate(&PortProbe::Unavailable),
            None,
            "an unavailable probe must not trigger any termination"
        );
        assert_eq!(occupant_to_terminate(&PortProbe::Occupied(9)), Some(9));
    }

    #[test]
    fn probe_from_netstat_maps_absent_command_to_unavailable() {
        assert_eq!(probe_from_netstat(None, 23333), PortProbe::Unavailable);
    }

    #[test]
    fn probe_from_netstat_maps_output_to_occupied_or_free() {
        assert_eq!(
            probe_from_netstat(Some(NETSTAT_FIXTURE.as_bytes()), 23333),
            PortProbe::Occupied(4321)
        );
        assert_eq!(
            probe_from_netstat(Some(NETSTAT_FIXTURE.as_bytes()), 9999),
            PortProbe::Free
        );
    }

    #[test]
    fn probe_from_lsof_prefers_lsof_over_fuser() {
        // lsof ran and reported nothing: fuser must be ignored even if it lists
        // a pid, and an lsof hit wins outright.
        assert_eq!(
            probe_from_lsof_fuser(Some(b"".as_slice()), Some(b"23333/tcp: 42\n".as_slice()), 23333),
            PortProbe::Free
        );
        assert_eq!(
            probe_from_lsof_fuser(Some(b"42\n".as_slice()), None, 23333),
            PortProbe::Occupied(42)
        );
    }

    #[test]
    fn probe_from_lsof_falls_back_to_fuser() {
        assert_eq!(
            probe_from_lsof_fuser(None, Some(b"23333/tcp: 42\n".as_slice()), 23333),
            PortProbe::Occupied(42)
        );
        assert_eq!(
            probe_from_lsof_fuser(None, Some(b"24444/tcp: 42\n".as_slice()), 23333),
            PortProbe::Free
        );
    }

    #[test]
    fn probe_from_lsof_unavailable_when_both_commands_missing() {
        assert_eq!(
            probe_from_lsof_fuser(None, None, 23333),
            PortProbe::Unavailable
        );
    }
}
