//! Backoff for restarting a plugin process that exited on its own or failed to start.
use std::time::Duration;

const FIRST: Duration = Duration::from_secs(1);
const LONGEST: Duration = Duration::from_secs(30);
/// A process that ran this long counts as healthy: its next failure starts the backoff over.
const STABLE: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Restarts {
    failures: u32,
}

impl Restarts {
    /// Delay before the next start after a process ran for `uptime` (zero when it never started).
    pub fn after_exit(&mut self, uptime: Duration) -> Duration {
        if uptime >= STABLE {
            self.failures = 0;
        }
        self.failures = self.failures.saturating_add(1);
        FIRST
            .saturating_mul(1 << (self.failures - 1).min(5))
            .min(LONGEST)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crash_loop_backs_off_and_a_stable_run_starts_over() {
        let mut restarts = Restarts::default();
        let quick = Duration::from_millis(200);
        let delays: Vec<u64> = (0..8)
            .map(|_| restarts.after_exit(quick).as_secs())
            .collect();
        assert_eq!(delays, [1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(restarts.after_exit(STABLE), FIRST);
    }
}
