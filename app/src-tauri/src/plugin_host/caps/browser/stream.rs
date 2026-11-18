use std::collections::HashMap;
use tokio::{sync::oneshot, time::Instant};

use super::{
    actions::ScrollFrame,
    wire::{DEADLINE, Failure},
};

const SCROLL_LIMIT: i32 = 32768;
pub(super) const MAX_PENDING: usize = 32;
type Response = oneshot::Sender<Result<(), Failure>>;

#[derive(Default, serde::Serialize)]
pub(super) struct ScrollOut {
    hold: bool,
    outline: bool,
    dx: i32,
    dy: i32,
    fling: Option<[f32; 2]>,
}

#[derive(Default)]
pub(super) struct ScrollQueue(ScrollOut);

impl ScrollQueue {
    pub(super) fn push(&mut self, frame: ScrollFrame) {
        match frame {
            ScrollFrame::Hold { outline } => {
                self.0.hold = true;
                self.0.outline = outline;
                self.0.dx = 0;
                self.0.dy = 0;
                self.0.fling = None;
            }
            ScrollFrame::Move { dx, dy } => {
                self.0.dx = (self.0.dx + dx).clamp(-SCROLL_LIMIT, SCROLL_LIMIT);
                self.0.dy = (self.0.dy + dy).clamp(-SCROLL_LIMIT, SCROLL_LIMIT);
            }
            ScrollFrame::Release { vx, vy } => self.0.fling = Some([vx, vy]),
        }
    }

    pub(super) fn take(&mut self) -> Option<ScrollOut> {
        let out = std::mem::take(&mut self.0);
        (out.hold || out.dx != 0 || out.dy != 0 || out.fling.is_some()).then_some(out)
    }
}

struct Waiter {
    reply: Response,
    failure: Failure,
    deadline: Instant,
}

#[derive(Default)]
pub(super) struct Pending {
    next: u32,
    waiters: HashMap<u32, Waiter>,
}

impl Pending {
    pub(super) fn insert(
        &mut self,
        reply: Response,
        failure: Failure,
        now: Instant,
    ) -> Result<u32, Response> {
        if self.waiters.len() == MAX_PENDING {
            return Err(reply);
        }
        while self.waiters.contains_key(&self.next) {
            self.next = self.next.wrapping_add(1);
        }
        let id = self.next;
        self.next = id.wrapping_add(1);
        self.waiters.insert(
            id,
            Waiter {
                reply,
                failure,
                deadline: now + DEADLINE,
            },
        );
        Ok(id)
    }

    pub(super) fn complete(&mut self, id: u32, ok: bool, failure: Option<Failure>) {
        if let Some(waiter) = self.waiters.remove(&id) {
            let result = if let Some(failure) = failure {
                Err(failure)
            } else if ok {
                Ok(())
            } else {
                Err(waiter.failure)
            };
            let _ = waiter.reply.send(result);
        }
    }

    pub(super) fn expire(&mut self, now: Instant) -> Option<Instant> {
        for (_, waiter) in self.waiters.extract_if(|_, waiter| waiter.deadline <= now) {
            let _ = waiter.reply.send(Err("Browser did not respond"));
        }
        self.waiters.values().map(|waiter| waiter.deadline).min()
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        for (_, waiter) in self.waiters.drain() {
            let _ = waiter.reply.send(Err("Browser is offline"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backpressure_accumulates_bounded_deltas_and_new_touch_cancels_coast() {
        let mut queue = ScrollQueue::default();
        queue.push(ScrollFrame::Release {
            vx: 100.0,
            vy: -200.0,
        });
        queue.push(ScrollFrame::Hold { outline: true });
        for _ in 0..10 {
            queue.push(ScrollFrame::Move {
                dx: 4096,
                dy: -4096,
            });
        }
        let out = queue.take().unwrap();
        assert!(out.hold);
        assert!(out.outline);
        assert_eq!([out.dx, out.dy], [32768, -32768]);
        assert_eq!(out.fling, None);
        assert!(queue.take().is_none());

        queue.push(ScrollFrame::Release { vx: 0.0, vy: 0.0 });
        let out = queue.take().unwrap();
        assert!(!out.hold);
        assert_eq!([out.dx, out.dy], [0, 0]);
        assert_eq!(out.fling, Some([0.0, 0.0]));
    }

    #[test]
    fn commands_complete_independently_and_unknown_or_duplicate_ids_are_ignored() {
        let mut pending = Pending::default();
        let now = Instant::now();
        let mut add = || {
            let (reply, result) = oneshot::channel();
            (pending.insert(reply, "Failed", now).unwrap(), result)
        };
        let (first, mut a) = add();
        let (second, mut b) = add();
        pending.complete(second, false, Some("Tab closed"));
        pending.complete(second, true, None);
        pending.complete(999, true, None);
        assert_eq!(b.try_recv(), Ok(Err("Tab closed")));
        assert_eq!(a.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        pending.complete(first, true, None);
        assert_eq!(a.try_recv(), Ok(Ok(())));
    }

    #[test]
    fn expiry_frees_capacity_and_late_replies_cannot_complete_other_commands() {
        let mut pending = Pending::default();
        let now = Instant::now();
        let mut waiters: Vec<_> = (0..MAX_PENDING)
            .map(|_| {
                let (reply, result) = oneshot::channel();
                (pending.insert(reply, "Failed", now).unwrap(), result)
            })
            .collect();
        let (reply, mut result) = oneshot::channel();
        let reply = pending.insert(reply, "Failed", now).unwrap_err();
        assert_eq!(pending.expire(now), Some(now + DEADLINE));
        assert_eq!(pending.expire(now + DEADLINE), None);
        let next = pending.insert(reply, "Failed", now + DEADLINE).unwrap();
        for (id, expired) in &mut waiters {
            pending.complete(*id, true, None);
            assert_eq!(expired.try_recv(), Ok(Err("Browser did not respond")));
        }
        assert_ne!(next, waiters[0].0);
        assert_eq!(result.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        drop(pending);
        assert_eq!(result.try_recv(), Ok(Err("Browser is offline")));
    }
}
