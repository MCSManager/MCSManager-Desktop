use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use super::events::{
    EventSink, OutputStream, ProcessEvent, ProcessSpec, ServiceState, ServiceStatus,
};
use super::platform;

#[derive(Debug)]
pub enum ProcessError {
    NotFound(String),
    Duplicate(String),
    InvalidState(String),
    Spawn(String),
    Io(String),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessError::NotFound(message)
            | ProcessError::Duplicate(message)
            | ProcessError::InvalidState(message)
            | ProcessError::Spawn(message)
            | ProcessError::Io(message) => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for ProcessError {}

struct ProcState {
    state: ServiceState,
    pid: Option<u32>,
    started_at: Option<u64>,
    exit_code: Option<i32>,
    error: Option<String>,
    stop_requested: bool,
}

pub struct ManagedProcess {
    spec: ProcessSpec,
    sink: EventSink,
    stop_timeout: Duration,
    shared: Arc<Mutex<ProcState>>,
    stdin: Option<ChildStdin>,
}

const POLL_INTERVAL: Duration = Duration::from_millis(25);
const KILL_GRACE: Duration = Duration::from_secs(5);
const FORCE_KILL_MESSAGE: &str = "Stop timeout exceeded; process tree was force-killed.";

fn lock_state(shared: &Mutex<ProcState>) -> MutexGuard<'_, ProcState> {
    shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn looks_like_script_path(arg: &str) -> bool {
    if arg.is_empty() {
        return false;
    }
    if arg.contains('/') || arg.contains('\\') {
        return true;
    }
    match Path::new(arg).extension().and_then(|ext| ext.to_str()) {
        Some(ext) => !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()),
        None => false,
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    id: String,
    stream: OutputStream,
    source: R,
    sink: EventSink,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut buffer: Vec<u8> = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    while matches!(buffer.last().copied(), Some(b'\n') | Some(b'\r')) {
                        buffer.pop();
                    }
                    let line = String::from_utf8_lossy(&buffer).into_owned();
                    sink(ProcessEvent::Output {
                        id: id.clone(),
                        stream,
                        line,
                        timestamp: platform::now_millis(),
                    });
                }
            }
        }
    });
}

fn supervise(mut child: Child, shared: Arc<Mutex<ProcState>>, sink: EventSink, id: String) {
    let code = child.wait().ok().and_then(|status| status.code());
    let final_status = {
        let mut state = lock_state(&shared);
        state.exit_code = code;
        if state.stop_requested {
            state.state = ServiceState::Stopped;
        } else {
            match code {
                Some(0) | None => {
                    state.state = ServiceState::Stopped;
                }
                Some(nonzero) => {
                    state.state = ServiceState::Error;
                    state.error = Some(format!("process exited with code {}", nonzero));
                }
            }
        }
        ServiceStatus {
            id,
            state: state.state,
            pid: state.pid,
            started_at: state.started_at,
            exit_code: state.exit_code,
            error: state.error.clone(),
        }
    };
    sink(ProcessEvent::Status(final_status));
}

impl ManagedProcess {
    pub fn new(spec: ProcessSpec, sink: EventSink, stop_timeout: Duration) -> Self {
        Self {
            spec,
            sink,
            stop_timeout,
            shared: Arc::new(Mutex::new(ProcState {
                state: ServiceState::Stopped,
                pid: None,
                started_at: None,
                exit_code: None,
                error: None,
                stop_requested: false,
            })),
            stdin: None,
        }
    }

    pub fn id(&self) -> &str {
        &self.spec.id
    }

    pub fn status(&self) -> ServiceStatus {
        let state = lock_state(&self.shared);
        ServiceStatus {
            id: self.spec.id.clone(),
            state: state.state,
            pid: state.pid,
            started_at: state.started_at,
            exit_code: state.exit_code,
            error: state.error.clone(),
        }
    }

    pub fn start(&mut self) -> Result<(), ProcessError> {
        {
            let state = lock_state(&self.shared);
            if matches!(
                state.state,
                ServiceState::Starting | ServiceState::Running | ServiceState::Stopping
            ) {
                return Err(ProcessError::InvalidState(format!(
                    "cannot start while state is {:?}",
                    state.state
                )));
            }
        }
        self.validate_paths()?;

        let mut command = Command::new(&self.spec.command);
        command
            .args(&self.spec.args)
            .current_dir(&self.spec.working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        platform::configure_command(&mut command);

        {
            let mut state = lock_state(&self.shared);
            state.state = ServiceState::Starting;
            state.pid = None;
            state.started_at = None;
            state.exit_code = None;
            state.error = None;
            state.stop_requested = false;
        }
        let starting_status = self.status();
        (self.sink)(ProcessEvent::Status(starting_status));

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(spawn_error) => {
                {
                    let mut state = lock_state(&self.shared);
                    state.state = ServiceState::Stopped;
                }
                let stopped_status = self.status();
                (self.sink)(ProcessEvent::Status(stopped_status));
                return Err(ProcessError::Spawn(format!(
                    "failed to spawn \"{}\": {}",
                    self.spec.command, spawn_error
                )));
            }
        };

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (stdin, stdout, stderr) = match (stdin, stdout, stderr) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            (stdin, stdout, stderr) => {
                drop(stdin);
                drop(stdout);
                drop(stderr);
                let _ = child.kill();
                let _ = child.wait();
                {
                    let mut state = lock_state(&self.shared);
                    state.state = ServiceState::Stopped;
                }
                let stopped_status = self.status();
                (self.sink)(ProcessEvent::Status(stopped_status));
                return Err(ProcessError::Io(format!(
                    "child stdio for \"{}\" was not piped",
                    self.spec.id
                )));
            }
        };

