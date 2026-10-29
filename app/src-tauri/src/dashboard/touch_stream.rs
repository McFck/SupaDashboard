//! Contact lifetime and ordered delivery of a touch gesture to the browser.
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::VecDeque;

#[derive(Serialize)]
pub struct Contact {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    /// The initial physical touch point survives moves while the frontend's window-gesture request is in flight.
    #[serde(skip)]
    pub origin: (i32, i32),
}

pub enum Phase {
    Start,
    Move,
    End,
}

#[derive(Default)]
pub struct TouchStream {
    contacts: Vec<Contact>,
    pending: VecDeque<Value>,
}

impl TouchStream {
    pub fn update(&mut self, phase: Phase, mut point: Contact) -> bool {
        let kind = match phase {
            Phase::Start => {
                if let Some(index) = self
                    .contacts
                    .iter()
                    .position(|contact| contact.id == point.id)
                {
                    self.contacts[index] = point;
                } else {
                    self.contacts.push(point);
                }
                "touchStart"
            }
            Phase::Move => {
                let Some(current) = self
                    .contacts
                    .iter_mut()
                    .find(|contact| contact.id == point.id)
                else {
                    return false;
                };
                point.origin = current.origin;
                *current = point;
                "touchMove"
            }
            Phase::End => {
                let Some(index) = self
                    .contacts
                    .iter()
                    .position(|contact| contact.id == point.id)
                else {
                    return false;
                };
                self.contacts.remove(index);
                // CDP's explicit end points identify the contacts being released, not the remaining fingers.
                return self.enqueue(json!({"type": "touchEnd", "touchPoints": [point]}));
            }
        };
        self.enqueue(json!({"type": kind, "touchPoints": self.contacts }))
    }

    pub fn contains(&self, id: u32) -> bool {
        self.contacts.iter().any(|contact| contact.id == id)
    }

    pub fn primary(&self) -> Option<(u32, (i32, i32))> {
        self.contacts.first().map(|point| (point.id, point.origin))
    }

    pub fn cancel(&mut self) -> bool {
        if self.contacts.is_empty() {
            return false;
        }
        self.contacts.clear();
        self.enqueue(json!({"type": "touchCancel", "touchPoints": []}))
    }

    pub fn front(&self) -> Option<&Value> {
        self.pending.front()
    }

    pub fn complete(&mut self) {
        self.pending.pop_front();
    }

    pub fn abort(&mut self, retry_cancel: bool) {
        self.contacts.clear();
        self.pending.clear();
        if retry_cancel {
            self.pending
                .push_back(json!({"type": "touchCancel", "touchPoints": []}));
        }
    }

    fn enqueue(&mut self, event: Value) -> bool {
        let idle = self.pending.is_empty();
        // The front is in flight. Coalesce only unsent moves, preserving every press and release.
        if self.pending.len() > 1
            && event["type"] == "touchMove"
            && self
                .pending
                .back()
                .is_some_and(|last| last["type"] == "touchMove")
        {
            self.pending.pop_back();
        }
        self.pending.push_back(event);
        idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn point(id: u32, x: f64) -> Contact {
        Contact {
            id,
            x,
            y: 12.0,
            origin: (0, 0),
        }
    }

    #[test]
    fn fast_drag_keeps_the_press_and_release_while_coalescing_unsent_moves() {
        let mut stream = TouchStream::default();
        assert!(stream.update(Phase::Start, point(1, 0.0)));
        assert!(!stream.update(Phase::Move, point(1, 10.0)));
        stream.update(Phase::Move, point(1, 20.0));
        stream.update(Phase::End, point(1, 20.0));
        assert_eq!(stream.front().unwrap()["type"], "touchStart");
        stream.complete();
        assert_eq!(stream.front().unwrap()["touchPoints"][0]["x"], 20.0);
        stream.complete();
        assert_eq!(
            stream.front().unwrap(),
            &json!({"type":"touchEnd", "touchPoints":[{"id":1,"x":20.0,"y":12.0}]})
        );
        stream.complete();
        assert!(stream.front().is_none());
    }

    #[test]
    fn lifting_one_finger_does_not_release_another() {
        let mut stream = TouchStream::default();
        stream.update(Phase::Start, point(1, 0.0));
        stream.complete();
        stream.update(Phase::Start, point(2, 50.0));
        stream.complete();
        stream.update(Phase::End, point(1, 0.0));
        assert_eq!(
            stream.front().unwrap()["touchPoints"],
            json!([{"id":1,"x":0.0,"y":12.0}])
        );
        stream.complete();
        stream.update(Phase::Move, point(2, 60.0));
        assert_eq!(
            stream.front().unwrap()["touchPoints"],
            json!([{"id":2,"x":60.0,"y":12.0}])
        );
    }

    #[test]
    fn canceled_drag_cannot_restart_from_orphan_moves() {
        let mut stream = TouchStream::default();
        stream.update(Phase::Start, point(1, 0.0));
        stream.complete();
        assert!(stream.cancel());
        stream.complete();
        assert!(!stream.update(Phase::Move, point(1, 10.0)));
        assert!(stream.front().is_none());
        assert!(stream.update(Phase::Start, point(2, -10.0)));
    }

    #[test]
    fn a_delayed_window_drag_request_keeps_the_original_physical_touch_anchor() {
        let mut stream = TouchStream::default();
        let mut start = point(1, 10.0);
        start.origin = (-1800, 100);
        stream.update(Phase::Start, start);
        let mut moved = point(1, 50.0);
        moved.origin = (-1750, 120);
        stream.update(Phase::Move, moved);
        assert_eq!(stream.primary(), Some((1, (-1800, 100))));
    }

    #[test]
    fn a_reused_pointer_id_cannot_take_over_the_first_fingers_window_drag() {
        let mut stream = TouchStream::default();
        stream.update(Phase::Start, point(50, 0.0));
        stream.update(Phase::Start, point(2, 30.0));
        assert_eq!(stream.primary().map(|(id, _)| id), Some(50));
    }
}
