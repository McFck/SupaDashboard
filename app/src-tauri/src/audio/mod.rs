//! One MTA worker owns Core Audio and polls a canonical snapshot for both app windows.
mod core_audio;
pub(crate) mod model;
pub mod service;