        let pid = child.id();
        let started_at = platform::now_millis();
        {
            let mut state = lock_state(&self.shared);
            state.state = ServiceState::Running;
            state.pid = Some(pid);
            state.started_at = Some(started_at);
            state.exit_code = None;
            state.error = None;
            state.stop_requested = false;
        }
        let running_status = self.status();
        (self.sink)(ProcessEvent::Status(running_status));

        let id = self.spec.id.clone();
        let reader_sink = Arc::clone(&self.sink);
        spawn_reader(
            id.clone(),
            OutputStream::Stdout,
            stdout,
            Arc::clone(&reader_sink),
        );
        spawn_reader(
            id.clone(),
            OutputStream::Stderr,
            stderr,
            Arc::clone(&reader_sink),
        );
        let supervise_sink = Arc::clone(&self.sink);
        let supervise_shared = Arc::clone(&self.shared);
        thread::spawn(move || supervise(child, supervise_shared, supervise_sink, id));

        self.stdin = Some(stdin);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), ProcessError> {
        let stopping_status = {
            let mut state = lock_state(&self.shared);
            if matches!(state.state, ServiceState::Stopped | ServiceState::Error) {
                return Ok(());
            }
            state.stop_requested = true;
            state.state = ServiceState::Stopping;
            ServiceStatus {
                id: self.spec.id.clone(),
                state: state.state,
                pid: state.pid,
                started_at: state.started_at,
                exit_code: state.exit_code,
                error: state.error.clone(),
            }
        };
        (self.sink)(ProcessEvent::Status(stopping_status));

        if let Some(stdin) = self.stdin.as_mut() {
            let _ = stdin.write_all(b"exit\n");
        }

        if self.wait_for_exit(self.stop_timeout) {
            return Ok(());
        }

        let pid = lock_state(&self.shared).pid;
        if let Some(pid) = pid {
            platform::kill_tree(pid);
        }
        (self.sink)(ProcessEvent::Output {
            id: self.spec.id.clone(),
            stream: OutputStream::Stderr,
            line: FORCE_KILL_MESSAGE.to_string(),
            timestamp: platform::now_millis(),
        });
        self.wait_for_exit(KILL_GRACE);
        Ok(())
    }

    fn validate_paths(&self) -> Result<(), ProcessError> {
        let working_dir = Path::new(&self.spec.working_dir);
        if !working_dir.is_dir() {
            return Err(ProcessError::Spawn(format!(
                "working directory is not an existing directory: {}",
                self.spec.working_dir
            )));
        }
        if let Some(script) = self.spec.args.last() {
            if looks_like_script_path(script) {
                let script_path = working_dir.join(script);
                if !script_path.is_file() {
                    return Err(ProcessError::Spawn(format!(
                        "script is not an existing file: {}",
                        script_path.display()
                    )));
                }
            }
        }
        Ok(())
    }

    fn wait_for_exit(&self, limit: Duration) -> bool {
        let deadline = Instant::now() + limit;
        loop {
            {
                let state = lock_state(&self.shared);
                if matches!(state.state, ServiceState::Stopped | ServiceState::Error) {
                    return true;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(POLL_INTERVAL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    const FORCE_KILL_MESSAGE: &str = "Stop timeout exceeded; process tree was force-killed.";

    fn make_sink() -> (EventSink, Arc<Mutex<Vec<ProcessEvent>>>) {
        let events: Arc<Mutex<Vec<ProcessEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&events);
        let sink: EventSink = Arc::new(move |event| {
            recorded.lock().unwrap().push(event);
        });
        (sink, events)
    }

    fn make_spec(id: &str, code: &str) -> ProcessSpec {
        ProcessSpec {
            id: id.to_string(),
            display_name: format!("test {}", id),
            command: "node".to_string(),
            args: vec!["-e".to_string(), code.to_string()],
            working_dir: std::env::temp_dir().to_string_lossy().into_owned(),
            start_delay_ms: 0,
        }
    }

    fn wait_until(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + limit;
        loop {
            if condition() {
                return true;
            }
            if Instant::now() >= deadline {
                return condition();
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn output_lines(events: &Arc<Mutex<Vec<ProcessEvent>>>) -> Vec<String> {
        events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                ProcessEvent::Output { line, .. } => Some(line.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn start_streams_stdout_lines() {
        let (sink, events) = make_sink();
        let spec = make_spec("t1", "console.log('hello-1'); setInterval(()=>{},1e3)");
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        managed.start().expect("start succeeds");
        let seen = wait_until(Duration::from_secs(5), || {
            output_lines(&events).iter().any(|l| l.contains("hello-1"))
        });
        assert!(seen, "expected an output line containing hello-1");
        let status = managed.status();
        assert_eq!(status.state, ServiceState::Running);
        assert!(status.pid.is_some());
        assert!(status.started_at.is_some());
        let status_states: Vec<ServiceState> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                ProcessEvent::Status(status) => Some(status.state),
                _ => None,
            })
            .collect();
        assert_eq!(status_states.get(0), Some(&ServiceState::Starting));
        assert_eq!(status_states.get(1), Some(&ServiceState::Running));
        managed.stop().expect("cleanup stop succeeds");
    }

    #[test]
    fn start_while_running_fails() {
        let (sink, events) = make_sink();
        let spec = make_spec("t2", "console.log('hello-1'); setInterval(()=>{},1e3)");
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        managed.start().expect("first start succeeds");
        let seen = wait_until(Duration::from_secs(5), || {
            output_lines(&events).iter().any(|l| l.contains("hello-1"))
        });
        assert!(seen, "expected first output line containing hello-1");
        let err = managed
            .start()
            .expect_err("second start while running must fail");
        assert!(matches!(err, ProcessError::InvalidState(_)), "got {:?}", err);
        thread::sleep(Duration::from_millis(250));
        let hello_count = output_lines(&events)
            .iter()
            .filter(|l| l.contains("hello-1"))
            .count();
        assert_eq!(hello_count, 1, "expected exactly one hello-1 output");
        managed.stop().expect("cleanup stop succeeds");
    }

    #[test]
    fn graceful_stop_uses_stdin_exit() {
        let (sink, events) = make_sink();
        let spec = make_spec(
            "t3",
            "process.stdin.on('data',()=>process.exit(0)); console.log('ready')",
        );
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_secs(3));
        managed.start().expect("start succeeds");
        let ready = wait_until(Duration::from_secs(5), || {
            output_lines(&events).iter().any(|l| l.contains("ready"))
        });
        assert!(ready, "expected ready output before stop");
        let started = Instant::now();
        managed.stop().expect("stop succeeds");
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(2),
            "graceful stop took {:?}, expected under 2s",
            elapsed
        );
        assert_eq!(managed.status().state, ServiceState::Stopped);
        assert!(
            output_lines(&events)
                .iter()
                .all(|l| l.as_str() != FORCE_KILL_MESSAGE),
            "graceful stop must not force-kill"
        );
    }

    #[test]
    fn stop_force_kills_after_timeout() {
        let (sink, events) = make_sink();
        let spec = make_spec("t4", "setInterval(()=>{},1e3)");
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        managed.start().expect("start succeeds");
        let started = Instant::now();
        managed.stop().expect("stop succeeds");
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(8),
            "force stop took {:?}, expected under 8s",
            elapsed
        );
        assert_eq!(managed.status().state, ServiceState::Stopped);
        assert!(
            output_lines(&events)
                .iter()
                .any(|l| l.as_str() == FORCE_KILL_MESSAGE),
            "expected the force-kill console line"
        );
    }

    #[test]
    fn unexpected_nonzero_exit_is_error() {
        let (sink, _events) = make_sink();
        let spec = make_spec("t5", "process.exit(3)");
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        managed.start().expect("start succeeds");
        let failed = wait_until(Duration::from_secs(5), || {
            managed.status().state == ServiceState::Error
        });
        assert!(failed, "expected error state after nonzero exit");
        let status = managed.status();
        assert_eq!(status.exit_code, Some(3));
        assert!(status.error.is_some());
        managed.stop().expect("stop after error is a no-op");
    }

    #[test]
    fn start_with_missing_workdir_fails() {
        let (sink, _events) = make_sink();
        let spec = ProcessSpec {
            working_dir: "C:/definitely/not/here".to_string(),
            ..make_spec("t6", "process.exit(0)")
        };
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        let err = managed
            .start()
            .expect_err("start with missing working dir must fail");
        assert!(matches!(err, ProcessError::Spawn(_)), "got {:?}", err);
        assert_eq!(managed.status().state, ServiceState::Stopped);
        managed.stop().expect("stop after failed start is a no-op");
    }

    #[test]
    fn stop_when_stopped_is_noop() {
        let (sink, _events) = make_sink();
        let spec = make_spec("t7", "process.exit(0)");
        let mut managed = ManagedProcess::new(spec, sink, Duration::from_millis(300));
        managed.stop().expect("stop before start is a no-op");
        assert_eq!(managed.status().state, ServiceState::Stopped);
        managed.start().expect("start succeeds");
        let exited = wait_until(Duration::from_secs(5), || {
            managed.status().state == ServiceState::Stopped
        });
        assert!(exited, "expected the child to exit on its own");
        managed.stop().expect("stop after exit is a no-op");
    }
}
