use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::wire::{Failure, hex};

const MAX_AXIS: u32 = 32_768;
pub(super) const VIEW_LIMIT: usize = 64 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Rect {
    fn fits(&self, width: u32, height: u32) -> bool {
        self.w > 0
            && self.h > 0
            && self.x.saturating_add(self.w) <= width
            && self.y.saturating_add(self.h) <= height
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ShapeKind {
    Text,
    Heading,
    Image,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Shape {
    kind: ShapeKind,
    rect: Rect,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum TargetKind {
    Link,
    Button,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Target {
    id: u32,
    kind: TargetKind,
    rect: Rect,
    label: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Outline {
    pub(super) tab: i32,
    pub(super) doc: String,
    pub(super) seq: u32,
    width: u32,
    height: u32,
    moving: bool,
    shapes: Vec<Shape>,
    targets: Vec<Target>,
}

impl Outline {
    pub(super) fn validate(&self) -> Result<(), Failure> {
        let mut ids = HashSet::new();
        let valid = self.tab >= 0
            && hex(&self.doc, 32)
            && self.seq > 0
            && (1..=MAX_AXIS).contains(&self.width)
            && (1..=MAX_AXIS).contains(&self.height)
            && self.shapes.len() <= 160
            && self.targets.len() <= 80
            && self
                .shapes
                .iter()
                .all(|shape| shape.rect.fits(self.width, self.height))
            && self.targets.iter().all(|target| {
                target.id > 0
                    && ids.insert(target.id)
                    && target.rect.fits(self.width, self.height)
                    && target.label.chars().count() <= 80
                    && !target.label.chars().any(char::is_control)
            });
        valid.then_some(()).ok_or("Invalid page outline")
    }

    pub(super) fn contains(&self, selection: &Selection) -> bool {
        !self.moving
            && self.tab == selection.tab
            && self.doc == selection.doc
            && selection.seq <= self.seq
            && self.targets.iter().any(|target| {
                target.id == selection.target
                    && selection.x >= target.rect.x
                    && selection.x < target.rect.x + target.rect.w
                    && selection.y >= target.rect.y
                    && selection.y < target.rect.y + target.rect.h
            })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub(super) tab: i32,
    doc: String,
    seq: u32,
    target: u32,
    x: u32,
    y: u32,
    token: String,
}

impl Selection {
    pub(super) fn validate(&self) -> Result<(), Failure> {
        let valid = self.tab >= 0
            && hex(&self.doc, 32)
            && hex(&self.token, 32)
            && self.seq > 0
            && self.target > 0
            && self.x < MAX_AXIS
            && self.y < MAX_AXIS;
        valid.then_some(()).ok_or("Invalid outline selection")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn outline_rejects_duplicate_targets_and_selection_from_another_document() {
        let target =
            json!({"id":1,"kind":"button","rect":{"x":2,"y":3,"w":8,"h":9},"label":"Reply"});
        let mut input = json!({
            "tab":7,"doc":"00000000000000000000000000000000","seq":1,
            "width":100,"height":100,"moving":false,"shapes":[],"targets":[target]
        });
        let view: Outline = serde_json::from_value(input.clone()).unwrap();
        assert!(view.validate().is_ok());
        let mut selection: Selection = serde_json::from_value(json!({
            "tab":7,"doc":view.doc,"seq":1,"target":1,"x":5,"y":6,
            "token":"00000000000000000000000000000001"
        }))
        .unwrap();
        assert!(view.contains(&selection));
        selection.doc = selection.token.clone();
        assert!(!view.contains(&selection));
        input["targets"] = json!([target, target]);
        let view: Outline = serde_json::from_value(input).unwrap();
        assert!(view.validate().is_err());
    }
}
