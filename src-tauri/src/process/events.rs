use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub type EventSink = Arc<dyn Fn(ProcessEvent) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub id: String,
    pub state: ServiceState,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessEvent {
    Status(ServiceStatus),
    Output {
        id: String,
        stream: OutputStream,
        line: String,
        timestamp: u64,
    },
    Error {
        id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSpec {
    pub id: String,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: String,
    pub start_delay_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_status_serializes_camel_case() {
        let status = ServiceStatus {
            id: "panel".to_string(),
            state: ServiceState::Running,
            pid: Some(4242),
            started_at: Some(1_700_000_000_000),
            exit_code: Some(0),
            error: Some("boom".to_string()),
        };
        let value = serde_json::to_value(&status).expect("serialize status");
        let map = value
            .as_object()
            .expect("status serializes to a JSON object");
        assert_eq!(map.len(), 6);
        assert_eq!(map.get("id").and_then(|v| v.as_str()), Some("panel"));
        assert_eq!(map.get("state").and_then(|v| v.as_str()), Some("running"));
        assert_eq!(map.get("pid").and_then(|v| v.as_u64()), Some(4242));
        assert_eq!(
            map.get("startedAt").and_then(|v| v.as_u64()),
            Some(1_700_000_000_000)
        );
        assert_eq!(map.get("exitCode").and_then(|v| v.as_i64()), Some(0));
        assert_eq!(map.get("error").and_then(|v| v.as_str()), Some("boom"));
    }

    #[test]
    fn output_stream_serializes_lowercase() {
        assert_eq!(
            serde_json::to_value(OutputStream::Stdout).expect("serialize stdout"),
            serde_json::json!("stdout")
        );
        assert_eq!(
            serde_json::to_value(OutputStream::Stderr).expect("serialize stderr"),
            serde_json::json!("stderr")
        );
    }
}
