//! Reads the buttons of the program's windows through UI Automation and presses them, on the watcher's thread.
use std::collections::HashMap;
use std::ffi::c_void;
use std::time::Instant;

use serde::Serialize;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::SAFEARRAY;
use windows::Win32::System::Ole::{
    SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
    SafeArrayUnaccessData,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern, TreeScope_Descendants,
    UIA_ButtonControlTypeId, UIA_ControlTypePropertyId, UIA_InvokePatternId,
};

/// Ancestors listed per button.
const DEPTH: usize = 6;

#[derive(Clone, Default, PartialEq, Serialize)]
pub struct Snapshot {
    /// Changes whenever the buttons are found again; `invoke` names the snapshot its index is from.
    id: u64,
    running: bool,
    buttons: Vec<Button>,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct Button {
    name: String,
    /// Ancestors, nearest first, as indexes that are equal for the same element within one snapshot.
    parents: Vec<usize>,
}

/// An element's UI Automation runtime id, the same for the same element.
fn runtime_id(element: &IUIAutomationElement) -> Option<Vec<i32>> {
    // SAFETY: the array is read within its bounds while accessed, then destroyed.
    unsafe {
        let array: *mut SAFEARRAY = element.GetRuntimeId().ok()?;
        let (lower, upper) = (
            SafeArrayGetLBound(array, 1).ok()?,
            SafeArrayGetUBound(array, 1).ok()?,
        );
        let mut data: *mut c_void = std::ptr::null_mut();
        let id = SafeArrayAccessData(array, &mut data).ok().map(|()| {
            let id =
                std::slice::from_raw_parts(data.cast::<i32>(), (upper - lower + 1).max(0) as usize)
                    .to_vec();
            let _ = SafeArrayUnaccessData(array);
            id
        });
        let _ = SafeArrayDestroy(array);
        id
    }
}

/// Buttons with their ancestors' runtime ids, nearest first, as snapshot buttons whose equal ancestors share an index.
fn buttons(found: Vec<(String, Vec<Vec<i32>>)>) -> Vec<Button> {
    let mut indexes: HashMap<Vec<i32>, usize> = HashMap::new();
    found
        .into_iter()
        .map(|(name, ancestors)| Button {
            name,
            parents: ancestors
                .into_iter()
                .map(|id| {
                    let next = indexes.len();
                    *indexes.entry(id).or_insert(next)
                })
                .collect(),
        })
        .collect()
}

pub struct Scanner {
    uia: IUIAutomation,
    elements: Vec<IUIAutomationElement>,
    snapshot: Snapshot,
    /// When the buttons were last found.
    pub last_full: Option<Instant>,
}

impl Scanner {
    pub fn new(uia: IUIAutomation) -> Self {
        Self {
            uia,
            elements: Vec::new(),
            snapshot: Snapshot::default(),
            last_full: None,
        }
    }

    /// Re-reads the found buttons' names in the program's `windows`, rescanning when asked or when one is gone.
    pub fn refresh(&mut self, windows: &[HWND], full: bool) -> Snapshot {
        if windows.is_empty() {
            if self.snapshot.running {
                self.elements.clear();
                self.snapshot = Snapshot {
                    id: self.snapshot.id + 1,
                    ..Snapshot::default()
                };
            }
            return self.snapshot.clone();
        }
        if full || !self.reread() {
            self.scan(windows);
        }
        self.snapshot.clone()
    }

    fn reread(&mut self) -> bool {
        if self.elements.is_empty() {
            return false;
        }
        for (element, button) in self.elements.iter().zip(&mut self.snapshot.buttons) {
            // SAFETY: a COM call on this thread's element.
            match unsafe { element.CurrentName() } {
                Ok(name) => button.name = name.to_string(),
                Err(_) => return false,
            }
        }
        true
    }

    fn scan(&mut self, windows: &[HWND]) {
        self.last_full = Some(Instant::now());
        self.elements.clear();
        let mut found = Vec::new();
        // SAFETY: COM calls on this thread's automation objects.
        unsafe {
            let (Ok(condition), Ok(walker)) = (
                self.uia.CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_ButtonControlTypeId.0),
                ),
                self.uia.RawViewWalker(),
            ) else {
                return;
            };
            for hwnd in windows {
                let Ok(all) = self
                    .uia
                    .ElementFromHandle(*hwnd)
                    .and_then(|root| root.FindAll(TreeScope_Descendants, &condition))
                else {
                    continue;
                };
                for index in 0..all.Length().unwrap_or(0) {
                    let Ok(element) = all.GetElement(index) else {
                        continue;
                    };
                    let Ok(name) = element.CurrentName() else {
                        continue;
                    };
                    let mut ancestors = Vec::new();
                    let mut node = element.clone();
                    while ancestors.len() < DEPTH {
                        let Some(parent) = walker.GetParentElement(&node).ok() else {
                            break;
                        };
                        let Some(id) = runtime_id(&parent) else {
                            break;
                        };
                        ancestors.push(id);
                        node = parent;
                    }
                    found.push((name.to_string(), ancestors));
                    self.elements.push(element);
                }
            }
        }
        self.snapshot = Snapshot {
            id: self.snapshot.id + 1,
            running: true,
            buttons: buttons(found),
        };
    }

    pub fn invoke(&self, snapshot: u64, index: usize) -> Result<(), String> {
        if snapshot != self.snapshot.id {
            return Err("The window has changed".into());
        }
        let element = self.elements.get(index).ok_or("No such button")?;
        // SAFETY: a COM call on this thread's element.
        unsafe {
            element
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                .and_then(|pattern| pattern.Invoke())
        }
        .map_err(|_| "The button did not respond".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_under_the_same_element_share_its_parent_index() {
        let found = vec![
            ("Mic".to_owned(), vec![vec![1, 7], vec![1, 3]]),
            ("Leave".to_owned(), vec![vec![1, 8], vec![1, 3]]),
            ("Camera".to_owned(), vec![vec![1, 7], vec![1, 3]]),
        ];
        let parents: Vec<Vec<usize>> = buttons(found)
            .into_iter()
            .map(|button| button.parents)
            .collect();
        assert_eq!(parents, [vec![0, 1], vec![2, 1], vec![0, 1]]);
    }
}
