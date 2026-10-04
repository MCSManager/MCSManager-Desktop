use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use super::events::{EventSink, ProcessEvent, ProcessSpec, ServiceStatus};
use super::managed::{ManagedProcess, ProcState, ProcessError};

pub struct ProcessManager {
    sink: EventSink,
    stop_timeout: Duration,
    processes: HashMap<String, Arc<Mutex<ManagedProcess>>>,
    states: HashMap<String, Arc<Mutex<ProcState>>>,
    specs: HashMap<String, ProcessSpec>,
    order: Vec<String>,
}

fn lock_process(process: &Mutex<ManagedProcess>) -> MutexGuard<'_, ManagedProcess> {
    process
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_state(state: &Mutex<ProcState>) -> MutexGuard<'_, ProcState> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn status_from_handle(state: &Mutex<ProcState>, id: &str) -> ServiceStatus {
    let state = lock_state(state);
    ServiceStatus {
        id: id.to_string(),
        state: state.state,
        pid: state.pid,
        started_at: state.started_at,
        exit_code: state.exit_code,
        error: state.error.clone(),
    }
}

impl ProcessManager {
    pub fn new(sink: EventSink, stop_timeout: Duration) -> Self {
        Self {
            sink,
            stop_timeout,
            processes: HashMap::new(),
            states: HashMap::new(),
            specs: HashMap::new(),
            order: Vec::new(),
        }
    }

    pub fn register(&mut self, spec: ProcessSpec) -> Result<(), ProcessError> {
        if self.processes.contains_key(&spec.id) {
            return Err(ProcessError::Duplicate(format!(
                "service already registered: {}",
                spec.id
            )));
        }
        let id = spec.id.clone();
        let managed = ManagedProcess::new(spec.clone(), Arc::clone(&self.sink), self.stop_timeout);
        let state = managed.status_handle();
        self.processes.insert(id.clone(), Arc::new(Mutex::new(managed)));
        self.states.insert(id.clone(), state);
        self.specs.insert(id.clone(), spec);
        self.order.push(id);
        Ok(())
    }

    fn process_for(&self, id: &str) -> Result<&Arc<Mutex<ManagedProcess>>, ProcessError> {
        self.processes
            .get(id)
            .ok_or_else(|| ProcessError::NotFound(format!("service not found: {}", id)))
    }

    pub fn start(&self, id: &str) -> Result<(), ProcessError> {
        let process = self.process_for(id)?;
        lock_process(process).start()
    }

    pub fn stop(&self, id: &str) -> Result<(), ProcessError> {
        let process = self.process_for(id)?;
        lock_process(process).stop()
    }

    pub fn restart(&self, id: &str) -> Result<(), ProcessError> {
        let process = self.process_for(id)?;
        let mut process = lock_process(process);
        process.stop()?;
        process.start()
    }

