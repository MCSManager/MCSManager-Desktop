use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use super::events::{EventSink, ProcessEvent, ProcessSpec, ServiceState, ServiceStatus};
use super::managed::{ManagedProcess, ProcState, ProcessError};

type CancelFlag = Arc<AtomicBool>;
type PendingMap = Arc<Mutex<HashMap<String, CancelFlag>>>;

pub struct ProcessManager {
    sink: EventSink,
    stop_timeout: Duration,
    processes: HashMap<String, Arc<Mutex<ManagedProcess>>>,
    states: HashMap<String, Arc<Mutex<ProcState>>>,
    specs: HashMap<String, ProcessSpec>,
    order: Vec<String>,
    pending: PendingMap,
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

fn lock_pending(pending: &Mutex<HashMap<String, CancelFlag>>) -> MutexGuard<'_, HashMap<String, CancelFlag>> {
    pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn is_real_error(error: &ProcessError) -> bool {
    matches!(
        error,
        ProcessError::Spawn(_) | ProcessError::Io(_) | ProcessError::NotFound(_)
    )
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
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn insert_entry(&mut self, spec: ProcessSpec) {
        let id = spec.id.clone();
        let managed = ManagedProcess::new(spec.clone(), Arc::clone(&self.sink), self.stop_timeout);
        let state = managed.status_handle();
        self.processes.insert(id.clone(), Arc::new(Mutex::new(managed)));
        self.states.insert(id.clone(), state);
        self.specs.insert(id, spec);
    }

    pub fn register(&mut self, spec: ProcessSpec) -> Result<(), ProcessError> {
        if self.processes.contains_key(&spec.id) {
            return Err(ProcessError::Duplicate(format!(
                "service already registered: {}",
                spec.id
            )));
        }
        self.order.push(spec.id.clone());
        self.insert_entry(spec);
        Ok(())
    }

    pub fn register_or_update(&mut self, spec: ProcessSpec) -> Result<(), ProcessError> {
        if !self.processes.contains_key(&spec.id) {
            return self.register(spec);
        }
        // Cancelling the pending delayed start under the pending lock (the same
        // lock the delayed thread checks its flag under) supersedes it: either
        // the delayed thread already started the old instance (the state check
        // below then rejects the replacement) or it will bail out silently.
        let pending_map = Arc::clone(&self.pending);
        let mut pending = lock_pending(&pending_map);
        if let Some(flag) = pending.remove(&spec.id) {
            flag.store(true, Ordering::SeqCst);
        }
        let current = {
            let state = self
                .states
                .get(&spec.id)
                .expect("processes and states in sync");
            lock_state(state).state
        };
        if !matches!(current, ServiceState::Stopped | ServiceState::Error) {
            return Err(ProcessError::InvalidState(format!(
                "cannot replace service \"{}\" while state is {:?}",
                spec.id, current
            )));
        }
        self.insert_entry(spec);
        Ok(())
    }

    fn process_for(&self, id: &str) -> Result<&Arc<Mutex<ManagedProcess>>, ProcessError> {
        self.processes
            .get(id)
            .ok_or_else(|| ProcessError::NotFound(format!("service not found: {}", id)))
    }

    fn is_startable(&self, id: &str) -> bool {
        self.states
            .get(id)
            .map(|state| {
                matches!(
                    lock_state(state).state,
                    ServiceState::Stopped | ServiceState::Error
                )
            })
            .unwrap_or(false)
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

    fn schedule_delayed_start(&self, id: &str, delay_ms: u64, process: Arc<Mutex<ManagedProcess>>) {
        let cancel = {
            let mut pending = lock_pending(&self.pending);
            if let Some(previous) = pending.remove(id) {
                previous.store(true, Ordering::SeqCst);
            }
            let flag = Arc::new(AtomicBool::new(false));
            pending.insert(id.to_string(), Arc::clone(&flag));
            flag
        };
        let sink = Arc::clone(&self.sink);
        let pending = Arc::clone(&self.pending);
        let id = id.to_string();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay_ms));
            let guard = lock_pending(&pending);
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            if let Err(error) = lock_process(&process).start() {
                if is_real_error(&error) {
                    sink(ProcessEvent::Error {
                        id,
                        message: error.to_string(),
                    });
                }
            }
            drop(guard);
        });
    }

    fn cancel_all_pending(&self) {
        let mut pending = lock_pending(&self.pending);
        for (_, flag) in pending.drain() {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn start_all(&self) -> Result<(), ProcessError> {
        self.start_only(&self.order.clone())
    }

    pub fn start_only(&self, ids: &[String]) -> Result<(), ProcessError> {
        let mut first_error: Option<ProcessError> = None;
        for id in ids {
            let delay_ms = self
                .specs
                .get(id)
                .map(|spec| spec.start_delay_ms)
                .unwrap_or(0);
            let process = match self.process_for(id) {
                Ok(process) => Arc::clone(process),
                Err(error) => {
                    if first_error.is_none() && is_real_error(&error) {
                        first_error = Some(error);
                    }
                    continue;
                }
            };
            if delay_ms == 0 {
                if !self.is_startable(id) {
                    continue;
                }
                if let Err(error) = lock_process(&process).start() {
                    if first_error.is_none() && is_real_error(&error) {
                        first_error = Some(error);
                    }
                }
            } else {
                self.schedule_delayed_start(id, delay_ms, process);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn stop_all(&self) -> Result<(), ProcessError> {
        self.cancel_all_pending();
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

    fn is_error(manager: &ProcessManager, id: &str) -> bool {
        manager
            .status(id)
            .map(|status| status.state == ServiceState::Error)
            .unwrap_or(false)
    }

    #[test]
    fn start_all_skips_already_running_services() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("skip-up", LONG_RUN, 0))
            .expect("register up");
        manager
            .register(make_spec("skip-down", LONG_RUN, 0))
            .expect("register down");
        manager.start("skip-up").expect("start up");
        let up = wait_until(Duration::from_secs(2), || is_running(&manager, "skip-up"));
        assert!(up, "first service must be Running before start_all");
        let pid_before = manager.status("skip-up").expect("status").pid;
        manager
            .start_all()
            .expect("start_all must skip the already-running service without error");
        let both_up = wait_until(Duration::from_secs(2), || {
            is_running(&manager, "skip-up") && is_running(&manager, "skip-down")
        });
        assert!(
            both_up,
            "the stopped service should start and the running one stay up"
        );
        assert_eq!(
            manager.status("skip-up").expect("status").pid,
            pid_before,
            "the already-running service must be left untouched"
        );
        manager.shutdown();
    }

    #[test]
    fn register_or_update_replaces_when_stopped() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("replace-a", LONG_RUN, 0))
            .expect("register a");
        manager
            .register(make_spec("replace-b", LONG_RUN, 0))
            .expect("register b");
        manager.start("replace-a").expect("start a");
        let started = wait_until(Duration::from_secs(2), || is_running(&manager, "replace-a"));
        assert!(
            started,
            "service must be Running before it is stopped for replacement"
        );
        manager.stop("replace-a").expect("stop a");
        let stopped = wait_until(Duration::from_secs(2), || is_stopped(&manager, "replace-a"));
        assert!(
            stopped,
            "service must be Stopped before the replacement happens"
        );
        let old = manager.status("replace-a").expect("status before replace");
        assert!(
            old.pid.is_some(),
            "the old entry must show run residue before the replacement"
        );

        manager
            .register_or_update(make_spec("replace-a", "process.exit(3)", 0))
            .expect("replace while Stopped succeeds");
        let fresh = manager.status("replace-a").expect("status after replace");
        assert_eq!(fresh.state, ServiceState::Stopped);
        assert_eq!(fresh.pid, None);
        assert_eq!(fresh.started_at, None);
        assert_eq!(fresh.exit_code, None);
        assert_eq!(fresh.error, None);
        let ids: Vec<String> = manager.statuses().iter().map(|s| s.id.clone()).collect();
        assert_eq!(
            ids,
            vec!["replace-a".to_string(), "replace-b".to_string()],
            "registration order must be preserved across the replacement"
        );

        manager.start("replace-a").expect("start replaced entry");
        let replaced = wait_until(Duration::from_secs(2), || is_error(&manager, "replace-a"));
        assert!(
            replaced,
            "the replaced entry must run the new spec (exit 3 reaches Error)"
        );
        manager.shutdown();
    }

    #[test]
    fn register_or_update_rejects_when_running() {
        let (sink, _events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("busy", LONG_RUN, 0))
            .expect("register succeeds");
        manager.start("busy").expect("start succeeds");
        let started = wait_until(Duration::from_secs(2), || is_running(&manager, "busy"));
        assert!(
            started,
            "service should be Running before the update attempt"
        );
        let pid_before = manager.status("busy").expect("status").pid;
        let err = manager
            .register_or_update(make_spec("busy", "process.exit(3)", 0))
            .expect_err("update while Running must fail");
        assert!(matches!(err, ProcessError::InvalidState(_)), "got {:?}", err);
        assert!(
            is_running(&manager, "busy"),
            "the running entry must be left alone"
        );
        assert_eq!(manager.status("busy").expect("status").pid, pid_before);
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

    #[test]
    fn stop_all_cancels_pending_delayed_start() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("cancel-delay", LONG_RUN, 500))
            .expect("register succeeds");
        manager.start_all().expect("start_all succeeds");
        manager.stop_all().expect("stop_all succeeds");
        thread::sleep(Duration::from_millis(1100));
        assert!(
            state_ids(&events, ServiceState::Running).is_empty(),
            "no service may reach Running after stop_all cancelled the pending delayed start"
        );
        assert!(
            ready_pids(&events).is_empty(),
            "no child may spawn after stop_all cancelled the pending delayed start"
        );
        assert!(
            !is_running(&manager, "cancel-delay"),
            "the cancelled delayed start must leave the service stopped"
        );
    }

    #[test]
    fn register_or_update_cancels_pending_delayed_start() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("swap-delay", LONG_RUN, 500))
            .expect("register succeeds");
        manager.start_all().expect("start_all succeeds");
        manager
            .register_or_update(make_spec("swap-delay", LONG_RUN, 0))
            .expect("replacement during the delay window succeeds");
        thread::sleep(Duration::from_millis(1100));
        assert!(
            state_ids(&events, ServiceState::Running).is_empty(),
            "the superseded delayed thread must not start the old instance after replacement"
        );
        assert!(
            ready_pids(&events).is_empty(),
            "no child may spawn from the superseded delayed thread"
        );
        let fresh = manager.status("swap-delay").expect("status after replace");
        assert_eq!(fresh.state, ServiceState::Stopped);
        assert_eq!(fresh.pid, None);
    }

    #[test]
    fn start_only_starts_listed_services_only() {
        let (sink, events) = make_sink();
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(make_spec("listed", LONG_RUN, 0))
            .expect("register listed");
        manager
            .register(make_spec("skipped", LONG_RUN, 200))
            .expect("register skipped");
        manager
            .start_only(&["listed".to_string()])
            .expect("start_only succeeds");
        let listed_up = wait_until(Duration::from_secs(2), || is_running(&manager, "listed"));
        assert!(listed_up, "the listed service must reach Running");
        thread::sleep(Duration::from_millis(600));
        assert!(
            !is_running(&manager, "skipped"),
            "the unlisted service must never start, even with a delayed spec"
        );
        let running = state_ids(&events, ServiceState::Running);
        assert_eq!(
            running,
            vec!["listed".to_string()],
            "only the listed service may reach Running"
        );
        manager.shutdown();
    }
}
