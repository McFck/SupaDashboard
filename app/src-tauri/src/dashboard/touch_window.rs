//! A touch-owned window gesture uses physical screen coordinates, never the mouse cursor.
use super::geometry::{Geometry, ResizeHit};
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
pub enum TouchWindowAction {
    Move,
    Resize(ResizeHit),
}

#[derive(Default)]
pub enum TouchWindow {
    #[default]
    Idle,
    Active {
        id: u32,
        start: (i32, i32),
        bounds: Geometry,
        minimum: (i32, i32),
        action: TouchWindowAction,
    },
}

impl TouchWindow {
    pub fn owns(&self, pointer: u32) -> bool {
        matches!(self, Self::Active { id, .. } if *id == pointer)
    }

    pub fn active(&self) -> bool {
        matches!(self, Self::Active { .. })
    }

    pub fn update(&mut self, pointer: u32, point: (i32, i32), end: bool) -> Option<Geometry> {
        let Self::Active {
            id,
            start,
            bounds,
            minimum,
            action,
        } = *self
        else {
            return None;
        };
        if id != pointer {
            return None;
        }
        let delta = (
            i64::from(point.0) - i64::from(start.0),
            i64::from(point.1) - i64::from(start.1),
        );
        let mut next = bounds;
        match action {
            TouchWindowAction::Move => {
                next.x += delta.0;
                next.y += delta.1;
            }
            TouchWindowAction::Resize(direction) => {
                next = resized(bounds, direction, delta, minimum);
            }
        }
        if end {
            *self = Self::Idle;
        }
        Some(next)
    }
}

fn resized(
    bounds: Geometry,
    direction: ResizeHit,
    delta: (i64, i64),
    minimum: (i32, i32),
) -> Geometry {
    let mut next = bounds;
    let west = matches!(
        direction,
        ResizeHit::West | ResizeHit::NorthWest | ResizeHit::SouthWest
    );
    let east = matches!(
        direction,
        ResizeHit::East | ResizeHit::NorthEast | ResizeHit::SouthEast
    );
    let north = matches!(
        direction,
        ResizeHit::North | ResizeHit::NorthWest | ResizeHit::NorthEast
    );
    let south = matches!(
        direction,
        ResizeHit::South | ResizeHit::SouthWest | ResizeHit::SouthEast
    );
    if west {
        next.width = (bounds.width - delta.0).max(i64::from(minimum.0.max(1)));
        next.x = bounds.x + bounds.width - next.width;
    }
    if east {
        next.width = (bounds.width + delta.0).max(i64::from(minimum.0.max(1)));
    }
    if north {
        next.height = (bounds.height - delta.1).max(i64::from(minimum.1.max(1)));
        next.y = bounds.y + bounds.height - next.height;
    }
    if south {
        next.height = (bounds.height + delta.1).max(i64::from(minimum.1.max(1)));
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gesture(action: TouchWindowAction) -> TouchWindow {
        TouchWindow::Active {
            id: 2,
            start: (-1800, 100),
            bounds: Geometry {
                x: -1920,
                y: 0,
                width: 600,
                height: 400,
            },
            minimum: (300, 200),
            action,
        }
    }

    #[test]
    fn movement_on_a_negative_origin_monitor_belongs_only_to_its_touch_until_release() {
        let mut moving = gesture(TouchWindowAction::Move);
        assert!(moving.update(3, (-1600, 200), false).is_none());
        assert_eq!(
            moving.update(2, (-1700, 150), true),
            Some(Geometry {
                x: -1820,
                y: 50,
                width: 600,
                height: 400
            })
        );
        assert!(moving.update(2, (-1600, 200), false).is_none());
    }

    #[test]
    fn west_and_north_resizing_preserves_the_opposite_corner_at_the_minimum_size() {
        let mut resizing = gesture(TouchWindowAction::Resize(ResizeHit::NorthWest));
        assert_eq!(
            resizing.update(2, (-1000, 800), false),
            Some(Geometry {
                x: -1620,
                y: 200,
                width: 300,
                height: 200
            })
        );
    }

    #[test]
    fn rejects_unknown_window_actions_and_resize_edges() {
        for value in [
            json!("East"),
            json!({"Resize":"Diagonal"}),
            json!({"Move":true}),
        ] {
            assert!(serde_json::from_value::<TouchWindowAction>(value).is_err());
        }
    }
    use serde_json::json;
}