    pub fn start_all(&self) -> Result<(), ProcessError> {
        let mut first_error: Option<ProcessError> = None;
        for id in &self.order {
            let delay_ms = self
                .specs
                .get(id)
                .map(|spec| spec.start_delay_ms)
                .unwrap_or(0);
            let process = Arc::clone(self.process_for(id).expect("order and processes in sync"));
            if delay_ms == 0 {
                if let Err(error) = lock_process(&process).start() {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            } else {
                let sink = Arc::clone(&self.sink);
                let id = id.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(delay_ms));
                    if let Err(error) = lock_process(&process).start() {
                        sink(ProcessEvent::Error {
                            id,
                            message: error.to_string(),
                        });
                    }
                });
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn stop_all(&self) -> Result<(), ProcessError> {
        let mut first_error: Option<ProcessError> = None;
        for id in self.order.iter().rev() {
            if let Err(error) = self.stop(id) {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn status(&self, id: &str) -> Result<ServiceStatus, ProcessError> {
        let state = self.states.get(id).ok_or_else(|| {
            ProcessError::NotFound(format!("service not found: {}", id))
        })?;
        Ok(status_from_handle(state, id))
    }

    pub fn statuses(&self) -> Vec<ServiceStatus> {
        self.order
            .iter()
            .map(|id| {
                let state = self.states.get(id).expect("order and states in sync");
                status_from_handle(state, id)
            })
            .collect()
    }

    pub fn shutdown(&self) {
        let _ = self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::events::ServiceState;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    const LONG_RUN: &str = "console.log('ready-'+process.pid); process.stdin.on('data',()=>process.exit(0)); setInterval(()=>{},1e3)";

    fn make_sink() -> (EventSink, Arc<Mutex<Vec<ProcessEvent>>>) {
        let events: Arc<Mutex<Vec<ProcessEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&events);
        let sink: EventSink = Arc::new(move |event| {
            recorded.lock().unwrap().push(event);
        });
        (sink, events)
    }

    fn make_spec(id: &str, code: &str, start_delay_ms: u64) -> ProcessSpec {
        ProcessSpec {
            id: id.to_string(),
            display_name: format!("test {}", id),
            command: "node".to_string(),
            args: vec!["-e".to_string(), code.to_string()],
            working_dir: std::env::temp_dir().to_string_lossy().into_owned(),
            start_delay_ms,
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

    fn state_ids(events: &Arc<Mutex<Vec<ProcessEvent>>>, target: ServiceState) -> Vec<String> {
        events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                ProcessEvent::Status(status) if status.state == target => Some(status.id.clone()),
                _ => None,
            })
            .collect()
    }

    fn ready_pids(events: &Arc<Mutex<Vec<ProcessEvent>>>) -> Vec<u32> {
        events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                ProcessEvent::Output { line, .. } => line
                    .strip_prefix("ready-")
                    .and_then(|pid| pid.parse::<u32>().ok()),
                _ => None,
            })
            .collect()
    }

    fn is_running(manager: &ProcessManager, id: &str) -> bool {
        manager
            .status(id)
            .map(|status| status.state == ServiceState::Running && status.pid.is_some())
            .unwrap_or(false)
    }

    fn is_stopped(manager: &ProcessManager, id: &str) -> bool {
        manager
            .status(id)
            .map(|status| status.state == ServiceState::Stopped)
            .unwrap_or(false)
    }

    #[test]
    fn register_and_status_roundtrip() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("svc-a", LONG_RUN, 0))
            .expect("register succeeds");
        let status = manager.status("svc-a").expect("status for registered id");
        assert_eq!(status.id, "svc-a");
        assert_eq!(status.state, ServiceState::Stopped);
        assert_eq!(status.pid, None);
        let statuses = manager.statuses();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].id, "svc-a");
        assert_eq!(statuses[0].state, ServiceState::Stopped);
    }

    #[test]
    fn duplicate_register_fails() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("svc-dup", LONG_RUN, 0))
            .expect("first register succeeds");
        let err = manager
            .register(make_spec("svc-dup", LONG_RUN, 0))
            .expect_err("second register with the same id must fail");
        assert!(matches!(err, ProcessError::Duplicate(_)), "got {:?}", err);
        assert_eq!(manager.statuses().len(), 1);
    }

    #[test]
    fn unknown_id_errors() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("svc-known", LONG_RUN, 0))
            .expect("register succeeds");
        let err = manager
            .start("nope")
            .expect_err("start of unknown id must fail");
        assert!(matches!(err, ProcessError::NotFound(_)), "got {:?}", err);
        let err = manager
            .stop("nope")
            .expect_err("stop of unknown id must fail");
        assert!(matches!(err, ProcessError::NotFound(_)), "got {:?}", err);
        let err = manager
            .restart("nope")
            .expect_err("restart of unknown id must fail");
        assert!(matches!(err, ProcessError::NotFound(_)), "got {:?}", err);
        let err = manager
            .status("nope")
            .expect_err("status of unknown id must fail");
        assert!(matches!(err, ProcessError::NotFound(_)), "got {:?}", err);
    }

    #[test]
    fn start_all_respects_registration_order() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("first", LONG_RUN, 0))
            .expect("register first");
        manager
            .register(make_spec("second", LONG_RUN, 200))
            .expect("register second");
        manager.start_all().expect("start_all succeeds");
        let both_running = wait_until(Duration::from_secs(2), || {
            let running = state_ids(&events, ServiceState::Running);
            running.iter().any(|id| id == "first") && running.iter().any(|id| id == "second")
        });
        assert!(
            both_running,
            "both services should reach Running within 2s of start_all"
        );
        let running = state_ids(&events, ServiceState::Running);
        assert_eq!(running, vec!["first".to_string(), "second".to_string()]);
        manager.shutdown();
    }

    #[test]
    fn stop_all_stops_everything() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(500));
        manager
            .register(make_spec("stop-first", LONG_RUN, 0))
            .expect("register first");
        manager
            .register(make_spec("stop-second", LONG_RUN, 0))
            .expect("register second");
        manager.start_all().expect("start_all succeeds");
        let both_up = wait_until(Duration::from_secs(2), || {
            is_running(&manager, "stop-first") && is_running(&manager, "stop-second")
        });
        assert!(both_up, "both services should be Running before stop_all");
        manager.stop_all().expect("stop_all succeeds");
        let stopping = state_ids(&events, ServiceState::Stopping);
        assert_eq!(
            stopping,
            vec!["stop-second".to_string(), "stop-first".to_string()],
            "stop_all must stop in reverse registration order"
        );
        let both_stopped = wait_until(Duration::from_secs(8), || {
            is_stopped(&manager, "stop-first") && is_stopped(&manager, "stop-second")
        });
        assert!(
            both_stopped,
            "both services should be Stopped within 8s of stop_all"
        );
    }

    #[test]
    fn restart_replaces_process() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("svc-restart", LONG_RUN, 0))
            .expect("register succeeds");
        manager.start("svc-restart").expect("start succeeds");
        let started = wait_until(Duration::from_secs(2), || is_running(&manager, "svc-restart"));
        assert!(
            started,
            "service should be Running with a pid before restart"
        );
        let old_pid = manager.status("svc-restart").expect("status").pid;
        manager.restart("svc-restart").expect("restart succeeds");
        let restarted = wait_until(Duration::from_secs(2), || is_running(&manager, "svc-restart"));
        assert!(restarted, "service should be Running again after restart");
        let new_pid = manager.status("svc-restart").expect("status").pid;
        assert!(old_pid.is_some(), "old run must have had a pid");
        assert!(new_pid.is_some(), "new run must have a pid");
        assert_ne!(old_pid, new_pid, "restart must replace the child process");
        let pids_seen = wait_until(Duration::from_secs(2), || ready_pids(&events).len() == 2);
        assert!(pids_seen, "both runs should print their ready line");
        assert_eq!(
            ready_pids(&events),
            vec![old_pid.unwrap(), new_pid.unwrap()],
            "old child must be gone and only the replacement left running"
        );
        manager.shutdown();
    }

    #[test]
    fn concurrent_start_is_safe() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("svc-race", LONG_RUN, 0))
            .expect("register succeeds");
        let results: Vec<Result<(), ProcessError>> = thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|_| scope.spawn(|| manager.start("svc-race")))
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().expect("starter thread must not panic"))
                .collect()
        });
        let ok_count = results.iter().filter(|result| result.is_ok()).count();
        assert_eq!(ok_count, 1, "exactly one concurrent start must succeed");
        assert!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .all(|err| matches!(err, ProcessError::InvalidState(_))),
            "losing starts must fail with InvalidState, got {:?}",
            results
        );
        let spawned = wait_until(Duration::from_secs(2), || ready_pids(&events).len() == 1);
        assert!(spawned, "the winning start should spawn one child");
        thread::sleep(Duration::from_millis(250));
        assert_eq!(
            ready_pids(&events).len(),
            1,
            "no second child may be spawned by the losing starts"
        );
        assert!(
            is_running(&manager, "svc-race"),
            "the single child should still be Running"
        );
        manager.shutdown();
    }
}
