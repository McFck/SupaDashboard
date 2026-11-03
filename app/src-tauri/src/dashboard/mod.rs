//! The borderless dashboard window: native input policy, geometry and the commands that move it.
mod backdrop;
pub mod commands;
mod cursor;
mod events;
mod geometry;
mod monitor_guard;
pub mod policy;
mod touch_input;
mod touch_stream;
mod touch_surface;
mod touch_window;
