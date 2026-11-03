//! Contact lifetime and ordered delivery of a touch gesture to the browser.
use super::geometry::Geometry;
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
    #[serde(skip)]
    pub screen: (i32, i32),
    #[serde(skip)]
    pub surface: Geometry,
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
            Phase::Move | Phase::End => {
                let Some(index) = self
                    .contacts
                    .iter()
                    .position(|contact| contact.id == point.id)
                else {
                    return false;
                };
                let current = &self.contacts[index];
                let wrapped = wraps_edge(
                    current.screen.0,
                    point.screen.0,
                    current.surface.x,
                    current.surface.width,
                ) || wraps_edge(
                    current.screen.1,
                    point.screen.1,
                    current.surface.y,
                    current.surface.height,
                );
                if wrapped || matches!(phase, Phase::End) {
                    let previous = self.contacts.remove(index);
                    // Some sensors wrap to the opposite edge as contact leaves the panel. End at the last valid sample.
                    let ended = if wrapped { previous } else { point };
                    // CDP's explicit end points identify the contacts being released, not the remaining fingers.
                    return self.enqueue(json!({"type": "touchEnd", "touchPoints": [ended]}));
                }
                point.origin = current.origin;
                point.surface = current.surface;
                self.contacts[index] = point;
                "touchMove"
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

fn wraps_edge(previous: i32, next: i32, start: i64, length: i64) -> bool {
    if length <= 0 {
        return false;
    }
    let previous = i64::from(previous) - start;
    let next = i64::from(next) - start;
    let band = length / 20;
    let low = |value| (0..=band).contains(&value);
    let high = |value| (length - band..=length).contains(&value);
    (low(previous) && high(next)) || (high(previous) && low(next))
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
            screen: (x as i32, 12),
            surface: Geometry {
                x: 0,
                y: 0,
                width: 1000,
                height: 1000,
            },
        }
    }

    fn sensor_point(id: u32, screen: (i32, i32)) -> Contact {
        Contact {
            id,
            x: f64::from(screen.0),
            y: f64::from(screen.1),
            origin: screen,
            screen,
            surface: Geometry {
                x: -2000,
                y: 1360,
                width: 2560,
                height: 1760,
            },
        }
    }

    #[test]
    fn leaving_any_sensor_edge_releases_at_the_last_valid_point_without_a_second_action() {
        for (last, wrapped) in [
            ((-1000, 3100), (-1000, 1364)),
            ((-1000, 1364), (-1000, 3100)),
            ((-1990, 2000), (550, 2000)),
            ((550, 2000), (-1990, 2000)),
        ] {
            for release_only in [false, true] {
                let mut stream = TouchStream::default();
                stream.update(Phase::Start, sensor_point(1, (-1000, 2000)));
                stream.complete();
                stream.update(Phase::Start, sensor_point(2, (-500, 2000)));
                stream.complete();
                stream.update(Phase::Move, sensor_point(1, last));
                stream.complete();
                let phase = if release_only {
                    Phase::End
                } else {
                    Phase::Move
                };
                stream.update(phase, sensor_point(1, wrapped));
                assert_eq!(
                    stream.front().unwrap(),
                    &json!({
                        "type":"touchEnd", "touchPoints":[{"id":1,"x":f64::from(last.0),"y":f64::from(last.1)}]
                    })
                );
                stream.complete();
                assert!(!stream.update(Phase::Move, sensor_point(1, wrapped)));
                assert!(!stream.update(Phase::End, sensor_point(1, wrapped)));
                assert!(stream.contains(2));
                assert!(stream.front().is_none());
                assert!(stream.update(Phase::Start, sensor_point(1, wrapped)));
            }
        }
    }

    #[test]
    fn a_continuous_pivot_can_travel_back_across_the_sensor_without_ending_the_contact() {
        let mut stream = TouchStream::default();
        stream.update(Phase::Start, sensor_point(1, (-1000, 2000)));
        stream.complete();
        for y in [2500, 3100, 2500, 2000, 1500, 1364] {
            stream.update(Phase::Move, sensor_point(1, (-1000, y)));
            assert_eq!(stream.front().unwrap()["type"], "touchMove");
            assert!(stream.contains(1));
            stream.complete();
        }
        stream.update(Phase::End, sensor_point(1, (-1000, 1364)));
        assert_eq!(stream.front().unwrap()["touchPoints"][0]["y"], 1364.0);
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
